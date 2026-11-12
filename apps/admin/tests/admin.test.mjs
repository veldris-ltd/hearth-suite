import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AUTH_STATES,
  DEFAULT_ROLE,
  MODULES,
  ROLE_LABELS,
  assertNoUserContent,
  canPerform,
  nextAuthState,
  sparklinePath,
  visibleModules,
} from "../src/core.mjs";

test("AC-ADMIN-3: the panel authenticates only via a successful WebAuthn assertion", () => {
  let s = AUTH_STATES.UNAUTHENTICATED;
  s = nextAuthState(s, "begin");
  assert.equal(s, AUTH_STATES.CHALLENGED);
  // A failed assertion never authenticates.
  assert.equal(nextAuthState(s, "assert_failure"), AUTH_STATES.FAILED);
  // The only path to authenticated is a successful assertion.
  assert.equal(nextAuthState(s, "assert_success"), AUTH_STATES.AUTHENTICATED);
  // You cannot jump straight from unauthenticated to authenticated.
  assert.equal(
    nextAuthState(AUTH_STATES.UNAUTHENTICATED, "assert_success"),
    AUTH_STATES.UNAUTHENTICATED,
  );
  // Logout returns to unauthenticated.
  assert.equal(nextAuthState(AUTH_STATES.AUTHENTICATED, "logout"), AUTH_STATES.UNAUTHENTICATED);
});

test("AC-ADMIN-6: the default role is least privileged", () => {
  assert.equal(DEFAULT_ROLE, "read_only");
  assert.equal(canPerform("read_only", "view_audit_log"), true);
  assert.equal(canPerform("read_only", "manage_relay_quota"), false);
  assert.equal(canPerform("read_only", "sign_release"), false);
});

test("AC-ADMIN-1: actions are gated to the responsible role", () => {
  assert.equal(canPerform("relay_operator", "manage_relay_quota"), true);
  assert.equal(canPerform("relay_operator", "sign_release"), false);
  assert.equal(canPerform("release_manager", "promote_channel"), true);
  assert.equal(canPerform("key_officer", "revoke_key"), true);
  assert.equal(canPerform("key_officer", "manage_relay_quota"), false);
  // Owner can do anything.
  for (const action of ["manage_relay_quota", "sign_release", "revoke_key"]) {
    assert.equal(canPerform("owner", action), true);
  }
});

test("visibleModules: every operator sees all six areas; mutation is role-gated", () => {
  const readOnly = visibleModules("read_only");
  assert.equal(readOnly.length, 6);
  assert.ok(readOnly.every((m) => !m.mutable));
  // The v1.0 Hearth Suite Ops nav: Dashboard + Access & roles included.
  assert.deepEqual(
    readOnly.map((m) => m.id),
    ["dashboard", "relay", "release", "keydir", "audit", "access"],
  );

  const relay = visibleModules("relay_operator");
  assert.equal(relay.find((m) => m.id === "relay")?.mutable, true);
  assert.equal(relay.find((m) => m.id === "release")?.mutable, false);

  // Access & roles is owner-only to mutate (Invite).
  assert.equal(relay.find((m) => m.id === "access")?.mutable, false);
  assert.equal(visibleModules("owner").find((m) => m.id === "access")?.mutable, true);
  assert.ok(visibleModules("owner").every((m) => m.mutable));
});

test("DSG-A1: every role in the policy has a label + summary for Access & roles", () => {
  const roles = ["owner", "relay_operator", "release_manager", "key_officer", "read_only"];
  for (const role of roles) {
    assert.ok(ROLE_LABELS[role]?.label, `${role} has a label`);
    assert.ok(ROLE_LABELS[role]?.summary, `${role} has a summary`);
  }
  // The nav reads as the v1.0 lockup.
  assert.equal(MODULES.find((m) => m.id === "dashboard")?.label, "Dashboard");
  assert.equal(MODULES.find((m) => m.id === "relay")?.label, "Sync relay");
  assert.equal(MODULES.find((m) => m.id === "access")?.label, "Access & roles");
});

test("DSG-A1: sparklinePath plots only the data given (no fabrication)", () => {
  assert.equal(sparklinePath([], 100, 28), ""); // empty → nothing to draw
  assert.equal(sparklinePath([5], 100, 28), "M 0,14.00 L 100,14.00"); // single → flat mid-line
  const d = sparklinePath([0, 10], 100, 28);
  assert.ok(d.startsWith("M 0.00,28.00"), "min sits at the bottom");
  assert.ok(d.includes("L 100.00,0.00"), "max sits at the top");
});

test("AC-ADMIN-4: the redaction guard rejects any user-content field", () => {
  // Aggregate view models pass.
  assert.doesNotThrow(() =>
    assertNoUserContent({
      service: "sync-relay",
      healthy: true,
      requests_total: 1000,
      blobs: [{ id: "b1", size_bytes: 10, state: "active" }],
    }),
  );
  // Anything that could carry content is refused.
  assert.throws(() => assertNoUserContent({ document_body: "secret" }), /user content/);
  assert.throws(() => assertNoUserContent({ items: [{ plaintext: "x" }] }), /user content/);
  assert.throws(() => assertNoUserContent({ note: "hi" }), /user content/);
});
