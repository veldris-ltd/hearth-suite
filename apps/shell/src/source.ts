/** Data sources for The Mantel: recent Bundles and the local search index. */

import type { HearthClient } from "@hearth/core-client";

import { sortRecentsByDate } from "./core.mjs";
import type { SearchItem } from "./core.mjs";

/** The plain-language state of a Bundle, shown as a badge on its card. */
export type BundleStatus = "sealed" | "draft" | "saved";

/** A recently-touched Bundle shown on the home surface. */
export interface RecentBundle {
  id: string;
  title: string;
  sealed: boolean;
  /** How many documents the Bundle holds (drives the card's meta line). */
  documentCount: number;
  /** Derived status for the card badge: Sealed, Draft (empty), or Saved. */
  status: BundleStatus;
  /** When the Bundle was last touched (ISO 8601); drives History's date + sort. */
  updatedAt?: string;
}

/** Derive a Bundle's plain-language status from its sealed flag and contents. */
export function bundleStatus(sealed: boolean, documentCount: number): BundleStatus {
  if (sealed) {
    return "sealed";
  }
  return documentCount === 0 ? "draft" : "saved";
}

/** Supplies the data The Mantel renders. Ranking happens locally in the shell. */
export interface MantelSource {
  recentBundles(): Promise<RecentBundle[]>;
  searchItems(): Promise<SearchItem[]>;
}

/**
 * A {@link MantelSource} wired to the FFI client.
 *
 * Indexes Bundles (as documents) and Records tables across every Bundle, so
 * universal search spans documents and Records. Calendar events are supplied by
 * the live Calendar module via {@link mergeSources} (they live in an encrypted
 * vault document, not a queryable table). All searching stays local, the
 * client never hits a network.
 */
export function createClientSource(client: HearthClient): MantelSource {
  return {
    async recentBundles(): Promise<RecentBundle[]> {
      const bundles = await client.listBundles();
      // Most-recently-touched first (History order); undated Bundles sink last.
      return sortRecentsByDate(
        bundles.map((b) => ({
          id: b.id,
          title: b.title,
          sealed: b.sealed,
          documentCount: b.document_count,
          status: bundleStatus(b.sealed, b.document_count),
          updatedAt: b.updated_at,
        })),
      );
    },
    async searchItems(): Promise<SearchItem[]> {
      const bundles = await client.listBundles();
      const items: SearchItem[] = bundles.map((b) => ({
        id: b.id,
        kind: "document",
        title: b.title,
        module: "writer",
        bundleId: b.id,
      }));
      for (const bundle of bundles) {
        const tables = await client.listTables(bundle.id);
        for (const table of tables) {
          items.push({
            id: table.id,
            kind: "record",
            title: table.name,
            module: "records",
            bundleId: bundle.id,
          });
        }
      }
      return items;
    },
  };
}

/**
 * Compose a source from several sources (e.g. the FFI client plus the live
 * Calendar module), so universal search spans every module's items.
 */
export function mergeSources(primary: MantelSource, ...extra: MantelSource[]): MantelSource {
  return {
    recentBundles: () => primary.recentBundles(),
    async searchItems(): Promise<SearchItem[]> {
      const all = await Promise.all([primary, ...extra].map((source) => source.searchItems()));
      return all.flat();
    },
  };
}

/** An in-memory source for previews and tests. */
export function inMemorySource(items: SearchItem[], recents: RecentBundle[]): MantelSource {
  return {
    recentBundles: () => Promise.resolve(recents),
    searchItems: () => Promise.resolve(items),
  };
}
