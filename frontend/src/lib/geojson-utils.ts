/**
 * GeoJSON utility functions used across the frontend.
 *
 * All functions are pure / side-effect-free unless noted (downloadGeoJSON
 * triggers a browser download as a deliberate side-effect).
 */

import type { BBox, Feature, FeatureCollection, Geometry } from "geojson";
import type { MapViewState } from "@/types";

// ---------------------------------------------------------------------------
// Bounding box helpers
// ---------------------------------------------------------------------------

/**
 * Walk any coordinate array recursively, calling ``visitor`` on each
 * ``[lon, lat]`` leaf pair.
 */
function walkCoordinates(
  coords: unknown,
  visitor: (lon: number, lat: number) => void
): void {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === "number") {
    visitor(coords[0] as number, coords[1] as number);
  } else {
    for (const child of coords) walkCoordinates(child, visitor);
  }
}

/**
 * Compute the geographic bounding box for all features in a collection.
 *
 * @returns ``[minLon, minLat, maxLon, maxLat]`` or ``null`` when no valid
 *   coordinates are found (empty collection or all null geometries).
 */
export function computeBBox(fc: FeatureCollection): BBox | null {
  let minLon = Infinity,
    minLat = Infinity,
    maxLon = -Infinity,
    maxLat = -Infinity;
  let hasCoords = false;

  for (const feature of fc.features) {
    if (!feature.geometry) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    walkCoordinates((feature.geometry as any).coordinates ?? [], (lon, lat) => {
      minLon = Math.min(minLon, lon);
      minLat = Math.min(minLat, lat);
      maxLon = Math.max(maxLon, lon);
      maxLat = Math.max(maxLat, lat);
      hasCoords = true;
    });
  }

  return hasCoords ? [minLon, minLat, maxLon, maxLat] : null;
}

/**
 * Compute the bounding box of a single feature.
 *
 * @returns ``null`` when the feature has no geometry or no coordinates.
 */
export function computeFeatureBBox(feature: Feature<Geometry>): BBox | null {
  if (!feature.geometry) return null;
  return computeBBox({ type: "FeatureCollection", features: [feature] });
}

// ---------------------------------------------------------------------------
// Map view state
// ---------------------------------------------------------------------------

/**
 * Derive an initial map view state that centres on the data.
 *
 * The ``zoom`` value is a fallback only — the map component calls
 * ``fitBounds`` with padding, which overrides this zoom.
 */
export function getInitialViewState(fc: FeatureCollection): MapViewState {
  const bbox = computeBBox(fc);
  if (!bbox) return { longitude: 0, latitude: 20, zoom: 2 };

  const [minLon, minLat, maxLon, maxLat] = bbox;
  return {
    longitude: (minLon + maxLon) / 2,
    latitude: (minLat + maxLat) / 2,
    zoom: 12,
  };
}

// ---------------------------------------------------------------------------
// File download
// ---------------------------------------------------------------------------

/**
 * Trigger a browser download of a FeatureCollection as a ``.geojson`` file.
 *
 * The object URL is revoked immediately after the click to avoid memory leaks.
 */
export function downloadGeoJSON(fc: FeatureCollection, filename: string): void {
  const blob = new Blob([JSON.stringify(fc, null, 2)], {
    type: "application/geo+json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".geojson") ? filename : `${filename}.geojson`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/**
 * Format a byte count as a human-readable string.
 *
 * @example formatBytes(1536) // → "1.5 KB"
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

/**
 * Return a hex colour for a feature based on its processing status.
 *
 * Priority order: selected > duplicate > invalid > valid.
 */
export function getFeatureColor(
  isValid: boolean,
  isDuplicate: boolean,
  isSelected: boolean
): string {
  if (isSelected) return "#f59e0b"; // amber-400
  if (isDuplicate) return "#8b5cf6"; // violet-500
  if (!isValid) return "#ef4444"; // red-500
  return "#22c55e"; // green-500
}

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

/**
 * Narrow an unknown value to a GeoJSON ``Geometry`` object.
 *
 * Only checks the presence of a ``type`` field — a full structural check
 * is left to the backend validator.
 */
export function isGeometry(obj: unknown): obj is Geometry {
  return typeof obj === "object" && obj !== null && "type" in obj;
}

// ---------------------------------------------------------------------------
// Legend filter type
// ---------------------------------------------------------------------------

/** Legend category used by the map filter interaction. */
export type LegendFilter = "valid" | "invalid" | "duplicate" | "selected" | null;
