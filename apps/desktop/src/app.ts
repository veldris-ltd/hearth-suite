/**
 * The desktop host is the shared client shell (Mantel + module editors). The
 * desktop adds only the verified-update banner (see `update.ts`); everything
 * else is identical to the mobile client.
 */

export { mountWorkspace } from "@hearth/client-shell";
export type { OpenTarget, WorkspaceHandle, WorkspaceOptions } from "@hearth/client-shell";
