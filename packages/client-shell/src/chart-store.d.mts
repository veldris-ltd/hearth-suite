/** Serialise a chart-source entry (key + data) for a "chart" vault document. */
export function serializeChartEntry(key: string, data: unknown): string;

/** Parse a "chart" document body into `{ key, data }`, or null if malformed. */
export function parseChartEntry(json: string): { key: string; data: unknown } | null;
