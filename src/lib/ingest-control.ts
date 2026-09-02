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
}

export interface CompletedIngest {
	idempotencyKeyHash: string;
	generation: string;
	completedAt: number;
	results: IngestResultSummary[];
}

export interface IngestControlState {
	activeGeneration?: string;
	previousGeneration?: string;
	running?: {
		idempotencyKeyHash: string;
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
		generation: string;
		now: number;
	},
): BeginDecision {
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
		running.generation !== completed.generation
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
	request: { idempotencyKeyHash: string; failedAt: number; error: string },
): IngestControlState {
	if (state.running?.idempotencyKeyHash !== request.idempotencyKeyHash) {
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
