/** The fallback label when the host supplies no version. */
export const DEVELOPER_BUILD: string;

/** Format a build stamp, e.g. "1.0.0-beta.3 · beta · a1b2c3d" (AC-WIN-1). */
export function buildStamp(info: {
  appVersion?: string;
  channel?: string;
  buildCommit?: string;
}): string;
