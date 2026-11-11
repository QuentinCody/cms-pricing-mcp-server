export function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function readBytes(response: Response, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) fail("Empty CMS response", 502);
  const chunks: Uint8Array[] = [];
  let size = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      const part = await reader.read();
      signal.throwIfAborted();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) fail("CMS response exceeds byte limit", 502);
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } finally {
    signal.removeEventListener("abort", cancel);
    void reader.cancel().catch(() => {}); // Best-effort cleanup after read failure.
    reader.releaseLock();
  }
}

/** Deadline includes headers and body, including mocked/non-abort-aware streams. */
export async function boundedFetch(
  url: string, accept: string, maxBytes: number,
): Promise<{ response: Response; bytes: Uint8Array }> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(Object.assign(new Error("CMS read deadline exceeded"), { status: 504 }));
    }, 15_000);
  });
  const work = async () => {
    const response = await fetch(url, { headers: { Accept: accept }, redirect: "manual", signal: controller.signal });
    if (controller.signal.aborted) { void response.body?.cancel().catch(() => {}); controller.signal.throwIfAborted(); }
    if (response.status !== 200 || response.headers.has("content-range")) {
      const bytes = await readBytes(response, Math.max(4096, Math.min(maxBytes, 1024 * 1024)), controller.signal);
      throw Object.assign(new Error(`CMS HTTP ${response.status}: expected a complete 200 response`), { status: response.ok ? 502 : response.status,
        data: { body: new TextDecoder().decode(bytes), http_status: response.status, source_url: url, response_sha256: await sha256(bytes), retry_after: response.headers.get("retry-after") } });
    }
    return { response, bytes: await readBytes(response, maxBytes, controller.signal) };
  };
  try { return await Promise.race([work(), timeout]); }
  finally { clearTimeout(timer); controller.abort(); }
}
