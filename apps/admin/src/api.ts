/**
 * Typed client for the Admin API (`services/admin-cp`).
 *
 * Every response is passed through the content-redaction guard before it can
 * reach the UI, so even a server bug cannot surface user document content in the
 * panel (AC-ADMIN-4, defense in depth).
 */

import { assertNoUserContent } from "./core.mjs";
import type { Role } from "./core.mjs";

export interface HealthSnapshot {
  service: string;
  healthy: boolean;
  uptime_seconds: number;
  requests_total: number;
  error_rate_milli: number;
  blobs_stored: number;
  bytes_stored: number;
}

export interface AuditEntry {
  seq: number;
  at: number;
  actor: string;
  action: string;
  target: string;
  outcome: "allowed" | "denied";
  hash: string;
}

export interface Quota {
  max_bytes: number;
  max_blobs: number;
}

export interface BlobMeta {
  id: string;
  size_bytes: number;
  ttl_seconds: number;
  created_at: number;
  state: "active" | "expired" | "reclaimed";
}

export interface ReleaseRecord {
  version: number;
  channel: "beta" | "stable";
}

export interface KeyEvent {
  seq: number;
  op: "publish" | "revoke";
  key_id: string;
  pubkey_sha256: string;
  hash: string;
}

export interface WebAuthnChallenge {
  challenge: string;
  rpId: string;
  allowCredentials: Array<{ id: string }>;
  timeout: number;
}

export interface Session {
  operator: string;
  role: Role;
}

/** A Dashboard stat card: a current value plus a recent series for its sparkline. */
export interface StatCard {
  key: string;
  label: string;
  value: string;
  /** A short relative change, e.g. "+0.2%" (optional). */
  delta?: string;
  /** Recent data points, oldest first, for the sparkline (may be empty). */
  series: number[];
  tone?: "ok" | "warn" | "bad";
}

/** Per-service health for the Dashboard service-health card. */
export interface ServiceHealthRow {
  name: string;
  p99_ms: number;
  healthy: boolean;
}

/** An operational alert (never user content; `detail` is an ops string). */
export interface OpsAlert {
  at: number;
  severity: "info" | "warning" | "critical";
  detail: string;
}

/** The Dashboard view model (one redaction-guarded payload). */
export interface DashboardSnapshot {
  stats: StatCard[];
  services: ServiceHealthRow[];
  alerts: OpsAlert[];
}

/** An enrolled operator for the Access & roles table. */
export interface Operator {
  operator: string;
  role: Role;
  enrolled_at: number;
  last_active: number;
}

/**
 * The surface the panel renders against. Both the real {@link AdminApiClient}
 * and the dev-only mock implement it, so the panel never depends on transport.
 */
export interface AdminApi {
  dashboard(): Promise<DashboardSnapshot>;
  health(): Promise<HealthSnapshot[]>;
  auditLog(): Promise<AuditEntry[]>;
  relayQuota(): Promise<Quota>;
  relayBlobs(): Promise<BlobMeta[]>;
  reclaimExpired(): Promise<{ reclaimed: number }>;
  releases(): Promise<ReleaseRecord[]>;
  promoteRelease(version: number): Promise<ReleaseRecord>;
  transparencyLog(): Promise<KeyEvent[]>;
  revokeKey(keyId: string): Promise<KeyEvent>;
  operators(): Promise<Operator[]>;
}

/** A thin fetch-based client; the server enforces auth + RBAC on every call. */
export class AdminApiClient implements AdminApi {
  constructor(private readonly base = "/api") {}

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.base}${path}`, { credentials: "include" });
    if (!res.ok) {
      throw new Error(`admin api ${path}: ${res.status}`);
    }
    const body: unknown = await res.json();
    assertNoUserContent(body);
    return body as T;
  }

  private async post<T>(path: string, payload: unknown): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(`admin api ${path}: ${res.status}`);
    }
    const body: unknown = await res.json();
    assertNoUserContent(body);
    return body as T;
  }

  // ---- auth (WebAuthn) ------------------------------------------------------
  beginWebAuthn(): Promise<WebAuthnChallenge> {
    return this.post("/auth/webauthn/begin", {});
  }
  finishWebAuthn(assertion: unknown): Promise<Session> {
    return this.post("/auth/webauthn/finish", assertion);
  }
  session(): Promise<Session> {
    return this.get("/auth/session");
  }

  // ---- dashboard ------------------------------------------------------------
  dashboard(): Promise<DashboardSnapshot> {
    return this.get("/dashboard");
  }

  // ---- observability --------------------------------------------------------
  health(): Promise<HealthSnapshot[]> {
    return this.get("/observability/health");
  }

  // ---- audit ----------------------------------------------------------------
  auditLog(): Promise<AuditEntry[]> {
    return this.get("/audit");
  }

  // ---- relay ----------------------------------------------------------------
  relayQuota(): Promise<Quota> {
    return this.get("/relay/quota");
  }
  setRelayQuota(quota: Quota): Promise<Quota> {
    return this.post("/relay/quota", quota);
  }
  relayBlobs(): Promise<BlobMeta[]> {
    return this.get("/relay/blobs");
  }
  reclaimExpired(): Promise<{ reclaimed: number }> {
    return this.post("/relay/reclaim", {});
  }

  // ---- releases -------------------------------------------------------------
  releases(): Promise<ReleaseRecord[]> {
    return this.get("/releases");
  }
  promoteRelease(version: number): Promise<ReleaseRecord> {
    return this.post("/releases/promote", { version });
  }

  // ---- key directory --------------------------------------------------------
  transparencyLog(): Promise<KeyEvent[]> {
    return this.get("/keydir/log");
  }
  revokeKey(keyId: string): Promise<KeyEvent> {
    return this.post("/keydir/revoke", { key_id: keyId });
  }

  // ---- access & roles -------------------------------------------------------
  operators(): Promise<Operator[]> {
    return this.get("/access/operators");
  }
}
