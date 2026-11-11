import type { FeeScheduleEvidence } from "./fee-schedule-evidence";

export const INGEST_CONTROL_KEY = "cms-pricing:ingest-control";
export const INGEST_COMPLETED_PREFIX = "cms-pricing:ingest-completed:";
export const INGEST_LEASE_MS = 20 * 60 * 1000;

export interface IngestResultSummary {
	key: string;
	name: string;
	tableName: string;
	rows: number;
	status: "ok" | "error";
	error?: string;
	evidence?: FeeScheduleEvidence;
}

export interface CompletedIngest {
	idempotencyKeyHash: string;
	requestHash?: string;
	generation: string;
	completedAt: number;
	results: IngestResultSummary[];
}

export interface IngestControlState {
	activeGeneration?: string;
	previousGeneration?: string;
	running?: {
		idempotencyKeyHash: string;
		requestHash?: string;
		generation: string;
		startedAt: number;
		leaseExpiresAt: number;
	};
	lastFailure?: {
		idempotencyKeyHash: string;
		failedAt: number;
		error: string;
	};
}

export type BeginDecision =
	| { status: "acquired"; state: IngestControlState }
	| { status: "in_progress"; state: IngestControlState }
	| { status: "conflict"; state: IngestControlState; error: string }
	| {
			status: "replayed";
			state: IngestControlState;
			completed: CompletedIngest;
	  };

export function beginIngest(
	state: IngestControlState,
	completed: CompletedIngest | undefined,
	request: {
		idempotencyKeyHash: string;
		requestHash?: string;
		generation: string;
		now: number;
	},
): BeginDecision {
	const existing = completed ?? (state.running?.idempotencyKeyHash === request.idempotencyKeyHash ? state.running : undefined);
	if (existing && existing.requestHash !== request.requestHash) return { status: "conflict", state, error: "Idempotency key is already bound to a different source selection" };
	if (completed) return { status: "replayed", state, completed };
	if (state.running && state.running.leaseExpiresAt > request.now) {
		return { status: "in_progress", state };
	}

	return {
		status: "acquired",
		state: {
			...state,
			running: {
				idempotencyKeyHash: request.idempotencyKeyHash,
				requestHash: request.requestHash,
				generation: request.generation,
				startedAt: request.now,
				leaseExpiresAt: request.now + INGEST_LEASE_MS,
			},
		},
	};
}

export function promoteIngest(
	state: IngestControlState,
	completed: CompletedIngest,
): IngestControlState {
	const running = state.running;
	if (
		!running ||
		running.idempotencyKeyHash !== completed.idempotencyKeyHash ||
		running.generation !== completed.generation ||
		running.requestHash !== completed.requestHash ||
		!Number.isFinite(completed.completedAt) || completed.completedAt > running.leaseExpiresAt
	) {
		throw new Error("Ingest promotion does not own the active lease");
	}

	return {
		...state,
		activeGeneration: completed.generation,
		...(state.activeGeneration && state.activeGeneration !== completed.generation
			? { previousGeneration: state.activeGeneration }
			: {}),
		running: undefined,
		lastFailure: undefined,
	};
}

export function failIngest(
	state: IngestControlState,
	request: { idempotencyKeyHash: string; generation: string; failedAt: number; error: string },
): IngestControlState {
	if (state.running?.idempotencyKeyHash !== request.idempotencyKeyHash || state.running.generation !== request.generation) {
		return state;
	}
	return {
		...state,
		running: undefined,
		lastFailure: request,
	};
}

export async function hashIdempotencyKey(key: string): Promise<string> {
	const bytes = new TextEncoder().encode(key);
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

export function generationForKeyHash(keyHash: string): string {
	return `__fee_schedules_generation_${keyHash.slice(0, 24)}`;
}
