/**
 * Memoised selectors for derived data.
 *
 * All expensive computations (filtering, searching, sorting, paginating the
 * feature list) live here so components stay dumb: they call a selector and
 * render the result.  RTK's `createSelector` caches each selector; it only
 * re-runs when its inputs change.
 */

import { createSelector } from "@reduxjs/toolkit";
import type { RootState } from "./store";
import type { ProcessedFeature, FeatureFilter } from "@/types";

// ---------------------------------------------------------------------------
// Raw state selectors (cheap — no memoisation needed)
// ---------------------------------------------------------------------------

export const selectDashboard = (s: RootState) => s.dashboard;
export const selectTable = (s: RootState) => s.table;

export const selectResponse = (s: RootState) => s.dashboard.response;
export const selectFeatureCollection = (s: RootState) => s.dashboard.featureCollection;
export const selectSelectedIndex = (s: RootState) => s.dashboard.selectedFeatureIndex;
export const selectUploadStatus = (s: RootState) => s.dashboard.uploadStatus;
export const selectUploadProgress = (s: RootState) => s.dashboard.uploadProgress;
export const selectFilename = (s: RootState) => s.dashboard.filename;
export const selectIsSaving = (s: RootState) => s.dashboard.isSaving;
export const selectError = (s: RootState) => s.dashboard.error;
export const selectHasPending = (s: RootState) =>
  s.dashboard.pendingFC !== null || s.dashboard.hasPending;
export const selectHasData = (s: RootState) =>
  s.dashboard.uploadStatus === "success" && s.dashboard.response !== null;

// Table UI selectors
export const selectFilter = (s: RootState) => s.table.filter;
export const selectSearchQuery = (s: RootState) => s.table.searchQuery;
export const selectSortKey = (s: RootState) => s.table.sortKey;
export const selectSortDir = (s: RootState) => s.table.sortDir;
export const selectCurrentPage = (s: RootState) => s.table.currentPage;
export const selectPageSize = (s: RootState) => s.table.pageSize;

// ---------------------------------------------------------------------------
// Derived selectors
// ---------------------------------------------------------------------------

/** All ProcessedFeatures from the response, or an empty array. */
const selectAllProcessedFeatures = createSelector(
  selectResponse,
  (response) => response?.features ?? []
);

/**
 * The set of `_originalIndex` values that are still present in the live FC.
 * Used to determine which backend features have been deleted via map edits.
 */
const selectPresentOriginalIndices = createSelector(
  selectFeatureCollection,
  (fc) =>
    new Set(
      (fc?.features ?? [])
        .map((f) => f.properties?._originalIndex as number | undefined)
        .filter((v): v is number => v != null)
    )
);

/**
 * The set of original indices that have been deleted since the last analysis.
 * The FeatureTable uses this to show DELETED badges.
 */
export const selectDeletedIndices = createSelector(
  selectAllProcessedFeatures,
  selectPresentOriginalIndices,
  (allFeatures, present) =>
    new Set(allFeatures.map((_, i) => i).filter((i) => !present.has(i)))
);

// ---------------------------------------------------------------------------
// Table: filter → search → sort → paginate
// ---------------------------------------------------------------------------

/**
 * A "virtual" table row that merges the backend ProcessedFeature (if any)
 * with live FeatureCollection metadata.
 */
export interface TableRow {
  /** Position in the live featureCollection.features array. */
  index: number;
  /** Null for features drawn after the last analysis. */
  pf: ProcessedFeature | null;
  geomType: string;
  /** True when this feature was drawn after the last upload/analysis. */
  isDrawn: boolean;
  /** True when this feature existed in the last analysis but was deleted via map edit. */
  isDeleted: boolean;
  /** True when this feature existed in the last analysis but was edited in the table. */
  isEdited: boolean;
}

