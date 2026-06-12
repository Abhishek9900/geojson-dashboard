/**
 * API client for the FastAPI backend.
 *
 * All HTTP communication is centralised here so the rest of the frontend
 * never imports ``fetch`` directly.  Error handling normalises backend
 * error shapes to plain ``Error`` objects with human-readable messages.
 */

import type { FeatureCollection } from "geojson";
import type { ProcessGeoJSONResponse } from "@/types";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Assert the response is OK, parse JSON, and cast to ``T``.
 *
 * Extracts the ``detail`` or ``error`` field from FastAPI error bodies so
 * the message shown to users is descriptive rather than just "HTTP 422".
 */
async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      detail = body.detail || body.error || detail;
    } catch {
      // Body may not be JSON (e.g. nginx gateway errors) — fall through.
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// GeoJSON endpoints
// ---------------------------------------------------------------------------

/**
 * Upload a ``.geojson`` file for processing.
 *
 * Uses ``XMLHttpRequest`` when ``onProgress`` is provided so upload progress
 * events can be reported; falls back to ``fetch`` otherwise.
 *
 * @param file       The file chosen by the user.
 * @param onProgress Optional callback receiving upload percentage (0–100).
 * @returns          A full ``ProcessGeoJSONResponse`` with summary and features.
 */
export async function uploadGeoJSON(
  file: File,
  onProgress?: (percent: number) => void
): Promise<ProcessGeoJSONResponse> {
  const formData = new FormData();
  formData.append("file", file);

  if (onProgress) {
    return new Promise<ProcessGeoJSONResponse>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${BASE_URL}/api/geojson/upload`);

      xhr.upload.onprogress = (evt) => {
        if (evt.lengthComputable) {
          onProgress(Math.round((evt.loaded / evt.total) * 100));
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText) as ProcessGeoJSONResponse);
        } else {
          let detail = `HTTP ${xhr.status}`;
          try {
            detail = JSON.parse(xhr.responseText).detail || detail;
          } catch {
            // Non-JSON error body — use the status code message.
          }
          reject(new Error(detail));
        }
      };

      xhr.onerror = () => reject(new Error("Network error during upload."));
      xhr.send(formData);
    });
  }

  const response = await fetch(`${BASE_URL}/api/geojson/upload`, {
    method: "POST",
    body: formData,
  });
  return handleResponse<ProcessGeoJSONResponse>(response);
}

/**
 * Submit an edited FeatureCollection for re-validation and analysis.
 *
 * Called when the user clicks *Save & Analyse* in the dashboard header.
 * The response shape is identical to {@link uploadGeoJSON} so the frontend
 * can refresh all panels with the same code path.
 */
export async function updateGeoJSON(
  featureCollection: FeatureCollection
): Promise<ProcessGeoJSONResponse> {
  const response = await fetch(`${BASE_URL}/api/geojson/update`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ feature_collection: featureCollection }),
  });
  return handleResponse<ProcessGeoJSONResponse>(response);
}

/**
 * Lightweight liveness check — verifies the backend is reachable.
 */
export async function checkHealth(): Promise<{ status: string }> {
  const response = await fetch(`${BASE_URL}/health`);
  return handleResponse<{ status: string }>(response);
}
