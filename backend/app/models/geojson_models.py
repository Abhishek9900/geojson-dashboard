"""
Pydantic models for GeoJSON data structures and API responses.

These mirror the GeoJSON spec (RFC 7946) at a structural level and add
application-specific analysis and API response shapes.
"""

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# GeoJSON geometry models
# ---------------------------------------------------------------------------


class GeometryType(str, Enum):
    """Enumeration of the seven GeoJSON geometry types (RFC 7946 §3.1)."""

    POINT = "Point"
    LINESTRING = "LineString"
    POLYGON = "Polygon"
    MULTI_POINT = "MultiPoint"
    MULTI_LINESTRING = "MultiLineString"
    MULTI_POLYGON = "MultiPolygon"
    GEOMETRY_COLLECTION = "GeometryCollection"


class GeometryModel(BaseModel):
    """Represents a GeoJSON geometry object."""

    type: str
    coordinates: Any | None = None
    # Only present for GeometryCollection; ignored for all other types.
    geometries: list[Any] | None = None


class FeatureModel(BaseModel):
    """Represents a GeoJSON Feature object."""

    type: str = "Feature"
    properties: dict[str, Any] | None = None
    geometry: GeometryModel | None = None
    # Feature ids may be strings or integers per RFC 7946 §3.2.
    id: str | int | None = None


class FeatureCollectionModel(BaseModel):
    """Represents a GeoJSON FeatureCollection object."""

    type: str = "FeatureCollection"
    name: str | None = None
    # CRS member is non-standard but common in legacy GeoJSON files.
    crs: dict[str, Any] | None = None
    features: list[FeatureModel] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Analysis result models
# ---------------------------------------------------------------------------


class GeometryIssue(BaseModel):
    """Describes a geometry problem found during processing."""

    feature_index: int
    feature_id: str | int | None = None
    # Short machine-readable label, e.g. "invalid_geometry", "null_geometry".
    issue_type: str
    description: str
    # True when the service was able to compute a corrected geometry via make_valid.
    auto_fix_available: bool = False
    fixed_geometry: dict[str, Any] | None = None


class DuplicateGroup(BaseModel):
    """A set of features that share identical (or near-identical) geometries."""

    group_id: int
    feature_indices: list[int]
    feature_ids: list[str | int | None]
    # "exact" = same coordinate hash; "near_exact" = within tolerance.
    duplicate_type: str
    description: str


class AnalysisSummary(BaseModel):
    """Aggregated results from processing a FeatureCollection."""

    total_features: int
    valid_features: int
    invalid_features: int
    duplicate_groups: int
    total_duplicates: int
    # Maps geometry type name to count, e.g. {"Polygon": 42, "Point": 3}.
    geometry_types: dict[str, int]
    issues: list[GeometryIssue]
    duplicate_groups_detail: list[DuplicateGroup]


# ---------------------------------------------------------------------------
# API request / response models
# ---------------------------------------------------------------------------


class ProcessedFeature(BaseModel):
    """A GeoJSON feature enriched with processing metadata."""

    # Position in the original input array (stable across re-analyses).
    index: int
    feature: FeatureModel
    is_valid: bool
    # Human-readable issue labels, e.g. ["invalid: Self-intersection"].
    issues: list[str]
    is_duplicate: bool
    # Set only when is_duplicate is True.
    duplicate_group_id: int | None = None
    # Rough area approximation in square metres (None for non-area geometries).
    area_m2: float | None = None
    centroid: dict[str, float] | None = None


class ProcessGeoJSONResponse(BaseModel):
    """Full response returned after uploading or re-analysing a GeoJSON file."""

    filename: str
    file_size_bytes: int
    summary: AnalysisSummary
    features: list[ProcessedFeature]


class SaveFeaturesRequest(BaseModel):
    """Request body for the /save endpoint (post-edit re-analysis)."""

    feature_collection: FeatureCollectionModel
