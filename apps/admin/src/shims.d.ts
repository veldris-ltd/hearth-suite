/** Ambient declarations for non-code imports and Vite env handled by the bundler. */

declare module "*.css";

interface ImportMetaEnv {
  /** True under `vite` dev, false in a production `vite build`. */
  readonly DEV: boolean;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
