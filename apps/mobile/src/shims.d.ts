/** Ambient declarations for non-code imports handled by the Vite bundler. */

declare module "*.css";

/**
 * Minimal ambient declaration for `@capacitor/local-notifications` (seam #11).
 * The plugin is added at device-build time (`ci/mobile/apply-native.sh`) and is
 * not vendored in the offline workspace store, so this keeps the wiring
 * type-checked here; the dynamic import degrades gracefully when it is absent.
 */
declare module "@capacitor/local-notifications" {
  export interface LocalNotificationSchema {
    id: number;
    title: string;
    body: string;
    schedule?: { at: Date };
  }
  export const LocalNotifications: {
    requestPermissions(): Promise<{ display: string }>;
    schedule(options: { notifications: LocalNotificationSchema[] }): Promise<unknown>;
    cancel(options: { notifications: Array<{ id: number }> }): Promise<void>;
  };
}
