/**
 * A dev-only, in-browser mock of the Admin API, so the Hearth Suite Ops console can be
 * previewed without the `services/admin-cp` server (mirroring the desktop's
 * no-Tauri demo data). It is wired in only under `import.meta.env.DEV`; the
 * production path always uses the real, WebAuthn-gated {@link AdminApiClient}.
 *
 * The data is plainly synthetic and infrastructure-only, never user content,
 * and every payload still passes through the redaction guard.
 */

import { assertNoUserContent } from "./core.mjs";
import type {
  AdminApi,
  AuditEntry,
  BlobMeta,
  DashboardSnapshot,
  HealthSnapshot,
  KeyEvent,
  Operator,
  Quota,
  ReleaseRecord,
  Session,
} from "./api";

const DEMO_SESSION: Session = { operator: "demo.operator", role: "owner" };

/** A fixed clock so the demo is deterministic (no Date.now in the mock). */
const NOW = 1_749_470_400_000; // 2025-06-09T12:00:00Z, illustrative
const minutesAgo = (m: number): number => NOW - m * 60_000;
const daysAgo = (d: number): number => NOW - d * 86_400_000;

function guard<T>(value: T): T {
  assertNoUserContent(value);
  return value;
}

export const demoSession = DEMO_SESSION;

/** The dev-only mock. Resolves immediately with static, synthetic data. */
export class MockAdminApi implements AdminApi {
  dashboard(): Promise<DashboardSnapshot> {
    return Promise.resolve(
      guard<DashboardSnapshot>({
        stats: [
          {
            key: "uptime",
            label: "Relay uptime (30d)",
            value: "99.98%",
            delta: "+0.01%",
            tone: "ok",
            series: [99.9, 99.95, 99.92, 99.97, 99.98, 99.99, 99.98],
          },
          {
            key: "ciphertext",
            label: "Ciphertext stored",
            value: "2.4 TB",
            delta: "+38 GB",
            tone: "ok",
            series: [2.0, 2.1, 2.15, 2.22, 2.3, 2.36, 2.4],
          },
          {
            key: "adoption",
            label: "On latest version",
            value: "87%",
            delta: "+6%",
            tone: "ok",
            series: [62, 68, 73, 79, 81, 84, 87],
          },
          {
            key: "errors",
            label: "Error rate",
            value: "0.04%",
            delta: "-0.01%",
            tone: "warn",
            series: [0.06, 0.05, 0.07, 0.05, 0.05, 0.04, 0.04],
          },
        ],
        services: [
          { name: "sync-relay (eu-1)", p99_ms: 42, healthy: true },
          { name: "sync-relay (us-1)", p99_ms: 51, healthy: true },
          { name: "key-directory", p99_ms: 28, healthy: true },
          { name: "release-service", p99_ms: 73, healthy: true },
          { name: "observability", p99_ms: 19, healthy: true },
        ],
        alerts: [
          { at: minutesAgo(12), severity: "info", detail: "Release v42 promoted to stable." },
          {
            at: minutesAgo(95),
            severity: "warning",
            detail: "sync-relay (us-1) p99 briefly above 200 ms.",
          },
          {
            at: minutesAgo(240),
            severity: "info",
            detail: "Quota raised for eu-1 ciphertext store.",
          },
        ],
      }),
    );
  }

  health(): Promise<HealthSnapshot[]> {
    return Promise.resolve(
      guard<HealthSnapshot[]>([
        {
          service: "sync-relay",
          healthy: true,
          uptime_seconds: 2_592_000,
          requests_total: 18_204_113,
          error_rate_milli: 4,
          blobs_stored: 821_004,
          bytes_stored: 2_638_827_900_928,
        },
        {
          service: "key-directory",
          healthy: true,
          uptime_seconds: 2_592_000,
          requests_total: 902_551,
          error_rate_milli: 1,
          blobs_stored: 0,
          bytes_stored: 0,
        },
      ]),
    );
  }

