/**
 * The build stamp shown in Settings > About and Updates (AC-WIN-1): the installed
 * version, the commit it was built from and the update channel it follows. Every
 * part is optional; a run with none of them (a browser dev session) is labelled
 * "developer build" rather than given an invented version. Types: see
 * build-stamp.d.mts.
 */

/** The fallback label when the host supplies no version. */
export const DEVELOPER_BUILD = "developer build";

/**
 * Format a build stamp, e.g. "1.0.0-beta.3 · beta · a1b2c3d".
 *
 * @param {{ appVersion?: string, channel?: string, buildCommit?: string }} info
 * @returns {string}
 */
export function buildStamp(info) {
  const version = info.appVersion?.trim() || DEVELOPER_BUILD;
  const parts = [version];
  const channel = info.channel?.trim();
  if (channel) {
    parts.push(channel);
  }
  const commit = info.buildCommit?.trim();
  if (commit) {
    parts.push(commit.slice(0, 7));
  }
  return parts.join(" · ");
}
