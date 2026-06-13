/**
 * Table Redux slice.
 *
 * Owns all UI state for the FeatureTable that is independent of the loaded
 * data: which filter tab is active, the search query, current sort column and
 * direction, and pagination (current page + page size).
 *
 * Keeping table UI state in Redux rather than local component state lets the
 * table restore its position after a map selection scrolls the page, and
 * allows the IssuesPanel to deep-link directly to the correct page.
 */

import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import type { FeatureFilter } from "@/types";
import { resetDashboard, uploadSucceeded, analyseSucceeded } from "./dashboardSlice";

export type SortKey = "index" | "type" | "valid" | "duplicate" | "area";
export type SortDir = "asc" | "desc";

export interface TableState {
  filter: FeatureFilter;
  /** Free-text search applied across all visible property values. */
  searchQuery: string;
  sortKey: SortKey;
  sortDir: SortDir;
  currentPage: number;
  pageSize: number;
}

const initialState: TableState = {
  filter: "all",
  searchQuery: "",
  sortKey: "index",
  sortDir: "asc",
  currentPage: 1,
  pageSize: 50,
};

const tableSlice = createSlice({
  name: "table",
  initialState,
  reducers: {
    filterChanged(state, action: PayloadAction<FeatureFilter>) {
      state.filter = action.payload;
      // Always jump back to page 1 when the filter changes so the user
      // doesn't land on a now-empty page.
      state.currentPage = 1;
    },

    searchQueryChanged(state, action: PayloadAction<string>) {
      state.searchQuery = action.payload;
      state.currentPage = 1;
    },

    sortChanged(
      state,
      action: PayloadAction<{ key: SortKey; dir: SortDir }>
    ) {
      state.sortKey = action.payload.key;
      state.sortDir = action.payload.dir;
      state.currentPage = 1;
    },

    pageChanged(state, action: PayloadAction<number>) {
      state.currentPage = action.payload;
    },

    pageSizeChanged(state, action: PayloadAction<number>) {
      state.pageSize = action.payload;
      state.currentPage = 1;
    },
  },
  extraReducers: (builder) => {
    // Reset table UI whenever new data arrives or the user starts over.
    builder
      .addCase(uploadSucceeded, () => initialState)
      .addCase(analyseSucceeded, (state) => {
        // Keep filter and page size; reset to page 1 and clear search.
        state.currentPage = 1;
        state.searchQuery = "";
      })
      .addCase(resetDashboard, () => initialState);
  },
});

export const {
  filterChanged,
  searchQueryChanged,
  sortChanged,
  pageChanged,
  pageSizeChanged,
} = tableSlice.actions;

export default tableSlice.reducer;
