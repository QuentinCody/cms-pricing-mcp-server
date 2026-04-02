import type { ApiCatalog } from "@bio-mcp/shared/codemode/catalog";

/**
 * Dataset UUID lookup — maps friendly path aliases to Data.CMS.gov dataset UUIDs.
 * Used by api-adapter.ts to route Code Mode api.get() calls.
 */
export const DATASET_MAP: Record<string, string> = {
    // Inpatient (DRG-based)
    "inpatient/by-provider-service": "690ddc6c-2767-4618-b277-420ffb2bf27c",
    "inpatient/by-geography-service": "2941ab09-8cee-49d8-9703-f3c5b854e388",
    // Outpatient (APC-based)
    "outpatient/by-provider-service": "ccbc9a44-40d4-46b4-a709-5caa59212e50",
    "outpatient/by-geography-service": "04baec39-4a54-400e-824d-8e75251ceda9",
    // Physician & Other Practitioners (HCPCS-based)
    "physician/by-provider-service": "92396110-2aed-4d63-a6a2-5d6207d46a29",
    "physician/by-provider": "8889d81e-2ee7-448f-8713-f071038289b5",
    "physician/by-geography-service": "6fea9d79-0129-4e4c-b1b8-23cd86a4f435",
    // Physician/Supplier Procedure Summary
    "procedure-summary": "164fc736-4179-4100-9f79-592b69e41975",
    // DMEPOS (Durable Medical Equipment)
    "dmepos/by-supplier-service": "1746a83e-bb65-4300-8e02-21edbab77c6b",
    "dmepos/by-geography-service": "27c150fd-8578-43b1-bba5-6388987e32af",
    // Clinical Lab
    "lab/payer-rates": "0e57f57d-0acc-4c9c-8f8c-973e3f4a3c4b",
    // Drug Spending
    "drug-spending/part-b": "76a714ad-3a2c-43ac-b76d-9dadf8f7d890",
    "drug-spending/part-b-quarterly": "bf6a5b3b-31ee-4abb-b1ad-2607a1e7510a",
    "drug-spending/part-d": "7e0b4365-fd63-4a29-8f5e-e0ac9f66a81b",
    // Geographic Variation
    "geographic-variation": "6219697b-8f6c-4164-bed4-cd9317c58ebc",
    // HCPCS Code Reference (RBCS — Restructured BETOS Classification System)
    "hcpcs/codes": "e3db6e56-149f-49ce-b374-40aecda2357b",
};

