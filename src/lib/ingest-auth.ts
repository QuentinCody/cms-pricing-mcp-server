const BEARER_PREFIX = "Bearer ";

function constantTimeEqual(left: string, right: string): boolean {
	const leftBytes = new TextEncoder().encode(left);
	const rightBytes = new TextEncoder().encode(right);
	const length = Math.max(leftBytes.length, rightBytes.length);
	let mismatch = leftBytes.length ^ rightBytes.length;
	for (let index = 0; index < length; index++) {
		mismatch |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
	}
	return mismatch === 0;
}

export function isAuthorizedIngestRequest(
	request: Request,
	configuredToken: string | undefined,
): boolean {
	if (!configuredToken) return false;
	const authorization = request.headers.get("authorization");
	if (!authorization?.startsWith(BEARER_PREFIX)) return false;
	const supplied = authorization.slice(BEARER_PREFIX.length);
	return constantTimeEqual(supplied, configuredToken);
}

export function getIdempotencyKey(request: Request): string | undefined {
	const value = request.headers.get("idempotency-key")?.trim();
	if (!value || value.length > 128) return undefined;
	return value;
}
