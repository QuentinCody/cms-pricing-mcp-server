import { inflateRawSync } from "node:zlib";
import { fail, sha256 } from "./fee-schedule-http";

export interface ArchiveMember { name: string; method: number; flags: number; crc32: number; compressed_bytes: number; uncompressed_bytes: number; offset: number; data_limit: number }
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
const MAX_MEMBER = 16 * 1024 * 1024;

/** Small, complete CMS archives only: reject ZIP64, encryption and ambiguous names. */
export function zipMembers(bytes: Uint8Array): ArchiveMember[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break; }
  }
  if (end < 0) fail("Missing ZIP end record", 502);
  const count = view.getUint16(end + 10, true);
  const size = view.getUint32(end + 12, true);
  let pos = view.getUint32(end + 16, true);
  const dataLimit = pos;
  const boundary = pos + size;
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || count !== view.getUint16(end + 8, true) || !count || count === 65535 || count > 500 || boundary !== end) fail("Unsupported ZIP directory", 502);
  const result: ArchiveMember[] = [];
  const names = new Set<string>();
  for (let i = 0; i < count; i++) {
    const { member, next } = readZipMember(pos, boundary, view, bytes, dataLimit, names); result.push(member); pos = next;
  }
  if (pos !== boundary) fail("ZIP directory length mismatch", 502);
  return result;
}

function readZipMember(pos: number, boundary: number, view: DataView<ArrayBufferLike>, bytes: Uint8Array<ArrayBufferLike>, dataLimit: number, names: Set<string>) {
  if (pos + 46 > boundary || view.getUint32(pos, true) !== 0x02014b50) fail("Invalid ZIP member directory", 502);
  const flags = view.getUint16(pos + 8, true);
  const nameSize = view.getUint16(pos + 28, true);
  const next = pos + 46 + nameSize + view.getUint16(pos + 30, true) + view.getUint16(pos + 32, true);
  if (next > boundary || view.getUint16(pos + 34, true) || (flags & ~0x808)) fail("Unsupported ZIP member flags or bounds", 502);
  const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameSize));
  const member = { name, flags, method: view.getUint16(pos + 10, true), crc32: view.getUint32(pos + 16, true), compressed_bytes: view.getUint32(pos + 20, true), uncompressed_bytes: view.getUint32(pos + 24, true), offset: view.getUint32(pos + 42, true), data_limit: dataLimit };
  if (!name || names.has(name) || (/[\\/]/.test(name) || [...name].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) || name === "." || name === ".." || ![0, 8].includes(member.method) || member.uncompressed_bytes > MAX_MEMBER || member.offset + 30 + member.compressed_bytes > dataLimit) fail("Unsupported or duplicate ZIP member", 502);
  names.add(name);
  return { member, next };
}

export function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

export async function zipMember(bytes: Uint8Array, member: ArchiveMember) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pos = member.offset;
  if (pos + 30 > bytes.length || view.getUint32(pos, true) !== 0x04034b50 || view.getUint16(pos + 6, true) !== member.flags || view.getUint16(pos + 8, true) !== member.method) fail("ZIP local header differs from directory", 502);
  const nameEnd = pos + 30 + view.getUint16(pos + 26, true);
  const start = nameEnd + view.getUint16(pos + 28, true);
  if (decoder.decode(bytes.subarray(pos + 30, nameEnd)) !== member.name || start + member.compressed_bytes > member.data_limit) fail("ZIP member name or bounds mismatch", 502);
  if (!(member.flags & 8) && (view.getUint32(pos + 14, true) !== member.crc32 || view.getUint32(pos + 18, true) !== member.compressed_bytes || view.getUint32(pos + 22, true) !== member.uncompressed_bytes)) fail("ZIP local sizes or CRC differ from directory", 502);
  const compressed = bytes.subarray(start, start + member.compressed_bytes);
  const plain = member.method === 0 ? compressed : new Uint8Array(inflateRawSync(compressed, { maxOutputLength: MAX_MEMBER }));
  if (plain.length !== member.uncompressed_bytes || crc32(plain) !== member.crc32) fail("ZIP member size or CRC32 verification failed", 502);
  return { bytes: plain, member_sha256: await sha256(plain), member_crc32_verified: true };
}
