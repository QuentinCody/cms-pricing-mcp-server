/**
 * Atomic fee-schedule refresh.
 *
 * Data is built in an isolated generation DO. The well-known coordinator DO
 * flips its active-generation pointer only after every source stages
 * successfully, so a partial refresh can never replace the current dataset.
 */

import { readFeeSchedule, stageFeeTable } from "./fee-schedule-evidence";
import { archiveSelection, type ArchiveSelection } from "./fee-archive-selection";
import { stageFeeArchive } from "./ingest-fee-archive";
import { fail } from "./fee-schedule-http";
import {
	generationForKeyHash,
	hashIdempotencyKey,
	type IngestResultSummary,
} from "./ingest-control";
import {
	FEE_SCHEDULE_DO_ID,
	FEE_ARCHIVE_DO_ID,
	FEE_SCHEDULE_SOURCES,
	type FeeScheduleSource,
} from "./fee-schedule-sources";

interface DoStub {
	fetch(request: Request): Promise<Response>;
}

interface IngestNamespace {
	idFromName(name: string): unknown;
	get(id: unknown): DoStub;
}

interface BeginResponse {
	success: boolean;
	status: "acquired" | "in_progress" | "replayed";
	state?: { activeGeneration?: string };
	completed?: {
		generation: string;
		results: IngestResultSummary[];
	};
}

export interface IngestOutcome {
	status: "ok" | "replayed" | "in_progress" | "error";
	generation?: string;
	activeGeneration?: string;
	results: IngestResultSummary[];
	error?: string;
	data_access_id?: string;
}

export interface IngestOptions {
	idempotencyKey: string;
	now?: number;
	sources?: readonly FeeScheduleSource[];
	archive?: ArchiveSelection;
}

function getDo(namespace: IngestNamespace, name: string): DoStub {
	return namespace.get(namespace.idFromName(name));
}

async function controlRequest(
	coordinator: DoStub,
	path: string,
	body: Record<string, unknown>,
): Promise<Response> {
	return coordinator.fetch(
		new Request(`http://cms-pricing.internal${path}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		}),
	);
}

async function ingestOne(
	candidate: DoStub,
	source: FeeScheduleSource,
): Promise<IngestResultSummary> {
	try {
		const { rows, evidence } = await readFeeSchedule(source);
		const columnTypes = Object.fromEntries(Object.keys(rows[0]).map(key => [key, "TEXT"]));
		await stageFeeTable(candidate, source.tableName, rows, inferIndexes(source), columnTypes);
		return { ...source, rows: rows.length, status: "ok", evidence };
	} catch (error) {
		return {
			...source,
			rows: 0,
			status: "error",
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

async function stageSources(candidate: DoStub, sources: readonly FeeScheduleSource[], results: IngestResultSummary[]): Promise<void> {
	if (!sources.length) throw new Error("No fee-schedule sources configured");
	for (const source of sources) {
		const result = await ingestOne(candidate, source);
		results.push(result);
		if (result.status === "error") throw new Error(`${result.key}: ${result.error}`);
	}
	await stageFeeTable(candidate, "fee_schedule_sources", results.map(result => result.evidence));
}

export async function ingestFeeSchedules(
	doNamespace: DurableObjectNamespace,
	options: IngestOptions,
): Promise<IngestOutcome> {
	if (options.archive && options.sources) fail("Select archive ingestion or legacy CSV sources, not both");
	const selection = options.archive ? archiveSelection(options.archive) : undefined;
	const requestHash = selection ? await hashIdempotencyKey(JSON.stringify(selection)) : undefined;
	const coordinatorId = selection ? FEE_ARCHIVE_DO_ID : FEE_SCHEDULE_DO_ID;
	const namespace = doNamespace as unknown as IngestNamespace;
	const { begin, generation, coordinator, keyHash } = await beginFeeIngestion(options, namespace, coordinatorId, requestHash);
	if (begin.status === "replayed" && begin.completed) {
		return {
			status: "replayed",
			data_access_id: coordinatorId,
			generation: begin.completed.generation,
			activeGeneration: begin.state?.activeGeneration,
			results: begin.completed.results,
		};
	}
	if (begin.status === "in_progress") {
		return {
			status: "in_progress",
			data_access_id: coordinatorId,
			activeGeneration: begin.state?.activeGeneration,
			results: [],
		};
	}

	const candidate = getDo(namespace, generation);
	const results: IngestResultSummary[] = [];
	try {
		const cleared = await candidate.fetch(
			new Request("http://cms-pricing.internal/delete", { method: "DELETE" }),
		);
		if (!cleared.ok) throw new Error(`Candidate reset failed: HTTP ${cleared.status}`);

		if (selection) await stageFeeArchive(candidate, selection, results);
		else await stageSources(candidate, options.sources ?? FEE_SCHEDULE_SOURCES, results);

		const completedAt = Date.now();
		const promoted = await controlRequest(coordinator, "/ingest/promote", {
			idempotencyKeyHash: keyHash,
			requestHash,
			generation,
			completedAt,
			results,
		});
		if (!promoted.ok) {
			throw new Error(`Ingest promotion failed: HTTP ${promoted.status}`);
		}
		return {
			status: "ok",
			data_access_id: coordinatorId,
			generation,
			activeGeneration: generation,
			results,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await controlRequest(coordinator, "/ingest/fail", {
			idempotencyKeyHash: keyHash,
			generation,
			failedAt: Date.now(),
			error: message,
		}).catch(() => undefined);
		return {
			status: "error",
			data_access_id: coordinatorId,
			activeGeneration: begin.state?.activeGeneration,
			results,
			error: message,
		};
	}
}

async function beginFeeIngestion(options: IngestOptions, namespace: IngestNamespace, coordinatorId: string, requestHash: string | undefined) {
  const keyHash = await hashIdempotencyKey(options.idempotencyKey);
  const generation = `${generationForKeyHash(keyHash)}_${crypto.randomUUID()}`;
  const now = options.now ?? Date.now();
  const coordinator = getDo(namespace, coordinatorId);
  const beginResponse = await controlRequest(coordinator, "/ingest/begin", {
    idempotencyKeyHash: keyHash,
    requestHash,
    generation,
    now,
  });
  if (!beginResponse.ok) {
    fail(`Ingest coordinator rejected begin: HTTP ${beginResponse.status}; idempotency keys cannot change source selection`, beginResponse.status);
  }
  const begin = (await beginResponse.json()) as BeginResponse;
  if (!begin.success) throw new Error("Ingest coordinator returned an invalid begin response");
  return { begin, generation, coordinator, keyHash };
}

/** Resolve the stable public handle to the currently promoted generation. */
export async function resolveFeeScheduleDataAccessId(
	doNamespace: DurableObjectNamespace,
	handle: string = FEE_SCHEDULE_DO_ID,
): Promise<string> {
	try {
		const namespace = doNamespace as unknown as IngestNamespace;
		const coordinator = getDo(namespace, handle);
		const response = await coordinator.fetch(
			new Request("http://cms-pricing.internal/ingest/status"),
		);
		if (!response.ok) return handle;
		const status = (await response.json()) as { activeGeneration?: unknown };
		return typeof status.activeGeneration === "string"
			? status.activeGeneration
			: handle;
	} catch {
		return handle;
	}
}

function inferIndexes(source: FeeScheduleSource): string[] {
	switch (source.key) {
		case "pfs-indicators":
			return ["hcpc", "modifier", "proc_stat"];
		case "pfs-localities":
			return ["locality", "mac_description", "loc_description"];
		default:
			return [];
	}
}
