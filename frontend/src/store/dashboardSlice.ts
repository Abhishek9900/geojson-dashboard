/**
 * Dashboard Redux slice.
 *
 * Owns all state related to the loaded GeoJSON file:
 *   - Upload lifecycle (status, progress, error)
 *   - Backend analysis response
 *   - Live FeatureCollection (may differ from response after map/table edits)
 *   - Unsaved-changes flag and saving state
 *   - Selected feature index (for map ↔ table ↔ issues panel sync)
 *
 * The slice intentionally contains no async logic. Thunks that call the API
 * live in `dashboardThunks.ts` so this file stays readable.
 */

import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import type { FeatureCollection } from "geojson";
import type { ProcessGeoJSONResponse, GeometryIssue, UploadStatus } from "@/types";

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

export interface DashboardState {
  uploadStatus: UploadStatus;
  uploadProgress: number;
  filename: string | null;
  fileSizeBytes: number | null;
  /** Full response from the last upload or save call. */
  response: ProcessGeoJSONResponse | null;
  /**
   * The live FeatureCollection shown on the map and table.
   * After upload this matches response.features; after edits it diverges.
   * Each feature carries a `properties._originalIndex` stamp so it can be
   * linked back to its ProcessedFeature in response.features.
   */
  featureCollection: FeatureCollection | null;
  /** True when featureCollection has edits that haven't been saved yet. */
  hasUnsavedChanges: boolean;
  /** Index into featureCollection.features of the currently highlighted feature. */
  selectedFeatureIndex: number | null;
  isSaving: boolean;
  error: string | null;
}

