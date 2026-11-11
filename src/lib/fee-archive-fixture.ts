/// <reference types="node" />
import { deflateRawSync } from "node:zlib";
import { vi } from "vitest";
import { crc32 } from "./fee-schedule-zip";

export const memberName = "PPRRVU2026_Oct_QPP.csv";
const indexPath = "/medicare/payment/fee-schedules/physician/pfs-relative-value-files";
export const archiveUrl = "https://www.cms.gov/files/zip/rvu26d.zip";
const blank = () => Array<string>(32).fill("");
export function sourceCsv() {
  const headers = Array.from({ length: 10 }, blank);
  headers[0][2] = "Synthetic fixture source notice";
  headers[8][25] = "CONV";
  headers[9] = Array.from({ length: 32 }, (_, i) => `field_${i}`);
  headers[9][0] = "HCPCS"; headers[9][1] = "MOD"; headers[9][2] = "DESCRIPTION"; headers[9][25] = "FACTOR";
  const row = blank(); row[0] = "00100"; row[1] = "  "; row[2] = "fixture"; row[25] = "33.567500";
  return [...headers, row, row].map(values => values.join(",")).join("\r\n") + "\r\n";
}
export function zip(entries: Array<[string, string]> = [[memberName, sourceCsv()]]) {
  const locals: Buffer[] = []; const central: Buffer[] = []; let offset = 0;
  for (const [filename, text] of entries) {
    const name = Buffer.from(filename); const data = Buffer.from(text); const compressed = deflateRawSync(data); const crc = crc32(data);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
    const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(8, 10); directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(compressed.length, 20); directory.writeUInt32LE(data.length, 24); directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(offset, 42);
    locals.push(local, name, compressed); central.push(directory, name); offset += local.length + name.length + compressed.length;
  }
  const end = Buffer.alloc(22); const cd = Buffer.concat(central); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
export function upstream(bytes = zip()) {
  const fetcher = vi.fn(async (url: string) => {
    if (url === archiveUrl) return new Response(new Uint8Array(bytes));
    return new Response(url.endsWith(indexPath) ? `<a href="${indexPath}/rvu26d">RVU26D</a>` : `<p>Physician Fee Schedule - October 2026 release</p><a href="/files/zip/rvu26d.zip">Updated 08/26/2026</a>`, { headers: { "content-type": "text/html" } });
  });
  vi.stubGlobal("fetch", fetcher); return fetcher;
}
