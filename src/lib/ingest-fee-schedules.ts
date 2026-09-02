/**
 * Atomic fee-schedule refresh.
 *
 * Data is built in an isolated generation DO. The well-known coordinator DO
 * flips its active-generation pointer only after every source stages
 * successfully, so a partial refresh can never replace the current dataset.
 */

import { restFetch } from "@bio-mcp/shared/http/rest-fetch";
import { parseCsv } from "./csv-parser";
import {
	generationForKeyHash,
	hashIdempotencyKey,
	type IngestResultSummary,
} from "./ingest-control";
import {
	FEE_SCHEDULE_DO_ID,
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
}

export interface IngestOptions {
	idempotencyKey: string;
	now?: number;
	sources?: readonly FeeScheduleSource[];
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

async function fetchSource(source: FeeScheduleSource): Promise<Response> {
	const url = new URL(source.url);
	return restFetch(url.origin, `${url.pathname}${url.search}`, undefined, {
		headers: { Accept: "text/csv" },
		retryOn: [429, 500, 502, 503, 504],
		retries: 2,
		timeout: 15_000,
		deadlineMs: 50_000,
		cache: { ttl: 3_600 },
		userAgent: "cms-pricing-mcp-server/1.0 (bio-mcp)",
	});
}

async function ingestOne(
	candidate: DoStub,
	source: FeeScheduleSource,
): Promise<IngestResultSummary> {
	try {
		const response = await fetchSource(source);
		if (!response.ok) {
			return {
				...source,
				rows: 0,
				status: "error",
				error: `HTTP ${response.status}: ${response.statusText}`,
			};
		}

		const rows = parseCsv(await response.text());
		if (rows.length === 0) {
			return { ...source, rows: 0, status: "error", error: "CSV parsed to 0 rows" };
		}

		const staged = await candidate.fetch(
			new Request("http://cms-pricing.internal/process", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					data: rows,
					schema_hints: {
						tableName: source.tableName,
						indexes: inferIndexes(source),
					},
				}),
			}),
		);
		const stagedBody = (await staged.json().catch(() => ({}))) as {
			success?: boolean;
			error?: string;
		};
		if (!staged.ok || stagedBody.success !== true) {
			return {
				...source,
				rows: rows.length,
				status: "error",
				error:
					stagedBody.error ?? `DO /process failed with HTTP ${staged.status}`,
			};
		}

		return { ...source, rows: rows.length, status: "ok" };
	} catch (error) {
		return {
			...source,
			rows: 0,
			status: "error",
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export async function ingestFeeSchedules(
	doNamespace: DurableObjectNamespace,
	options: IngestOptions,
): Promise<IngestOutcome> {
	const namespace = doNamespace as unknown as IngestNamespace;
	const keyHash = await hashIdempotencyKey(options.idempotencyKey);
	const generation = generationForKeyHash(keyHash);
	const now = options.now ?? Date.now();
	const coordinator = getDo(namespace, FEE_SCHEDULE_DO_ID);
	const beginResponse = await controlRequest(coordinator, "/ingest/begin", {
		idempotencyKeyHash: keyHash,
		generation,
		now,
	});
	if (!beginResponse.ok) {
		throw new Error(`Ingest coordinator rejected begin: HTTP ${beginResponse.status}`);
	}
	const begin = (await beginResponse.json()) as BeginResponse;
	if (!begin.success) throw new Error("Ingest coordinator returned an invalid begin response");
	if (begin.status === "replayed" && begin.completed) {
		return {
			status: "replayed",
			generation: begin.completed.generation,
			activeGeneration: begin.state?.activeGeneration,
			results: begin.completed.results,
		};
	}
	if (begin.status === "in_progress") {
		return {
			status: "in_progress",
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

		for (const source of options.sources ?? FEE_SCHEDULE_SOURCES) {
			const result = await ingestOne(candidate, source);
			results.push(result);
			if (result.status === "error") throw new Error(`${result.key}: ${result.error}`);
		}

		const completedAt = Date.now();
		const promoted = await controlRequest(coordinator, "/ingest/promote", {
			idempotencyKeyHash: keyHash,
			generation,
			completedAt,
			results,
		});
		if (!promoted.ok) {
			throw new Error(`Ingest promotion failed: HTTP ${promoted.status}`);
		}
		return {
			status: "ok",
			generation,
			activeGeneration: generation,
			results,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await controlRequest(coordinator, "/ingest/fail", {
			idempotencyKeyHash: keyHash,
			failedAt: Date.now(),
			error: message,
		}).catch(() => undefined);
		return {
			status: "error",
			activeGeneration: begin.state?.activeGeneration,
			results,
			error: message,
		};
	}
}

/** Resolve the stable public handle to the currently promoted generation. */
export async function resolveFeeScheduleDataAccessId(
	doNamespace: DurableObjectNamespace,
): Promise<string> {
	try {
		const namespace = doNamespace as unknown as IngestNamespace;
		const coordinator = getDo(namespace, FEE_SCHEDULE_DO_ID);
		const response = await coordinator.fetch(
			new Request("http://cms-pricing.internal/ingest/status"),
		);
		if (!response.ok) return FEE_SCHEDULE_DO_ID;
		const status = (await response.json()) as { activeGeneration?: unknown };
		return typeof status.activeGeneration === "string"
			? status.activeGeneration
			: FEE_SCHEDULE_DO_ID;
	} catch {
		return FEE_SCHEDULE_DO_ID;
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
