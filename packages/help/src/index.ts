/**
 * Hearth Suite help, task-oriented, offline, plain-language help (AC-WKS-G4).
 *
 * No videos, no account, no network: a small corpus of "how do I…" tasks,
 * per-module first-time coach tips (dismissed forever in one tap), a local
 * search, and an Ember request builder that answers questions FROM this corpus.
 */

export {
  HELP_TOPICS,
  COACH,
  coachDismissed,
  dismissCoach,
  coachFor,
  helpForModule,
  searchHelp,
  buildHelpRequest,
} from "./help.mjs";
export type { HelpModule, HelpTopic, CoachContent, HelpRequest, HelpStorage } from "./help.mjs";
