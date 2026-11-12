// Type declarations for the pure help core (help.mjs).

export type HelpModule = "writer" | "sheets" | "records" | "calendar" | "general";

export interface HelpTopic {
  id: string;
  module: HelpModule;
  task: string;
  answer: string;
  keywords?: string[];
}

export interface CoachContent {
  title: string;
  lead: string;
  tips: string[];
}

export interface HelpRequest {
  task: "query";
  document: string;
  request: string;
  effort: "fast" | "balanced" | "thorough";
}

/** A minimal key/value store (localStorage shape), the persistence seam. */
export interface HelpStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const HELP_TOPICS: HelpTopic[];
export const COACH: Record<string, CoachContent>;

export function coachDismissed(module: string, storage?: HelpStorage): boolean;
export function dismissCoach(module: string, storage?: HelpStorage): void;
export function coachFor(module: string): CoachContent | null;
export function helpForModule(module: string, topics?: HelpTopic[]): HelpTopic[];
export function searchHelp(query: string, topics?: HelpTopic[]): HelpTopic[];
export function buildHelpRequest(
  question: string,
  topics?: HelpTopic[],
  effort?: "fast" | "balanced" | "thorough",
): HelpRequest;
