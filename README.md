# CMS Pricing MCP Server

This is a [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server. It lets MCP clients (Claude Desktop, Claude Code, Continue, etc.) query the upstream CMS Pricing API in natural language. It is one of 100+ servers in the [Bio MCP](../../README.md) monorepo.

## Connect

Configured production endpoint (October 3 archive and transport changes are locally validated; deployment remains pending):

```
https://cms-pricing-mcp-server.quentincody.workers.dev/mcp
```

Add it to your MCP client (Claude Desktop → Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "cms-pricing": {
      "command": "npx",
      "args": ["mcp-remote", "https://cms-pricing-mcp-server.quentincody.workers.dev/mcp"]
    }
  }
}
```

For local development the server runs at `http://localhost:8866/mcp` (start it with `./scripts/dev-servers.sh cms-pricing`):

```json
{
  "mcpServers": {
    "cms-pricing-local": {
      "command": "npx",
      "args": ["mcp-remote", "http://localhost:8866/mcp"]
    }
  }
}
```

## Tools

- `cms_pricing_search` — discover available API operations (Code Mode catalog search, 34 endpoints)
- `cms_pricing_execute` — **Code Mode**: write JavaScript in a V8 isolate (`api.get()` / `api.post()` / `searchSpec()`) instead of issuing tool calls one by one
- `cms_pricing_query_data` — run SQL over large responses auto-staged into a per-session SQLite database
- `cms_pricing_get_schema` — inspect the inferred schema of a staged dataset

Large responses (>30KB) are auto-staged into a queryable SQLite database; the tools return a `data_access_id` you can query with SQL.

Every tool returns both a human-readable `content` summary and a structured `structuredContent` payload.

## Fee-schedule release discovery

Code Mode supports `GET /fee-schedules/releases` (optional `year`),
`GET /fee-schedules/release` (required lowercase `release`, optional
`expected_page_sha256`) and `GET /fee-schedules/configured`.
Discovery reads the official CMS RVU index and release pages. It reports the
effective month from the description separately from each download's update-date
label. A page hash is evidence about the page bytes, not the ZIP contents.
The reader fails on missing release links/downloads, changed expected hashes,
oversized responses, or a 15-second header/body deadline.

