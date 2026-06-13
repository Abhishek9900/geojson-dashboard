/**
 * Dashboard Redux slice.
 *
 * Owns all state related to the loaded GeoJSON file:
 *   - Upload lifecycle (status, progress, error)
 *   - Backend analysis response
 *   - Live FeatureCollection (may differ from response after map edits)
 *   - Pending edits flag and saving state
 *   - Selected feature index (for map ↔ table ↔ issues panel sync)
 *
 * The slice intentionally contains no async logic.  Thunks that call the API
 * live in `dashboardThunks.ts` so this file stays readable.
 */

import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import type { FeatureCollection } from "geojson";
import type { ProcessGeoJSONResponse, GeometryIssue } from "@/types";

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

export type UploadStatus = "idle" | "uploading" | "success" | "error";

export interface DashboardState {
  uploadStatus: UploadStatus;
  uploadProgress: number;
  filename: string | null;
  fileSizeBytes: number | null;
  /** Full response from the last /upload or /update call. */
  response: ProcessGeoJSONResponse | null;
  /**
   * The live FeatureCollection shown on the map and table.
   * After upload this matches response.features; after map edits it diverges.
   * Each feature carries a `properties._originalIndex` stamp so it can be
   * linked back to its ProcessedFeature in response.features.
   */
  featureCollection: FeatureCollection | null;
  /**
   * A staged FeatureCollection that differs from the last analysed one.
   * Non-null whenever the "Save & Analyse" button should appear.
   */
  pendingFC: FeatureCollection | null;
  /** Index into featureCollection.features of the currently highlighted feature. */
  selectedFeatureIndex: number | null;
  isSaving: boolean;
  hasPending: boolean;
  error: string | null;
}

const initialState: DashboardState = {
  uploadStatus: "idle",
  uploadProgress: 0,
  filename: null,
  fileSizeBytes: null,
  response: null,
  featureCollection: null,
  pendingFC: null,
  selectedFeatureIndex: null,
  isSaving: false,
  hasPending: false,
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
function buildStampedFC(response: ProcessGeoJSONResponse): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: response.features.map((pf, i) => {
      const props = { ...(pf.feature.properties ?? {}) };

      delete props._edited;

      return {
        ...pf.feature,
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
      state.featureCollection = buildStampedFC(result);
      state.pendingFC = null;
      state.selectedFeatureIndex = null;
      state.error = null;
      state.hasPending = false;
    },

    uploadFailed(state, action: PayloadAction<string>) {
      state.uploadStatus = "error";
      state.error = action.payload;
    },

    // ---- map edit staging ----

    /**
     * Called after the user saves edits in the map toolbar.
     *
     * Applies an optimistic patch:
     *  - Removes issues for deleted features.
     *  - Trims duplicate groups that no longer have ≥ 2 members.
     *  - Marks deleted ProcessedFeatures with `_deleted: true`.
     *
     * The full backend re-analysis happens in `analyseSucceeded`.
     */
    mapEditStaged(state, action: PayloadAction<FeatureCollection>) {
      const updatedFC = action.payload;
      state.pendingFC = updatedFC;
      state.featureCollection = updatedFC;

      if (!state.response) return;

      const presentOriginalIndices = new Set(
        updatedFC.features
          .map((f) => f.properties?._originalIndex as number | undefined)
          .filter((v): v is number => v != null)
      );

      const remainingIssues = state.response.summary.issues.filter((issue) =>
        presentOriginalIndices.has(issue.feature_index)
      );

      const remainingDuplicateGroups = state.response.summary.duplicate_groups_detail
        .map((group) => ({
          ...group,
          feature_indices: group.feature_indices.filter((i) =>
            presentOriginalIndices.has(i)
          ),
        }))
        .filter((group) => group.feature_indices.length > 1);

      state.response = {
        ...state.response,
        features: state.response.features.map((pf) =>
          !presentOriginalIndices.has(pf.index) ? { ...pf, _deleted: true } : pf
        ),
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

      const liveIdx = state.featureCollection.features.findIndex(
        (f) => f.properties?._originalIndex === issue.feature_index
      );
      if (liveIdx === -1) return;

      // Patch the live FeatureCollection geometry.
      const updatedFeatures = [...state.featureCollection.features];
      updatedFeatures[liveIdx] = {
        ...updatedFeatures[liveIdx],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        geometry: issue.fixed_geometry as any,
      };
      const updatedFC: FeatureCollection = {
        ...state.featureCollection,
        features: updatedFeatures,
      };
      state.featureCollection = updatedFC;
      state.pendingFC = updatedFC;

      // Patch the response: mark ProcessedFeature as valid, remove issue.
      state.response = {
        ...state.response,
        features: state.response.features.map((pf) =>
          pf.index === issue.feature_index
            ? { ...pf, is_valid: true, issues: [] }
            : pf
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

    propertiesUpdated(state, action: PayloadAction<{ index: number; props: Record<string, string> }>) {
      const { index, props } = action.payload;
      if (!state.featureCollection) return;

      const feature = state.featureCollection.features[index];
      if (!feature) return;

      // Merge updated props, preserving internal _ keys
      const internalProps = Object.fromEntries(
        Object.entries(feature.properties ?? {}).filter(([k]) => k.startsWith("_"))
      );
      feature.properties = { ...internalProps, ...props, _edited: true };

      // Mirror into pendingFC so analyseCurrentFC sends the edited version.
      state.pendingFC = { ...state.featureCollection };
      state.hasPending = true;
    },

    // ---- re-analysis ----

    analyseStarted(state) {
      state.isSaving = true;
    },

    analyseSucceeded(state, action: PayloadAction<ProcessGeoJSONResponse>) {
      const result = action.payload;
      state.isSaving = false;
      state.response = result;
      state.featureCollection = buildStampedFC(result);
      state.pendingFC = null;
      state.hasPending = false;
      state.selectedFeatureIndex = null;
    },

    analyseFailed(state) {
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
  analyseStarted,
  analyseSucceeded,
  analyseFailed,
  featureSelected,
  resetDashboard,
} = dashboardSlice.actions;

export default dashboardSlice.reducer;
