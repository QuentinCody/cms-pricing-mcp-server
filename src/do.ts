import { RestStagingDO } from "@bio-mcp/shared/staging/rest-staging-do";
import type { SchemaHints } from "@bio-mcp/shared/staging/schema-inference";
import {
	beginIngest,
	type CompletedIngest,
	failIngest,
	INGEST_COMPLETED_PREFIX,
	INGEST_CONTROL_KEY,
	type IngestControlState,
	promoteIngest,
} from "./lib/ingest-control";

interface BeginRequest {
	idempotencyKeyHash: string;
	requestHash?: string;
	generation: string;
	now: number;
}

interface FailRequest {
	idempotencyKeyHash: string;
	generation: string;
	failedAt: number;
	error: string;
}

export class CmsPricingDataDO extends RestStagingDO {
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === "/ingest/status" && request.method === "GET") {
			const state =
				(await this.ctx.storage.get<IngestControlState>(INGEST_CONTROL_KEY)) ??
				{};
			return Response.json({ success: true, ...state });
		}
		if (url.pathname === "/ingest/begin" && request.method === "POST") {
			return this.begin(request);
		}
		if (url.pathname === "/ingest/promote" && request.method === "POST") {
			return this.promote(request);
		}
		if (url.pathname === "/ingest/fail" && request.method === "POST") {
			return this.fail(request);
		}
		return super.fetch(request);
	}

	private async begin(request: Request): Promise<Response> {
		const body = (await request.json()) as BeginRequest;
		if (!body.idempotencyKeyHash || !body.generation || !Number.isFinite(body.now)) {
			return Response.json({ success: false, error: "Invalid begin request" }, { status: 400 });
		}

		const decision = await this.ctx.storage.transaction(async (txn) => {
			const state =
				(await txn.get<IngestControlState>(INGEST_CONTROL_KEY)) ?? {};
			const completed = await txn.get<CompletedIngest>(
				`${INGEST_COMPLETED_PREFIX}${body.idempotencyKeyHash}`,
			);
			const next = beginIngest(state, completed, body);
			if (next.status === "acquired") {
				await txn.put(INGEST_CONTROL_KEY, next.state);
			}
			return next;
		});
		return Response.json({ success: decision.status !== "conflict", ...decision }, { status: decision.status === "conflict" ? 409 : 200 });
	}

	private async promote(request: Request): Promise<Response> {
		const completed = (await request.json()) as CompletedIngest;
		try {
			const state = await this.ctx.storage.transaction(async (txn) => {
				const current =
					(await txn.get<IngestControlState>(INGEST_CONTROL_KEY)) ?? {};
				const next = promoteIngest(current, completed);
				await txn.put(INGEST_CONTROL_KEY, next);
				await txn.put(
					`${INGEST_COMPLETED_PREFIX}${completed.idempotencyKeyHash}`,
					completed,
				);
				return next;
			});
			return Response.json({ success: true, state });
		} catch (error) {
			return Response.json(
				{ success: false, error: error instanceof Error ? error.message : String(error) },
				{ status: 409 },
			);
		}
	}

	private async fail(request: Request): Promise<Response> {
		const body = (await request.json()) as FailRequest;
		const state = await this.ctx.storage.transaction(async (txn) => {
			const current =
				(await txn.get<IngestControlState>(INGEST_CONTROL_KEY)) ?? {};
			const next = failIngest(current, body);
			await txn.put(INGEST_CONTROL_KEY, next);
			return next;
		});
		return Response.json({ success: true, state });
	}

    protected getSchemaHints(data: unknown): SchemaHints | undefined {
        if (data && typeof data === "object" && "table_kind" in data && data.table_kind === "pfs_rvu_rows" && "records" in data && Array.isArray(data.records)) {
            const row = data.records[0];
            return { tableName: "pfs_rvu_rows", indexes: ["HCPCS", "MOD"], columnTypes: Object.fromEntries(Object.keys(row ?? {}).map(key => [key, "TEXT"])) };
        }
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

        // HCPCS/RBCS code reference (check before other HCPCS branches — RBCS has RBCS_Id)
        if ("HCPCS_Cd" in sample && "RBCS_Id" in sample) {
            return {
                tableName: "hcpcs_rbcs",
                indexes: ["HCPCS_Cd", "RBCS_Cat", "RBCS_Cat_Subcat", "RBCS_Major_Ind"],
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
