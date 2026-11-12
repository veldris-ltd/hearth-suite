/**
 * The Mantel, Hearth Suite's unified workspace shell (P2.2).
 *
 * Exposes the home surface and its data sources. A host bootstraps it with an
 * FFI `HearthClient`-backed source and navigation callbacks.
 */

import "../styles/mantel.css";

export { Mantel } from "./mantel";
export type { CreateOptions, MantelOptions, OpenTarget } from "./mantel";
export { bundleStatus, createClientSource, inMemorySource, mergeSources } from "./source";
export type { BundleStatus, MantelSource, RecentBundle } from "./source";
export {
  MODULES,
  TASKS,
  TEMPLATES,
  rankResults,
  routeForResult,
  taskById,
  templateById,
} from "./core.mjs";
export type { ModuleId, ModuleInfo, SearchItem, SearchResult, Task, Template } from "./core.mjs";
