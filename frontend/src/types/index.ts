/**
 * Shared TypeScript types for the GeoJSON Dashboard.
 * These mirror the Pydantic models defined in the FastAPI backend.
 */

import type { Feature, FeatureCollection, GeoJsonProperties, Geometry } from "geojson";

// ---------------------------------------------------------------------------
// API response types
// ---------------------------------------------------------------------------

export interface GeometryIssue {
  feature_index: number;
  feature_id: string | number | null;
  issue_type: string;
  description: string;
  auto_fix_available: boolean;
  fixed_geometry?: Record<string, unknown> | null;
}

export interface DuplicateGroup {
  group_id: number;
  feature_indices: number[];
  feature_ids: Array<string | number | null>;
  duplicate_type: "exact" | "near_exact";
  description: string;
}

export interface AnalysisSummary {
  total_features: number;
  valid_features: number;
  invalid_features: number;
  duplicate_groups: number;
  total_duplicates: number;
  geometry_types: Record<string, number>;
  issues: GeometryIssue[];
  duplicate_groups_detail: DuplicateGroup[];
}

export interface ProcessedFeature {
  index: number;
  feature: Feature<Geometry, GeoJsonProperties>;
  is_valid: boolean;
  issues: string[];
  is_duplicate: boolean;
  duplicate_group_id: number | null;
  area_m2: number | null;
  centroid: { lat: number; lon: number } | null;
}

export interface ProcessGeoJSONResponse {
  filename: string;
  file_size_bytes: number;
  summary: AnalysisSummary;
  features: ProcessedFeature[];
}

export interface UpdateFeaturesResponse {
  success: boolean;
  message: string;
  updated_collection: FeatureCollection;
}

// ---------------------------------------------------------------------------
// UI state types
// ---------------------------------------------------------------------------

export type UploadStatus = "idle" | "uploading" | "success" | "error";

export interface DashboardState {
  uploadStatus: UploadStatus;
  filename: string | null;
  response: ProcessGeoJSONResponse | null;
  featureCollection: FeatureCollection | null;
  selectedFeatureIndex: number | null;
  error: string | null;
}

export type FeatureFilter = "all" | "valid" | "invalid" | "duplicate";

// ---------------------------------------------------------------------------
// Map types
// ---------------------------------------------------------------------------

export interface MapViewState {
  longitude: number;
  latitude: number;
  zoom: number;
}
