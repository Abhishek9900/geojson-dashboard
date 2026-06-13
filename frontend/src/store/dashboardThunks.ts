/**
 * Async thunks for dashboard API calls.
 *
 * Kept separate from dashboardSlice so the slice itself stays a pure reducer
 * with no side-effects.  Each thunk dispatches the relevant slice actions and
 * fires a toast notification so the UI stays reactive.
 */

import toast from "react-hot-toast";
import type { AppThunk } from "./store";
import { uploadGeoJSON, updateGeoJSON } from "@/lib/api";
import {
  uploadStarted,
  uploadProgressUpdated,
  uploadSucceeded,
  uploadFailed,
  analyseStarted,
  analyseSucceeded,
  analyseFailed,
} from "./dashboardSlice";

/**
 * Upload a `.geojson` file to the backend and dispatch state transitions.
 *
 * Progress events from `XMLHttpRequest` are forwarded to the store so the
 * UploadZone progress bar stays in sync with Redux state rather than local
 * component state.
 */
export function uploadFile(file: File): AppThunk {
  return async (dispatch) => {
    dispatch(uploadStarted());

    try {
      const result = await uploadGeoJSON(file, (pct) =>
        dispatch(uploadProgressUpdated(pct))
      );

      dispatch(uploadSucceeded(result));

      const { summary } = result;
      toast.success(
        `Loaded ${summary.total_features} features — ` +
          `${summary.invalid_features} issues, ` +
          `${summary.duplicate_groups} duplicate groups`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      dispatch(uploadFailed(message));
      toast.error(message);
    }
  };
}

/**
 * Submit the current (possibly edited) FeatureCollection to the backend for
 * a full re-analysis and update all dashboard panels with the fresh result.
 */
export function analyseCurrentFC(): AppThunk {
  return async (dispatch, getState) => {
    const { dashboard } = getState();
    const fc = dashboard.pendingFC ?? dashboard.featureCollection;
    if (!fc) return;

    dispatch(analyseStarted());

    try {
      const result = await updateGeoJSON(fc);
      dispatch(analyseSucceeded(result));

      const { summary } = result;
      toast.success(
        `Analysis complete — ${summary.total_features} features, ` +
          `${summary.invalid_features} issues, ` +
          `${summary.duplicate_groups} duplicate groups`
      );
    } catch (err) {
      dispatch(analyseFailed());
      toast.error(err instanceof Error ? err.message : "Analysis failed");
    }
  };
}
