import type { ApiEndpoint } from "@bio-mcp/shared/codemode/catalog";

const source: NonNullable<ApiEndpoint["queryParams"]> = [
  { name: "release", type: "string", required: true, description: "Exact lowercase listed CMS release, e.g. rvu26d. Selection is explicit; publication is not effectiveness." },
  { name: "archive_url", type: "string", required: false, description: "Exact ZIP URL from the release page; required when the page links more than one archive." },
  { name: "expected_archive_sha256", type: "string", required: false, description: "Reject changed ZIP bytes with 409. Required for nonzero offsets; does not retrieve an archived version." },
  { name: "expected_page_sha256", type: "string", required: false, description: "Optional additional guard on the mutable release HTML; separate from the ZIP hash." },
];

export const feeArchiveEndpoints: ApiEndpoint[] = [
  { method: "GET", path: "/fee-schedules/archive", category: "fee-schedules",
    summary: "Read a provider-linked release ZIP manifest with complete-archive SHA-256, member sizes/CRC32 and separate effective/publication dates. Does not promote built-in fee schedules.", queryParams: source },
  { method: "GET", path: "/fee-schedules/rvus", category: "fee-schedules",
    summary: "Read a lossless bounded page from an explicitly selected 2026 QP or non-QP RVU archive member. Verifies member CRC32/SHA-256; retains multirow headers, source strings, duplicates, NA indicators and copyright notices. No clinician eligibility or payment calculation.",
    queryParams: [...source,
      { name: "qp", type: "string", required: true, enum: ["QP", "non-QP"], description: "Explicit provider QPP/nonQPP file category. QP coverage is narrower; never infer category or eligibility from factor ordering." },
      { name: "offset", type: "number", required: false, description: "Zero-based native data-row offset (default 0). Continuation requires the same release, archive URL, QP selection and expected_archive_sha256." },
      { name: "limit", type: "number", required: false, description: "1–1000 source rows, default 500. The adapter fetches the complete bounded archive; this is local paging." },
    ],
    example: 'return await api.get("/fee-schedules/rvus", { release: "rvu26d", qp: "QP", limit: 100 });',
    response: { description: 'Native cells in records; header_rows and source_preamble retain original layout/notices. Column labels join native header cells vertically. Query pfs_rvu_rows after staging, quoting names such as "CONV FACTOR". Retain next_offset, total_rows and hashes. Successful staging does not make a page complete.' },
  },
];
