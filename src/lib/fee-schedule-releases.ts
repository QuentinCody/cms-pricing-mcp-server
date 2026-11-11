import { boundedFetch, fail, sha256 } from "./fee-schedule-http";
import { FEE_SCHEDULE_SOURCES } from "./fee-schedule-sources";

const ROOT = "https://www.cms.gov";
const INDEX = "/medicare/payment/fee-schedules/physician/pfs-relative-value-files";
const RELEASE = /^rvu\d{2}[a-d][a-z0-9_]*$/;
interface Link { url: string; label: string }

function text(html: string): string {
  const entities: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };
  return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ").replace(/&([a-z]+);/gi, (all, key: string) => entities[key.toLowerCase()] ?? all)
    .replace(/\s+/g, " ").trim();
}

function links(html: string, base: string): Link[] {
  const result: Link[] = [];
  for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const url = new URL(match[2].replace(/&amp;/g, "&"), base);
      if (url.origin === ROOT && !url.username && !url.password && !url.hash && !url.search) {
        result.push({ url: url.href, label: text(match[3]) });
      }
    } catch { /* Non-URL links are not release evidence. */ }
  }
  return result;
}

async function page(path: string): Promise<{ html: string; sha256: string; retrieved_at: string }> {
  const { response, bytes } = await boundedFetch(`${ROOT}${path}`, "text/html", 2 * 1024 * 1024);
  if (!response.headers.get("content-type")?.includes("text/html")) fail("CMS release page is not HTML", 502);
  return { html: new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes), sha256: await sha256(bytes), retrieved_at: new Date().toISOString() };
}

function releaseLinks(html: string): (Link & { release: string })[] {
  const unique = new Map<string, Link & { release: string }>();
  for (const link of links(html, `${ROOT}${INDEX}`)) {
    const path = new URL(link.url).pathname;
    const code = path.slice(INDEX.length + 1);
    if (path.startsWith(`${INDEX}/`) && RELEASE.test(code)) unique.set(code, { ...link, release: code });
  }
  if (!unique.size) fail("CMS index has no recognized release links", 502);
  return [...unique.values()];
}

function checkParams(params: Record<string, unknown>, names: string[]): void {
  if (Object.keys(params).some(key => !names.includes(key))) fail("Unsupported fee-schedule parameter");
}

async function discover(params: Record<string, unknown>): Promise<unknown> {
  checkParams(params, ["year"]);
  const year = params.year === undefined ? undefined : String(params.year);
  if (year !== undefined && !/^20\d{2}$/.test(year)) fail("year must be a four-digit year from 2000 through 2099");
  const source = await page(INDEX);
  const releases = releaseLinks(source.html).filter(link => year === undefined || link.release.slice(3, 5) === year.slice(2));
  return { source_url: `${ROOT}${INDEX}`, page_sha256: source.sha256, retrieved_at: source.retrieved_at, releases,
    note: "Published links, not a determination of the currently effective release. Select a release explicitly." };
}

function effectiveMonth(html: string): string | null {
  const matches = [...text(html).matchAll(/Physician Fee Schedule\s*[-–—]\s*(January|April|July|October)\s+(20\d{2})\s+release/gi)];
  const months: Record<string, string> = { january: "01", april: "04", july: "07", october: "10" };
  const unique = new Set(matches.map(match => `${match[2]}-${months[match[1].toLowerCase()]}`));
  return unique.size === 1 ? [...unique][0] : null;
}

export async function feeScheduleDetail(params: Record<string, unknown>) {
  checkParams(params, ["release", "expected_page_sha256"]);
  if (typeof params.release !== "string" || !RELEASE.test(params.release)) fail("release must be a lowercase CMS RVU release code");
  if (params.expected_page_sha256 !== undefined && !/^[a-f0-9]{64}$/.test(String(params.expected_page_sha256))) fail("Invalid expected_page_sha256");
  const index = await page(INDEX);
  const link = releaseLinks(index.html).find(item => item.release === params.release);
  if (!link) fail("Release is not listed in the CMS index", 404);
  const source = await page(`${INDEX}/${link.release}`);
  if (params.expected_page_sha256 !== undefined && params.expected_page_sha256 !== source.sha256) fail("Release page changed; rediscover before use", 409);
  return releaseDetail(source, link);
}

function releaseDetail(source: { html: string; sha256: string; retrieved_at: string }, link: Link & { release: string }) {
  const downloads = links(source.html, link.url).filter(item => new URL(item.url).pathname.toLowerCase().endsWith(".zip"));
  if (!downloads.length) fail("CMS release page has no recognized ZIP downloads", 502);
  return { release: link.release, source_url: link.url, page_sha256: source.sha256, retrieved_at: source.retrieved_at,
    effective_month: effectiveMonth(source.html),
    downloads: downloads.map(item => ({ ...item, updated_date_label: item.label.match(/Updated\s+(\d{2}\/\d{2}\/\d{4})/i)?.[1] ?? null })),
    archive_checksum_verified: false, loaded_into_fee_schedules: false,
    note: "Effective month is parsed only from the release description. Download update labels are separate. ZIP members and QP/non-QP conversion factors require validation before ingestion; page hashes are not archive hashes." };
}

export async function feeScheduleRoute(path: string, params: Record<string, unknown>): Promise<unknown> {
  if (path === "/fee-schedules/releases") return discover(params);
  if (path === "/fee-schedules/release") return feeScheduleDetail(params);
  if (path !== "/fee-schedules/configured") fail("Unknown fee-schedule path", 404);
  checkParams(params, []);
  return { sources: FEE_SCHEDULE_SOURCES, release_qualification: "pending", effective_month: null,
    note: "Pinned CSV configuration only. Query fee_schedule_sources in the active generation for actual ingestion evidence; a successful refresh does not establish current-quarter coverage or QP eligibility." };
}
