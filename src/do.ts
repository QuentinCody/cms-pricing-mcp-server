import { RestStagingDO } from "@bio-mcp/shared/staging/rest-staging-do";
import type { SchemaHints } from "@bio-mcp/shared/staging/schema-inference";

export class CmsPricingDataDO extends RestStagingDO {
    protected getSchemaHints(data: unknown): SchemaHints | undefined {
        if (!data || !Array.isArray(data)) return undefined;

        const sample = data[0];
        if (!sample || typeof sample !== "object") return undefined;

        // Inpatient hospital data (DRG-based)
        if ("DRG_Cd" in sample) {
            return {
                tableName: "inpatient_drg",
                indexes: ["DRG_Cd", "Rndrng_Prvdr_State_Abrvtn", "Rndrng_Prvdr_CCN"],
            };
        }

        // Outpatient hospital data (APC-based)
        if ("APC_Cd" in sample) {
            return {
                tableName: "outpatient_apc",
                indexes: ["APC_Cd", "Rndrng_Prvdr_State_Abrvtn", "Rndrng_Prvdr_CCN"],
            };
        }

        // Physician data with HCPCS + NPI
        if ("HCPCS_Cd" in sample && "Rndrng_NPI" in sample) {
            return {
                tableName: "physician_services",
                indexes: ["HCPCS_Cd", "Rndrng_NPI", "Rndrng_Prvdr_Type", "Rndrng_Prvdr_State_Abrvtn"],
            };
        }

        // Physician data without NPI (geography aggregation)
        if ("HCPCS_Cd" in sample && !("Rndrng_NPI" in sample)) {
            return {
                tableName: "physician_geography",
                indexes: ["HCPCS_Cd", "Rndrng_Prvdr_Geo_Desc"],
            };
        }

        // DMEPOS data
        if ("HCPCS_Cd" in sample && "Suplr_NPI" in sample) {
            return {
                tableName: "dmepos_services",
                indexes: ["HCPCS_Cd", "Suplr_NPI", "Suplr_State_Abrvtn"],
            };
        }

        // Clinical lab payer rates
        if ("hcpcs_cd" in sample && "PRICE_AMT" in sample) {
            return {
                tableName: "lab_payer_rates",
                indexes: ["hcpcs_cd"],
            };
        }

        // Drug spending
        if ("Brnd_Name" in sample || "Gnrc_Name" in sample) {
            return {
                tableName: "drug_spending",
                indexes: ["Brnd_Name", "Gnrc_Name"],
            };
        }

        // Geographic variation
        if ("Bene_Geo_Lvl" in sample || "IP_Cvrd_Days_Per_1000_Benes" in sample) {
            return {
                tableName: "geographic_variation",
                indexes: ["Bene_Geo_Desc", "Bene_Geo_Lvl"],
            };
        }

        return undefined;
    }
}
