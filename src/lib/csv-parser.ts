/**
 * Lightweight CSV parser — converts CSV text to an array of objects.
 * Handles quoted fields, embedded commas, and newlines within quotes.
 * Numeric values are auto-cast to numbers.
 * No external dependencies.
 */
export function parseCsv(text: string): Record<string, unknown>[] {
    const rows: string[][] = [];
    let current: string[] = [];
    let field = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];

        if (inQuotes) {
            if (ch === '"') {
                if (i + 1 < text.length && text[i + 1] === '"') {
                    field += '"';
                    i++; // skip escaped quote
                } else {
                    inQuotes = false;
                }
            } else {
                field += ch;
            }
        } else if (ch === '"') {
            inQuotes = true;
        } else if (ch === ",") {
            current.push(field.trim());
            field = "";
        } else if (ch === "\n" || (ch === "\r" && text[i + 1] === "\n")) {
            current.push(field.trim());
            field = "";
            if (current.some((f) => f !== "")) rows.push(current);
            current = [];
            if (ch === "\r") i++; // skip \r in \r\n
        } else {
            field += ch;
        }
    }
    // Last field/row
    if (field || current.length > 0) {
        current.push(field.trim());
        if (current.some((f) => f !== "")) rows.push(current);
    }

    if (rows.length < 2) return [];

    const headers = rows[0];

    // Detect numeric columns by sampling the first 100 data rows
    const sampleSize = Math.min(100, rows.length - 1);
    const numericColumns = new Set<number>();
    for (let col = 0; col < headers.length; col++) {
        let numericCount = 0;
        let nonEmptyCount = 0;
        for (let row = 1; row <= sampleSize; row++) {
            const val = rows[row]?.[col]?.trim() ?? "";
            if (val === "") continue;
            nonEmptyCount++;
            if (isNumericString(val)) numericCount++;
        }
        // Column is numeric if >75% of non-empty sampled values are numbers
        if (nonEmptyCount > 0 && numericCount / nonEmptyCount > 0.75) {
            numericColumns.add(col);
        }
    }

    return rows.slice(1).map((row) => {
        const obj: Record<string, unknown> = {};
        for (let i = 0; i < headers.length; i++) {
            const raw = row[i] ?? "";
            if (numericColumns.has(i) && raw !== "") {
                const num = Number(raw);
                obj[headers[i]] = Number.isFinite(num) ? num : raw;
            } else {
                obj[headers[i]] = raw;
            }
        }
        return obj;
    });
}

/** Check if a string looks like a number (integer, decimal, negative, scientific) */
function isNumericString(s: string): boolean {
    if (s === "") return false;
    // Reject strings that look like codes/identifiers (leading zeros, except "0" and "0.xxx")
    if (s.length > 1 && s[0] === "0" && s[1] !== ".") return false;
    return /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s);
}
