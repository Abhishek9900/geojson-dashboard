"""
Pydantic models for GeoJSON data structures and API responses.

These mirror the GeoJSON spec (RFC 7946) at a structural level and add
application-specific analysis and API response shapes.
"""

from enum import Enum
from typing import Any, Dict, List, Optional, Union

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
    coordinates: Optional[Any] = None
    # Only present for GeometryCollection; ignored for all other types.
    geometries: Optional[List[Any]] = None


class FeatureModel(BaseModel):
    """Represents a GeoJSON Feature object."""

    type: str = "Feature"
    properties: Optional[Dict[str, Any]] = None
    geometry: Optional[GeometryModel] = None
    # Feature ids may be strings or integers per RFC 7946 §3.2.
    id: Optional[Union[str, int]] = None


class FeatureCollectionModel(BaseModel):
    """Represents a GeoJSON FeatureCollection object."""

    type: str = "FeatureCollection"
    name: Optional[str] = None
    # CRS member is non-standard but common in legacy GeoJSON files.
    crs: Optional[Dict[str, Any]] = None
    features: List[FeatureModel] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Analysis result models
# ---------------------------------------------------------------------------


class GeometryIssue(BaseModel):
    """Describes a geometry problem found during processing."""

    feature_index: int
    feature_id: Optional[Union[str, int]] = None
    # Short machine-readable label, e.g. "invalid_geometry", "null_geometry".
    issue_type: str
    description: str
    # True when the service was able to compute a corrected geometry via make_valid.
    auto_fix_available: bool = False
    fixed_geometry: Optional[Dict[str, Any]] = None


class DuplicateGroup(BaseModel):
    """A set of features that share identical (or near-identical) geometries."""

    group_id: int
    feature_indices: List[int]
    feature_ids: List[Optional[Union[str, int]]]
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
    geometry_types: Dict[str, int]
    issues: List[GeometryIssue]
    duplicate_groups_detail: List[DuplicateGroup]


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
    issues: List[str]
    is_duplicate: bool
    # Set only when is_duplicate is True.
    duplicate_group_id: Optional[int] = None
    # Rough area approximation in square metres (None for non-area geometries).
    area_m2: Optional[float] = None
    centroid: Optional[Dict[str, float]] = None


class ProcessGeoJSONResponse(BaseModel):
    """Full response returned after uploading or re-analysing a GeoJSON file."""

    filename: str
    file_size_bytes: int
    summary: AnalysisSummary
    features: List[ProcessedFeature]


class UpdateFeaturesRequest(BaseModel):
    """Request body for the /update endpoint (post-edit re-analysis)."""

    feature_collection: FeatureCollectionModel
