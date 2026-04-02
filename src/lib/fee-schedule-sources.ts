/**
 * Manifest of CMS fee schedule CSV sources.
 * Each entry defines a remote CSV URL, the well-known DO data_access_id,
 * and the target table name within that DO's SQLite.
 */

export interface FeeScheduleSource {
    /** Identifier for this dataset */
    key: string;
    /** Human-readable name */
    name: string;
    /** Direct download URL for the CSV */
    url: string;
    /** Table name in the well-known DO */
    tableName: string;
    /** Expected update schedule */
    schedule: "annual" | "quarterly";
    /** Approximate year/quarter this URL covers */
    period: string;
}

/** Well-known data_access_id used by the cron to stage fee schedules */
export const FEE_SCHEDULE_DO_ID = "__fee_schedules";

export const FEE_SCHEDULE_SOURCES: FeeScheduleSource[] = [
    {
        key: "pfs-indicators",
        name: "Physician Fee Schedule — Indicators (RVUs, Payment Rates)",
        url: "https://pfs.data.cms.gov/sites/default/files/data/indicators2026-02-10-2026.csv",
        tableName: "pfs_indicators",
        schedule: "annual",
        period: "2026",
    },
    {
        key: "pfs-localities",
        name: "Physician Fee Schedule — Localities (GPCIs)",
        url: "https://pfs.data.cms.gov/sites/default/files/data/localities2026.csv",
        tableName: "pfs_localities",
        schedule: "annual",
        period: "2026",
    },
];