export const cmsPricingCatalog: ApiCatalog = {
    name: "CMS Medicare Pricing Data",
    baseUrl: "https://data.cms.gov",
    version: "2024",
    auth: "none",
    endpointCount: 33,
    notes:
        "- All data from Data.CMS.gov Data API — free, no auth required\n" +
        "- API pattern: GET /data-api/v1/dataset/{uuid}/data with query params\n" +
        "- Friendly paths are mapped to UUIDs by the adapter (e.g. /inpatient/by-provider-service)\n" +
        "- Filtering: pass filter[ColumnName]=value as query params (brackets required)\n" +
        "- Keyword search: pass keyword=term for full-text search across all fields\n" +
        "- Pagination: size=N (max 5000, default 1000), offset=N\n" +
        "- Sorting: sort=ColumnName (prefix with - for descending)\n" +
        "- Column selection: column=Col1,Col2,Col3\n" +
        "- Append /stats to any data endpoint to get {found_rows, total_rows}\n" +
        "- Code systems: MS-DRG (inpatient), APC (outpatient), HCPCS (physician/DMEPOS/lab). Use /hcpcs/codes to look up or classify any HCPCS/CPT code via the RBCS taxonomy.\n" +
        "- All payment amounts are in USD\n" +
        "- BUILT-IN FEE SCHEDULES: Pre-loaded SQLite tables are available via cms_pricing_query_data with data_access_id='__fee_schedules':\n" +
        "  - pfs_indicators: Physician Fee Schedule (31K rows) — hcpc, modifier, sdesc, rvu_work, rvu_mp, conv_fact, full_nfac_total, full_fac_total\n" +
        "  - pfs_localities: Geographic Practice Cost Indices (110 rows) — locality, loc_description, mac, mac_description, gpci_work, gpci_pe, gpci_mp\n" +
        "  - PFS has TWO rows per code (two conversion factors: transitional vs fully-implemented). Filter with conv_fact or use MAX/MIN.\n" +
        "  - JOIN pfs_indicators with pfs_localities to calculate geographically-adjusted payment: (rvu_work*gpci_work + pe_rvu*gpci_pe + rvu_mp*gpci_mp) * conv_fact\n" +
        "  - Use cms_pricing_get_schema with data_access_id='__fee_schedules' to see all columns and row counts\n" +
        "- /procedure-summary has CODES ONLY (no descriptions) — use pfs_indicators.sdesc or /physician datasets to look up code descriptions first\n" +
        "- Data updated annually (most datasets refresh Apr-Oct)",
    endpoints: [
        // --- Inpatient (MS-DRG) ---
        {
            method: "GET",
            path: "/inpatient/by-provider-service",
            summary:
                "Medicare inpatient hospital data by provider and DRG. Shows avg submitted charges, total payments, and Medicare payments per hospital per DRG code. 146K rows.",
            category: "inpatient",
            queryParams: [
                { name: "filter[DRG_Cd]", type: "string", required: false, description: "Filter by MS-DRG code (e.g. '470' for hip/knee replacement)" },
                { name: "filter[Rndrng_Prvdr_State_Abrvtn]", type: "string", required: false, description: "Filter by state abbreviation (e.g. 'CA', 'NY')" },
                { name: "filter[Rndrng_Prvdr_Zip5]", type: "string", required: false, description: "Filter by 5-digit zip code" },
                { name: "keyword", type: "string", required: false, description: "Full-text keyword search across all fields" },
                { name: "size", type: "number", required: false, description: "Max results per page (max 5000, default 1000)" },
                { name: "offset", type: "number", required: false, description: "Pagination offset" },
                { name: "sort", type: "string", required: false, description: "Sort column (prefix - for desc, e.g. -Avg_Tot_Pymt_Amt)" },
                { name: "column", type: "string", required: false, description: "Comma-separated column names to include" },
            ],
        },
        {
            method: "GET",
            path: "/inpatient/by-provider-service/stats",
            summary: "Row count stats for Medicare inpatient by provider/service dataset",
            category: "inpatient",
        },
        {
            method: "GET",
            path: "/inpatient/by-geography-service",
            summary:
                "Medicare inpatient hospital data aggregated by geography (state/national) and DRG. Shows aggregate charges and payments without individual provider detail.",
            category: "inpatient",
            queryParams: [
                { name: "filter[DRG_Cd]", type: "string", required: false, description: "Filter by MS-DRG code" },
                { name: "filter[Rndrng_Prvdr_Geo_Lvl]", type: "string", required: false, description: "Geography level (State or National)" },
                { name: "filter[Rndrng_Prvdr_Geo_Desc]", type: "string", required: false, description: "Geography description (e.g. state name)" },
                { name: "keyword", type: "string", required: false, description: "Full-text keyword search" },
                { name: "size", type: "number", required: false, description: "Max results (max 5000)" },
                { name: "offset", type: "number", required: false, description: "Pagination offset" },
            ],
        },
        {
            method: "GET",
            path: "/inpatient/by-geography-service/stats",
            summary: "Row count stats for Medicare inpatient by geography/service dataset",
            category: "inpatient",
        },

        // --- Outpatient (APC) ---
        {
            method: "GET",
            path: "/outpatient/by-provider-service",
            summary:
                "Medicare outpatient hospital data by provider and APC. Shows avg submitted charges, allowed amounts, and Medicare payments per hospital per APC code. 117K rows.",
            category: "outpatient",
            queryParams: [
                { name: "filter[APC_Cd]", type: "string", required: false, description: "Filter by APC code (e.g. '5072')" },
                { name: "filter[Rndrng_Prvdr_State_Abrvtn]", type: "string", required: false, description: "Filter by state abbreviation" },
                { name: "filter[Rndrng_Prvdr_Zip5]", type: "string", required: false, description: "Filter by 5-digit zip code" },
                { name: "keyword", type: "string", required: false, description: "Full-text keyword search" },
                { name: "size", type: "number", required: false, description: "Max results (max 5000)" },
                { name: "offset", type: "number", required: false, description: "Pagination offset" },
                { name: "sort", type: "string", required: false, description: "Sort column" },
            ],
        },
        {
            method: "GET",
            path: "/outpatient/by-provider-service/stats",
            summary: "Row count stats for Medicare outpatient by provider/service dataset",
            category: "outpatient",
        },
        {
            method: "GET",
            path: "/outpatient/by-geography-service",
            summary: "Medicare outpatient hospital data aggregated by geography and APC.",
            category: "outpatient",
            queryParams: [
                { name: "filter[APC_Cd]", type: "string", required: false, description: "Filter by APC code" },
                { name: "keyword", type: "string", required: false, description: "Full-text keyword search" },
                { name: "size", type: "number", required: false, description: "Max results (max 5000)" },
                { name: "offset", type: "number", required: false, description: "Pagination offset" },
            ],
        },
        {
            method: "GET",
            path: "/outpatient/by-geography-service/stats",
            summary: "Row count stats for Medicare outpatient by geography/service dataset",
            category: "outpatient",
        },

        // --- Physician & Other Practitioners (HCPCS) ---
        {
            method: "GET",
            path: "/physician/by-provider-service",
            summary:
                "Medicare physician utilization and payment by provider and HCPCS code. 9.66M rows. Fields: NPI, provider name/credentials/specialty, HCPCS code/description, place of service (F/O), beneficiaries, services, avg submitted charge, avg Medicare allowed/payment/standardized amounts.",
            category: "physician",
            queryParams: [
                { name: "filter[HCPCS_Cd]", type: "string", required: false, description: "Filter by HCPCS/CPT code (e.g. '99213' for office visit)" },
                { name: "filter[Rndrng_NPI]", type: "string", required: false, description: "Filter by provider NPI" },
                { name: "filter[Rndrng_Prvdr_Type]", type: "string", required: false, description: "Filter by provider specialty (e.g. 'Cardiology')" },
                { name: "filter[Rndrng_Prvdr_State_Abrvtn]", type: "string", required: false, description: "Filter by state abbreviation" },
                { name: "filter[Place_Of_Srvc]", type: "string", required: false, description: "Filter by place of service: F=Facility, O=Office" },
                { name: "keyword", type: "string", required: false, description: "Full-text keyword search" },
                { name: "size", type: "number", required: false, description: "Max results (max 5000)" },
                { name: "offset", type: "number", required: false, description: "Pagination offset" },
                { name: "sort", type: "string", required: false, description: "Sort column" },
                { name: "column", type: "string", required: false, description: "Comma-separated columns to return" },
            ],
        },
        {
            method: "GET",
            path: "/physician/by-provider-service/stats",
            summary: "Row count stats for Medicare physician by provider/service dataset (9.66M rows)",
            category: "physician",
        },
        {
            method: "GET",
            path: "/physician/by-provider",
            summary:
                "Medicare physician data aggregated per provider (no service breakdown). Shows total services, beneficiaries, and payments per NPI. ~1.2M rows.",
            category: "physician",
            queryParams: [
                { name: "filter[Rndrng_NPI]", type: "string", required: false, description: "Filter by provider NPI" },
                { name: "filter[Rndrng_Prvdr_Type]", type: "string", required: false, description: "Filter by specialty" },
                { name: "filter[Rndrng_Prvdr_State_Abrvtn]", type: "string", required: false, description: "Filter by state" },
                { name: "keyword", type: "string", required: false, description: "Full-text keyword search" },
                { name: "size", type: "number", required: false, description: "Max results (max 5000)" },
                { name: "offset", type: "number", required: false, description: "Pagination offset" },
            ],
        },
        {
            method: "GET",
            path: "/physician/by-provider/stats",
            summary: "Row count stats for Medicare physician by provider dataset",
            category: "physician",
        },
        {
            method: "GET",
            path: "/physician/by-geography-service",
            summary:
                "Medicare physician data aggregated by geography and HCPCS code. Shows avg charges/payments by state or national level per procedure. ~600K rows.",
            category: "physician",
            queryParams: [
                { name: "filter[HCPCS_Cd]", type: "string", required: false, description: "Filter by HCPCS code" },
                { name: "filter[Rndrng_Prvdr_Geo_Lvl]", type: "string", required: false, description: "Geography level" },
                { name: "filter[Rndrng_Prvdr_Geo_Desc]", type: "string", required: false, description: "Geography description (state name)" },
                { name: "keyword", type: "string", required: false, description: "Full-text keyword search" },
                { name: "size", type: "number", required: false, description: "Max results (max 5000)" },
                { name: "offset", type: "number", required: false, description: "Pagination offset" },
            ],
        },
        {
            method: "GET",
            path: "/physician/by-geography-service/stats",
            summary: "Row count stats for Medicare physician by geography/service dataset",
            category: "physician",
        },

        // --- Procedure Summary ---
        {
            method: "GET",
            path: "/procedure-summary",
            summary:
                "Physician/Supplier Procedure Summary — aggregate statistics across all providers per HCPCS code. 14.3M rows.",
            category: "procedure",
            queryParams: [
                { name: "keyword", type: "string", required: false, description: "Full-text keyword search" },
                { name: "size", type: "number", required: false, description: "Max results (max 5000)" },
                { name: "offset", type: "number", required: false, description: "Pagination offset" },
            ],
        },
        {
            method: "GET",
            path: "/procedure-summary/stats",
            summary: "Row count stats for Procedure Summary dataset (14.3M rows)",
            category: "procedure",
        },

        // --- DMEPOS ---
        {
            method: "GET",
            path: "/dmepos/by-supplier-service",
            summary:
                "Medicare DME data by supplier and HCPCS code. 464K rows. Shows equipment/supply utilization and payment amounts per supplier.",
            category: "dmepos",
            queryParams: [
                { name: "filter[HCPCS_Cd]", type: "string", required: false, description: "Filter by HCPCS code" },
                { name: "filter[Suplr_State_Abrvtn]", type: "string", required: false, description: "Filter by state" },
                { name: "keyword", type: "string", required: false, description: "Full-text keyword search" },
                { name: "size", type: "number", required: false, description: "Max results (max 5000)" },
                { name: "offset", type: "number", required: false, description: "Pagination offset" },
            ],
        },
        {
            method: "GET",
            path: "/dmepos/by-supplier-service/stats",
            summary: "Row count stats for DMEPOS by supplier/service dataset",
            category: "dmepos",
        },
        {
            method: "GET",
            path: "/dmepos/by-geography-service",
            summary: "Medicare DME data aggregated by geography and HCPCS code.",
            category: "dmepos",
            queryParams: [
                { name: "keyword", type: "string", required: false, description: "Full-text keyword search" },
                { name: "size", type: "number", required: false, description: "Max results (max 5000)" },
                { name: "offset", type: "number", required: false, description: "Pagination offset" },
            ],
        },
        {
            method: "GET",
            path: "/dmepos/by-geography-service/stats",
            summary: "Row count stats for DMEPOS by geography/service dataset",
            category: "dmepos",
        },

        // --- Clinical Lab ---
        {
            method: "GET",
            path: "/lab/payer-rates",
            summary:
                "Clinical Laboratory Fee Schedule private payer rates and volumes. 967K rows. Used to calculate CLFS payment rates under PAMA.",
            category: "lab",
            queryParams: [
                { name: "filter[hcpcs_cd]", type: "string", required: false, description: "Filter by HCPCS code" },
                { name: "keyword", type: "string", required: false, description: "Full-text keyword search" },
                { name: "size", type: "number", required: false, description: "Max results (max 5000)" },
                { name: "offset", type: "number", required: false, description: "Pagination offset" },
            ],
        },
        {
            method: "GET",
            path: "/lab/payer-rates/stats",
            summary: "Row count stats for Clinical Lab payer rates dataset",
            category: "lab",
        },

        // --- Drug Spending ---
        {
            method: "GET",
            path: "/drug-spending/part-b",
            summary:
                "Medicare Part B drug spending by drug — annual totals with HCPCS codes, total spending, beneficiary counts, and units.",
            category: "drug_spending",
            queryParams: [
                { name: "keyword", type: "string", required: false, description: "Full-text keyword search (drug name)" },
                { name: "size", type: "number", required: false, description: "Max results (max 5000)" },
                { name: "offset", type: "number", required: false, description: "Pagination offset" },
            ],
        },
        {
            method: "GET",
            path: "/drug-spending/part-b-quarterly",
            summary: "Medicare Part B drug spending — quarterly breakdown for trend analysis.",
            category: "drug_spending",
            queryParams: [
                { name: "keyword", type: "string", required: false, description: "Full-text keyword search" },
                { name: "size", type: "number", required: false, description: "Max results (max 5000)" },
                { name: "offset", type: "number", required: false, description: "Pagination offset" },
            ],
        },
        {
            method: "GET",
            path: "/drug-spending/part-d",
            summary: "Medicare Part D drug spending by drug — brand name, generic name, manufacturer, total spending, claims, beneficiaries.",
            category: "drug_spending",
            queryParams: [
                { name: "keyword", type: "string", required: false, description: "Full-text keyword search" },
                { name: "size", type: "number", required: false, description: "Max results (max 5000)" },
                { name: "offset", type: "number", required: false, description: "Pagination offset" },
            ],
        },

        // --- Geographic Variation ---
        {
            method: "GET",
            path: "/geographic-variation",
            summary:
                "Medicare geographic variation — per-capita spending by state and county. Shows utilization rates and payment amounts across geographic areas. ~30K rows.",
            category: "geographic",
            queryParams: [
                { name: "keyword", type: "string", required: false, description: "Full-text keyword search" },
                { name: "size", type: "number", required: false, description: "Max results (max 5000)" },
                { name: "offset", type: "number", required: false, description: "Pagination offset" },
            ],
        },
        {
            method: "GET",
            path: "/geographic-variation/stats",
            summary: "Row count stats for geographic variation dataset",
            category: "geographic",
        },

        // --- HCPCS Code Reference (RBCS Classification) ---
        {
            method: "GET",
            path: "/hcpcs/codes",
            summary:
                "HCPCS code reference via the Restructured BETOS Classification System (RBCS). 18.9K rows. " +
                "Maps every HCPCS/CPT code to clinical categories and subcategories. " +
                "Fields: HCPCS_Cd, RBCS_Cat, RBCS_Cat_Desc (e.g. Evaluation & Management, Procedures, Imaging), " +
                "RBCS_Cat_Subcat, RBCS_Subcat_Desc, RBCS_FamNumb, RBCS_Family_Desc, RBCS_Major_Ind (Y/N), " +
                "HCPCS_Cd_Add_Dt, HCPCS_Cd_End_Dt. Use to classify or look up any HCPCS/CPT code.",
            category: "hcpcs",
            queryParams: [
                { name: "filter[HCPCS_Cd]", type: "string", required: false, description: "Filter by exact HCPCS/CPT code (e.g. '99213', 'J9035', 'A4253')" },
                { name: "filter[RBCS_Cat]", type: "string", required: false, description: "Filter by RBCS category letter (A=Anesthesia, E=Evaluation & Management, P=Procedures, I=Imaging, T=Tests, D=DME, O=Other, M=Exceptions/Unclassified)" },
                { name: "filter[RBCS_Cat_Desc]", type: "string", required: false, description: "Filter by category description (e.g. 'Procedures', 'Imaging')" },
                { name: "filter[RBCS_Cat_Subcat]", type: "string", required: false, description: "Filter by subcategory code (e.g. 'PM' for Major Procedures)" },
                { name: "filter[RBCS_Major_Ind]", type: "string", required: false, description: "Filter by major procedure indicator: Y or N" },
                { name: "keyword", type: "string", required: false, description: "Full-text keyword search across all fields" },
                { name: "size", type: "number", required: false, description: "Max results per page (max 5000, default 1000)" },
                { name: "offset", type: "number", required: false, description: "Pagination offset" },
                { name: "sort", type: "string", required: false, description: "Sort column (prefix - for desc)" },
                { name: "column", type: "string", required: false, description: "Comma-separated column names to include" },
            ],
        },
        {
            method: "GET",
            path: "/hcpcs/codes/stats",
            summary: "Row count stats for HCPCS/RBCS code reference dataset (18.9K rows)",
            category: "hcpcs",
        },
    ],
};
