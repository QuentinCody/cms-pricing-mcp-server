import { fail } from "./fee-schedule-http";

export interface ArchiveSelection {
  release: string;
  expected_archive_sha256: string;
  archive_url?: string;
  expected_page_sha256?: string;
}

export function archiveSelection(value: unknown): ArchiveSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("archive must be a selection object");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !["release", "expected_archive_sha256", "archive_url", "expected_page_sha256"].includes(key))) fail("Unsupported archive ingestion option");
  if (typeof input.release !== "string" || !/^rvu26[a-d][a-z0-9_]*$/.test(input.release)) fail("Archive ingestion requires an explicit 2026 RVU release");
  if (typeof input.expected_archive_sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(input.expected_archive_sha256)) fail("Archive ingestion requires expected_archive_sha256 from discovery");
  if (input.archive_url !== undefined && (typeof input.archive_url !== "string" || !input.archive_url.startsWith("https://www.cms.gov/") || !input.archive_url.endsWith(".zip"))) fail("archive_url must be an exact CMS ZIP URL from discovery");
  if (input.expected_page_sha256 !== undefined && (typeof input.expected_page_sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(input.expected_page_sha256))) fail("Invalid expected_page_sha256");
  return { release: input.release, expected_archive_sha256: input.expected_archive_sha256.toLowerCase(),
    ...(typeof input.archive_url === "string" ? { archive_url: input.archive_url } : {}),
    ...(typeof input.expected_page_sha256 === "string" ? { expected_page_sha256: input.expected_page_sha256.toLowerCase() } : {}) };
}

/** Existing empty-body requests still refresh only the legacy configured CSVs. */
export async function ingestSelection(request: Request): Promise<ArchiveSelection | undefined> {
  if (!request.body) return undefined;
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const read = async () => {
    let size = 0;
    let body = "";
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 4096) fail("Ingestion selection exceeds 4096 bytes", 413);
      body += decoder.decode(part.value, { stream: true });
    }
    body += decoder.decode();
    if (!body.trim()) return undefined;
    let input: unknown;
    try { input = JSON.parse(body); } catch { fail("Ingestion body must be valid JSON"); }
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => key !== "archive")) fail("Ingestion body supports only an archive selection");
    return "archive" in input ? archiveSelection(input.archive) : undefined;
  };
  try {
    return await Promise.race([read(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error("Ingestion selection read timed out"), { status: 408 })), 10000);
    })]);
  } catch (error) {
    if (error instanceof TypeError) fail("Ingestion body must be valid UTF-8");
    throw error;
  } finally { clearTimeout(timer); void reader.cancel().catch(() => {}); }
}
