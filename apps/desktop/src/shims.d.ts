/** Ambient declarations for non-code imports and Vite env handled by the bundler. */

declare module "*.css";

interface ImportMetaEnv {
  /** True under `vite` dev, false in a production `vite build`. */
  readonly DEV: boolean;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Short commit of this build, injected by vite.config.ts ("" in dev). */
declare const __HEARTH_BUILD_COMMIT__: string;
/** Update channel this build follows, injected by vite.config.ts ("" in dev). */
declare const __HEARTH_UPDATE_CHANNEL__: string;