/** All rows in display order before filtering. */
export const selectAllRows = createSelector(
  selectAllProcessedFeatures,
  selectFeatureCollection,
  selectDeletedIndices,
  (features, fc, deletedIndices): TableRow[] => {
    const rows: TableRow[] = [];

    // 1. Deleted backend features (in response but no longer in live FC).
    features.forEach((pf, i) => {
      if (deletedIndices.has(i)) {
        rows.push({
          index: i,
          pf,
          geomType: pf.feature.geometry?.type ?? "null",
          isDrawn: false,
          isDeleted: true,
          isEdited: false,
        });
      }
    });

    // 2. Features currently in the live FC.
    (fc?.features ?? []).forEach((f, idx) => {
      const originalIdx = f.properties?._originalIndex as number | undefined;
      const isDrawn = originalIdx == null;
      const pf = originalIdx != null ? (features[originalIdx] ?? null) : null;
      const isEdited = f.properties?._edited === true;
      rows.push({
        index: idx,
        pf,
        geomType: f.geometry?.type ?? "null",
        isDrawn,
        isDeleted: false,
        isEdited,
      });
    });

    return rows;
  }
);

/** Filter counts for the tab badges — computed from all rows, not the current page. */
export const selectFilterCounts = createSelector(
  selectAllRows,
  (rows): Record<FeatureFilter, number> => ({
    all: rows.filter((r) => !r.isDeleted).length,
    valid: rows.filter((r) => r.pf && r.pf.is_valid && !r.pf.is_duplicate).length,
    invalid: rows.filter((r) => r.pf && !r.pf.is_valid).length,
    duplicate: rows.filter((r) => r.pf?.is_duplicate).length,
  })
);

/** Rows after applying the active filter tab. */
const selectFilteredRows = createSelector(
  selectAllRows,
  selectFilter,
  (rows, filter): TableRow[] =>
    rows.filter((row) => {
      if (row.isDeleted) return filter === "all";
      if (row.isDrawn) return filter === "all";
      const pf = row.pf!;
      if (filter === "valid") return pf.is_valid && !pf.is_duplicate;
      if (filter === "invalid") return !pf.is_valid;
      if (filter === "duplicate") return pf.is_duplicate;
      return true; // "all"
    })
);

/**
 * Rows after applying the free-text search query.
 *
 * The search is case-insensitive and matches against all visible property
 * values (keys that do not start with `_`), the geometry type, and the
 * feature index.  Empty query bypasses the filter entirely.
 */
const selectSearchedRows = createSelector(
  selectFilteredRows,
  selectSearchQuery,
  // We also need the live FC for property access on drawn features.
  selectFeatureCollection,
  (rows, query, fc): TableRow[] => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;

    return rows.filter((row) => {
      // Index always matches if the query is a number.
      if (String(row.index).includes(q)) return true;
      if (row.geomType.toLowerCase().includes(q)) return true;

      // Search property values.
      const rawProps =
        fc?.features[row.index]?.properties ??
        row.pf?.feature.properties ??
        {};
      return Object.entries(rawProps).some(
        ([k, v]) =>
          !k.startsWith("_") &&
          (k.toLowerCase().includes(q) ||
            String(v ?? "")
              .toLowerCase()
              .includes(q))
      );
    });
  }
);

/** Rows after applying sort. */
const selectSortedRows = createSelector(
  selectSearchedRows,
  selectSortKey,
  selectSortDir,
  (rows, sortKey, sortDir): TableRow[] => {
    const sorted = [...rows].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "index") cmp = a.index - b.index;
      else if (sortKey === "type") cmp = a.geomType.localeCompare(b.geomType);
      else if (sortKey === "valid")
        cmp = Number(b.pf?.is_valid ?? true) - Number(a.pf?.is_valid ?? true);
      else if (sortKey === "duplicate")
        cmp =
          Number(b.pf?.is_duplicate ?? false) -
          Number(a.pf?.is_duplicate ?? false);
      else if (sortKey === "area")
        cmp = (a.pf?.area_m2 ?? 0) - (b.pf?.area_m2 ?? 0);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }
);

/** Total number of rows matching the current filter + search (for pagination UI). */
export const selectTotalFilteredCount = createSelector(
  selectSortedRows,
  (rows) => rows.length
);

/** Total number of pages given the current page size. */
export const selectTotalPages = createSelector(
  selectTotalFilteredCount,
  selectPageSize,
  (total, pageSize) => Math.max(1, Math.ceil(total / pageSize))
);

/** The rows for the current page — what FeatureTable actually renders. */
export const selectPagedRows = createSelector(
  selectSortedRows,
  selectCurrentPage,
  selectPageSize,
  (rows, page, pageSize): TableRow[] => {
    const start = (page - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }
);