For example, [RVU26D](https://www.cms.gov/medicare/payment/fee-schedules/physician/pfs-relative-value-files/rvu26d)
describes an October 2026 release with an August 26 download update. CMS distinguishes
QP and non-QP files beginning in 2026; QP files have narrower code coverage.
Never select a conversion factor by `MAX`/`MIN` or infer eligibility from its order.

The scheduled refresh still uses the pinned CSVs in `fee-schedule-sources.ts`.
It does **not** automatically ingest a discovered quarterly ZIP. Each new successful
generation includes `fee_schedule_sources` alongside `pfs_indicators` and
`pfs_localities`, recording exact CSV SHA-256, source URL, configured period,
retrieval time, row count and HTTP validators. The manifest stages before the
active-generation pointer changes; any failure retains the prior generation.
Older generations without this table have unknown source evidence.

New CSV ingestions use strict width/quoting checks and retain whitespace and empty
cells. They store native numeric text as TEXT to preserve conversion-factor
precision and leading-zero identifiers. Use explicit numeric casts only after
qualifying the source and selecting eligibility, modifier, locality and site of
service. HTTP modification/retrieval times do not establish an effective date.
Release/effective-month and QP classification of the pinned CSVs remain unverified.

October 3 native reads qualify the **RVU26D** archive and all source cells in the
configured CSVs. The archive has **19 members**; its separate RVU CSVs contain
**19,453 non-QP rows** and **11,978 QP rows**, each with 32 fields. Selected pages
through both live tool aliases match native rows; staged SQL retains source strings,
including leading zeros, whitespace, empty values and decimal precision. QP/non-QP
identity comes from the provider-linked member names, never factor ordering.
The older configured indicators CSV has **31,037 rows / 47 columns** and localities
has **110 rows / 8 columns**; they remain separately qualified by source hash, with
release/effective month and QP eligibility still unverified. A local scheduled refresh
promoted all **31,147 rows**, and every **1,459,619 source cell** matched after SQL
retrieval through alternating aliases. That verifies preservation in the pinned-source
pipeline; it does not make its generation the October archive.

## Explicit quarterly archive reads

`GET /fee-schedules/archive` reads a release's linked ZIP and lists its native member
names, declared sizes/CRC32, whole-archive SHA-256 and separately dated page/download
observations. Select `archive_url` explicitly if the release links multiple ZIPs.
`GET /fee-schedules/rvus` requires `release` and `qp: "QP" | "non-QP"` and returns
1–1,000 source rows (default 500) at a zero-based `offset`. This is local paging over
a complete bounded archive read, not a native CMS paginated endpoint.

```javascript
return await api.get("/fee-schedules/rvus", {
  release: "rvu26d", qp: "QP", limit: 500,
});
```

Use the returned archive URL and `expected_archive_sha256` for continuation, keeping
the same release and QP category. A changed hash returns 409; the guard cannot retrieve
an older version. `next_offset: null` ends the remaining slice, while `complete` is true
only when this response includes the entire member. Successful staging does not mark
a page complete. After staging, inspect the schema and query `pfs_rvu_rows`, quoting
names such as `"CONV FACTOR"`, `"HCPCS"` and `"MOD"`.

Column labels join the nonempty native header cells vertically with spaces. Original
`header_rows`, preamble, source notices and all selected cells remain intact. No rows
are deduplicated and no payment or clinician eligibility is calculated. Missing QP
codes are not zero payments or implied non-QP equivalents. RVU source notices include
AMA/ADA copyright terms; citations no longer label all CMS Pricing output public domain.
The included guide retains older generic conversion-factor wording; explicit member
identity and native values govern these reads.

Archive reads reject unsupported layouts, ZIP64, encryption, duplicate/unsafe member
names, invalid member bounds, oversized contents and failed size/CRC32 checks. The ZIP
limit is 16 MiB, the selected uncompressed-member limit is 16 MiB, and each network read
has a 15-second fetch/body deadline. Archive/member SHA-256 values are computed from
retrieved bytes; no provider-published SHA-256 is claimed. Native HTTP error bodies,
status and retry guidance survive errors. Complete MCP responses over 30 KiB stage,
including escaped SQL, and all success/error tool paths carry verifiable citations.

These read operations do not promote a generation. Authenticated administrators can
explicitly ingest a qualified archive as described below. No production configuration
or deployment changed.

## Explicit quarterly archive ingestion

`POST /ingest` retains its existing bearer authentication (`CMS_INGEST_TOKEN`) and
required `Idempotency-Key`. An empty body or `{}` refreshes only the configured legacy
CSVs. To ingest a quarterly release, send this JSON body after archive discovery:

```json
{
  "archive": {
    "release": "rvu26d",
    "expected_archive_sha256": "521ff0f4ecbf13b5d99dc1dc04d9f82e5361e55c6b4b6b3033043598bf8406e6"
  }
}
```

The hash above identifies the October 3 observed bytes; rediscover before selecting a
changed archive. `archive_url` selects one of multiple linked ZIPs and
`expected_page_sha256` optionally guards the release page. The request body is limited
to 4 KiB and a 10-second read deadline. Selection requires a 2026 release, an archive
hash, and exactly the six recognized CSV layouts; other years/layouts fail explicitly.
Only RVU26D has native end-to-end acceptance so far.

The stable handle **`__fee_schedule_archive`** resolves to the last successful archive
generation. **`__fee_schedules`** continues to resolve the configured CSV refresh;
scheduled or manual legacy refreshes cannot replace the quarterly selection. Both
query/schema tool aliases support these handles, and schema discovery lists populated
handles. Inspect `fee_schedule_sources` before combining data from different handles.

| Archive table | RVU26D source rows | Data rows | Notes/blank rows |
| --- | ---: | ---: | ---: |
| `pfs_rvu_qp` | 11,978 | 11,978 | 0 |
| `pfs_rvu_non_qp` | 19,453 | 19,453 | 0 |
| `pfs_gpci` | 118 | 109 | 9 |
| `pfs_locality_counties` | 168 | 110 | 58 |
| `pfs_opps_caps` | 16,101 | 15,260 | 841 |
| `pfs_anesthesia` | 112 | 109 | 3 |

Native columns remain TEXT, including leading/trailing spaces, identifiers and decimal
strings. `source_csv_row` is the one-based CSV record position (quoted embedded newlines
are part of one record). `source_row_kind` distinguishes `data`, `note` and `blank` using
the source identifier shape. Original supporting-table names and typos remain; the
unnamed sixth locality column is `unnamed_column_6`. Empty continuation-state cells
are preserved without forward-filling. Anesthesia retains its separate qualifying and
non-qualifying APM columns. These classifications do not calculate eligibility or payments.

`fee_schedule_sources` records each table's member/hash/CRC verification, original
header matrix and preamble, native columns, row counts, category, release and dates.
`fee_schedule_csv_chunks` stores exact UTF-8 CSV text, including any BOM; concatenate
`csv_text_chunk` in `chunk_index` order for one `source_member` to recover it.
`fee_schedule_archive_metadata` retains the full 19-member manifest and archive/page
evidence. Alternative TXT/XLSX/PDF files are inventoried, not separately ingested.

All six tables, raw CSV chunks and source evidence stage in an isolated attempt before
atomic promotion. Each table must report the complete expected row count. Failure
retains the active generation. Concurrent requests return `in_progress` (HTTP 409);
a completed key replays its recorded result. Reusing a running/completed key with a
changed source selection returns 409. Attempts have separate generation IDs and
20-minute leases; expired attempts cannot promote or fail their successors.

Native local acceptance compared **47,930 stored rows / 1,120,893 source cells** against
an independent Python parser, and recovered all **4,825,748 CSV bytes** with matching
hashes. Both aliases passed schema/query/citation checks, including staged responses.
Concurrent loads, replay, changed selection, failed hash checks and a subsequent legacy
refresh passed through the actual local HTTP endpoint. Deployment remains pending.

## Development

```bash
./scripts/dev-servers.sh cms-pricing            # run locally (port 8866)
pnpm --filter cms-pricing-mcp-server run deploy   # deploy to Cloudflare Workers
```

See [`docs/adding-mcp-servers.md`](../../docs/adding-mcp-servers.md) and the root [README](../../README.md) for the full architecture (Code Mode, staging, portals).

---

*Auto-generated baseline README — refine with server-specific detail as needed.*

<!-- license-and-data-terms:start -->
## License and data terms

The code in this repository is licensed under the Apache License 2.0 (see `LICENSE`).
If you use it in your work, please cite it (see `CITATION.cff`). Citation is requested, not required.

The license covers the code only. Data that this server returns comes from CMS fee schedules and stays under the terms of that source: Contain AMA-copyrighted CPT; commercial use needs an AMA license.
You are responsible for your use of the data under those terms.
<!-- license-and-data-terms:end -->