const initialState: DashboardState = {
  uploadStatus: "idle",
  uploadProgress: 0,
  filename: null,
  fileSizeBytes: null,
  response: null,
  featureCollection: null,
  hasUnsavedChanges: false,
  selectedFeatureIndex: null,
  isSaving: false,
  error: null,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a FeatureCollection from a ProcessGeoJSONResponse, stamping each
 * feature with `_originalIndex` so map/table edits can always trace back to
 * the corresponding ProcessedFeature.
 */
function buildStampedFeatureCollection(response: ProcessGeoJSONResponse): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: response.features.map((processedFeature, i) => {
      const props = { ...(processedFeature.feature.properties ?? {}) };
      delete props._edited;

      return {
        ...processedFeature.feature,
        properties: {
          ...props,
          _originalIndex: i,
        },
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Slice
// ---------------------------------------------------------------------------

const dashboardSlice = createSlice({
  name: "dashboard",
  initialState,
  reducers: {
    // ---- upload lifecycle ----

    uploadStarted(state) {
      state.uploadStatus = "uploading";
      state.uploadProgress = 0;
      state.error = null;
    },

    uploadProgressUpdated(state, action: PayloadAction<number>) {
      state.uploadProgress = action.payload;
    },

    uploadSucceeded(state, action: PayloadAction<ProcessGeoJSONResponse>) {
      const result = action.payload;
      state.uploadStatus = "success";
      state.uploadProgress = 100;
      state.filename = result.filename;
      state.fileSizeBytes = result.file_size_bytes;
      state.response = result;
      state.featureCollection = buildStampedFeatureCollection(result);
      state.hasUnsavedChanges = false;
      state.selectedFeatureIndex = null;
      state.error = null;
    },

    uploadFailed(state, action: PayloadAction<string>) {
      state.uploadStatus = "error";
      state.error = action.payload;
    },

    // ---- map edit staging ----

    /**
     * Called after the user finishes editing on the map (draw/delete).
     *
     * Applies an optimistic patch:
     *  - Removes issues for deleted features.
     *  - Trims duplicate groups that no longer have ≥ 2 members.
     *
     * The full backend re-analysis happens in `saveSucceeded`.
     */
    mapEditStaged(state, action: PayloadAction<FeatureCollection>) {
      const editedFeatureCollection = action.payload;
      state.featureCollection = editedFeatureCollection;
      state.hasUnsavedChanges = true;

      if (!state.response) return;

      const remainingOriginalIndices = new Set(
        editedFeatureCollection.features
          .map((f) => f.properties?._originalIndex as number | undefined)
          .filter((v): v is number => v != null)
      );

      const remainingIssues = state.response.summary.issues.filter((issue) =>
        remainingOriginalIndices.has(issue.feature_index)
      );

      const remainingDuplicateGroups = state.response.summary.duplicate_groups_detail
        .map((group) => ({
          ...group,
          feature_indices: group.feature_indices.filter((i) => remainingOriginalIndices.has(i)),
        }))
        .filter((group) => group.feature_indices.length > 1);

      state.response = {
        ...state.response,
        summary: {
          ...state.response.summary,
          issues: remainingIssues,
          invalid_features: remainingIssues.length,
          duplicate_groups: remainingDuplicateGroups.length,
          duplicate_groups_detail: remainingDuplicateGroups,
        },
      };
    },

    // ---- auto-fix from IssuesPanel ----

    /**
     * Patch a single feature's geometry with the backend-computed repair and
     * remove the corresponding issue from the summary.
     */
    geometryFixApplied(state, action: PayloadAction<GeometryIssue>) {
      const issue = action.payload;
      if (!issue.fixed_geometry || !state.featureCollection || !state.response) return;

      const liveIndex = state.featureCollection.features.findIndex(
        (f) => f.properties?._originalIndex === issue.feature_index
      );
      if (liveIndex === -1) return;

      // Patch the live FeatureCollection geometry.
      const updatedFeatures = [...state.featureCollection.features];
      updatedFeatures[liveIndex] = {
        ...updatedFeatures[liveIndex],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        geometry: issue.fixed_geometry as any,
      };
      state.featureCollection = { ...state.featureCollection, features: updatedFeatures };
      state.hasUnsavedChanges = true;

      // Patch the response: mark ProcessedFeature as valid, remove issue.
      state.response = {
        ...state.response,
        features: state.response.features.map((pf) =>
          pf.index === issue.feature_index ? { ...pf, is_valid: true, issues: [] } : pf
        ),
        summary: {
          ...state.response.summary,
          issues: state.response.summary.issues.filter(
            (i) => i.feature_index !== issue.feature_index
          ),
          invalid_features: Math.max(0, state.response.summary.invalid_features - 1),
        },
      };
    },

    // ---- inline property editing from FeatureTable ----

    propertiesUpdated(
      state,
      action: PayloadAction<{ index: number; props: Record<string, string> }>
    ) {
      const { index, props } = action.payload;
      if (!state.featureCollection) return;

      const feature = state.featureCollection.features[index];
      if (!feature) return;

      // Merge updated props, preserving internal _ keys.
      const internalProps = Object.fromEntries(
        Object.entries(feature.properties ?? {}).filter(([k]) => k.startsWith("_"))
      );
      feature.properties = { ...internalProps, ...props, _edited: true };
      state.hasUnsavedChanges = true;
    },

    // ---- save (submit edits for re-analysis) ----

    saveStarted(state) {
      state.isSaving = true;
    },

    saveSucceeded(state, action: PayloadAction<ProcessGeoJSONResponse>) {
      const result = action.payload;
      state.isSaving = false;
      state.response = result;
      state.featureCollection = buildStampedFeatureCollection(result);
      state.hasUnsavedChanges = false;
      state.selectedFeatureIndex = null;
    },

    saveFailed(state) {
      state.isSaving = false;
    },

    // ---- selection ----

    featureSelected(state, action: PayloadAction<number | null>) {
      state.selectedFeatureIndex = action.payload;
    },

    // ---- reset ----

    resetDashboard() {
      return initialState;
    },
  },
});

export const {
  uploadStarted,
  uploadProgressUpdated,
  uploadSucceeded,
  uploadFailed,
  mapEditStaged,
  geometryFixApplied,
  propertiesUpdated,
  saveStarted,
  saveSucceeded,
  saveFailed,
  featureSelected,
  resetDashboard,
} = dashboardSlice.actions;

export default dashboardSlice.reducer;
