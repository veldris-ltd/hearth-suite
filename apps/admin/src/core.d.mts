/** Types for the pure Admin Control Panel client logic in `core.mjs`. */

export type AuthState = "unauthenticated" | "challenged" | "authenticated" | "failed";
export type AuthEvent = "begin" | "assert_success" | "assert_failure" | "logout";

export const AUTH_STATES: {
  readonly UNAUTHENTICATED: "unauthenticated";
  readonly CHALLENGED: "challenged";
  readonly AUTHENTICATED: "authenticated";
  readonly FAILED: "failed";
};

export function nextAuthState(state: AuthState, event: AuthEvent): AuthState;

export type Role = "read_only" | "relay_operator" | "release_manager" | "key_officer" | "owner";

export const DEFAULT_ROLE: Role;

export interface ModuleInfo {
  id: string;
  label: string;
  actions: string[];
}

export const MODULES: ReadonlyArray<ModuleInfo>;

export const ROLE_LABELS: Readonly<Record<Role, { label: string; summary: string }>>;

export function canPerform(role: Role, action: string): boolean;

export function visibleModules(role: Role): Array<{ id: string; label: string; mutable: boolean }>;

export function sparklinePath(values: number[], width?: number, height?: number): string;

export const FORBIDDEN_CONTENT_KEYS: readonly string[];

export function assertNoUserContent(value: unknown): void;
