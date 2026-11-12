// Type declarations for the pure Mantel core (core.mjs).

/** A searchable item's kind. */
export type Kind = "document" | "record" | "calendar";

/** A module identifier. */
export type ModuleId = "writer" | "sheets" | "records" | "calendar";

/** Launcher metadata for a module. */
export interface ModuleInfo {
  id: ModuleId;
  label: string;
  glyph: string;
  verb: string;
}

/** A locally-indexed, searchable item spanning all modules. */
export interface SearchItem {
  id: string;
  kind: Kind;
  title: string;
  snippet?: string;
  module?: ModuleId;
  bundleId?: string;
}

/** A ranked search result. */
export interface SearchResult extends SearchItem {
  score: number;
}

export const MODULES: ModuleInfo[];
export function moduleForKind(kind: Kind): ModuleId;
export function routeForResult(result: SearchItem): ModuleId;
export function rankResults(query: string, items: SearchItem[]): SearchResult[];
export const DEFAULT_SECTIONS: string[];
export const ADVANCED_SECTIONS: string[];
export function isAdvanced(section: string): boolean;

/** A goal-phrased Task Launcher entry. */
export interface Task {
  id: string;
  label: string;
  module: ModuleId;
  template: string;
  glyph: string;
  hint: string;
}

/** A gallery template. */
export interface Template {
  id: string;
  name: string;
  category: string;
  module: ModuleId;
  description: string;
  preview: string[];
}

export const TASKS: Task[];
export const TEMPLATES: Template[];
export function taskById(id: string): Task | null;
export function templateById(id: string): Template | null;
export function templateCategories(): string[];
export function templatesByCategory(category?: string): Template[];
export function searchTemplates(query: string): Template[];
export function friendlyDate(iso?: string): string | null;
export function sortRecentsByDate<T extends { updatedAt?: string }>(recents: T[]): T[];