  auditLog(): Promise<AuditEntry[]> {
    return Promise.resolve(
      guard<AuditEntry[]>([
        {
          seq: 4210,
          at: minutesAgo(12),
          actor: "demo.operator",
          action: "promote_channel",
          target: "release/v42",
          outcome: "allowed",
          hash: "9f2c…",
        },
        {
          seq: 4209,
          at: minutesAgo(310),
          actor: "ops.bryce",
          action: "manage_relay_quota",
          target: "relay/eu-1",
          outcome: "allowed",
          hash: "1ad7…",
        },
        {
          seq: 4208,
          at: minutesAgo(880),
          actor: "ops.lena",
          action: "revoke_key",
          target: "keydir/k-7781",
          outcome: "denied",
          hash: "c003…",
        },
      ]),
    );
  }

  relayQuota(): Promise<Quota> {
    return Promise.resolve(guard<Quota>({ max_bytes: 4_398_046_511_104, max_blobs: 1_000_000 }));
  }

  relayBlobs(): Promise<BlobMeta[]> {
    return Promise.resolve(
      guard<BlobMeta[]>([
        {
          id: "blob-7f3a",
          size_bytes: 4_194_304,
          ttl_seconds: 604_800,
          created_at: daysAgo(2),
          state: "active",
        },
        {
          id: "blob-2c91",
          size_bytes: 1_048_576,
          ttl_seconds: 0,
          created_at: daysAgo(9),
          state: "expired",
        },
        {
          id: "blob-aa10",
          size_bytes: 8_388_608,
          ttl_seconds: 259_200,
          created_at: daysAgo(1),
          state: "active",
        },
      ]),
    );
  }

  reclaimExpired(): Promise<{ reclaimed: number }> {
    return Promise.resolve({ reclaimed: 1 });
  }

  releases(): Promise<ReleaseRecord[]> {
    return Promise.resolve(
      guard<ReleaseRecord[]>([
        { version: 42, channel: "stable" },
        { version: 43, channel: "beta" },
        { version: 41, channel: "stable" },
      ]),
    );
  }

  promoteRelease(version: number): Promise<ReleaseRecord> {
    return Promise.resolve(guard<ReleaseRecord>({ version, channel: "stable" }));
  }

  transparencyLog(): Promise<KeyEvent[]> {
    return Promise.resolve(
      guard<KeyEvent[]>([
        {
          seq: 9912,
          op: "publish",
          key_id: "k-8841",
          pubkey_sha256: "3b1f9c4d77ae0021bb5c",
          hash: "aa01…",
        },
        {
          seq: 9911,
          op: "revoke",
          key_id: "k-7781",
          pubkey_sha256: "0099fe22aa13cd44ef67",
          hash: "bb02…",
        },
        {
          seq: 9910,
          op: "publish",
          key_id: "k-7781",
          pubkey_sha256: "0099fe22aa13cd44ef67",
          hash: "cc03…",
        },
      ]),
    );
  }

  revokeKey(keyId: string): Promise<KeyEvent> {
    return Promise.resolve(
      guard<KeyEvent>({
        seq: 9913,
        op: "revoke",
        key_id: keyId,
        pubkey_sha256: "0000…",
        hash: "dd04…",
      }),
    );
  }

  operators(): Promise<Operator[]> {
    return Promise.resolve(
      guard<Operator[]>([
        {
          operator: "demo.operator",
          role: "owner",
          enrolled_at: daysAgo(420),
          last_active: minutesAgo(2),
        },
        {
          operator: "ops.bryce",
          role: "relay_operator",
          enrolled_at: daysAgo(210),
          last_active: minutesAgo(310),
        },
        {
          operator: "ops.lena",
          role: "key_officer",
          enrolled_at: daysAgo(160),
          last_active: minutesAgo(880),
        },
        {
          operator: "ci.releaser",
          role: "release_manager",
          enrolled_at: daysAgo(90),
          last_active: minutesAgo(12),
        },
        {
          operator: "audit.viewer",
          role: "read_only",
          enrolled_at: daysAgo(30),
          last_active: daysAgo(3),
        },
      ]),
    );
  }
}
