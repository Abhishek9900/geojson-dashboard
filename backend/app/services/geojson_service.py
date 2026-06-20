"""
GeoJSON Processing Service.

Responsible for:
  - Per-feature geometry validation (using Shapely).
  - Automatic geometry repair via ``make_valid``.
  - Basic metric computation (area, centroid).
  - Exact duplicate detection via geometry hash.
  - Building the aggregated AnalysisSummary.
"""

import hashlib
import json

from loguru import logger
from shapely.geometry import mapping, shape
from shapely.ops import (
    unary_union,  # noqa: F401 — available for future near-dup detection
)
from shapely.validation import explain_validity, make_valid

from app.models.geojson_models import (
    AnalysisSummary,
    DuplicateGroup,
    FeatureCollectionModel,
    FeatureModel,
    GeometryIssue,
    ProcessedFeature,
)


class GeoJSONProcessingService:
    """
    Core service for processing GeoJSON FeatureCollections.

    Usage::

        service = GeoJSONProcessingService()
        features, summary = service.process_feature_collection(fc)
    """

    # Coordinate tolerance for near-duplicate detection (degrees ≈ 1 m at equator).
    # Not used for exact detection but kept here for future near-dup work.
    NEAR_DUPLICATE_TOLERANCE: float = 1e-7

    # Rough degrees² → m² conversion factor (valid near the equator).
    _AREA_SCALE: float = 1e10

    def process_feature_collection(
        self,
        feature_collection: FeatureCollectionModel,
    ) -> tuple[list[ProcessedFeature], AnalysisSummary]:
        """
        Validate, enrich, and summarise all features in a FeatureCollection.

        Processing pipeline:
          1. Validate each feature individually and compute basic metrics.
          2. Detect exact duplicate geometries across the whole collection.
          3. Mark duplicates and assemble the summary.

        Args:
            feature_collection: Parsed GeoJSON FeatureCollection.

        Returns:
            A ``(processed_features, summary)`` tuple.
        """
        n = len(feature_collection.features)
        logger.info(f"Processing {n} features")

        processed: list[ProcessedFeature] = []
        issues: list[GeometryIssue] = []
        geometry_type_counts: dict[str, int] = {}

        # Step 1 — per-feature validation.
        for idx, feature in enumerate(feature_collection.features):
            pf, geom_issues = self._process_single_feature(idx, feature)
            processed.append(pf)
            issues.extend(geom_issues)

            geom_type = feature.geometry.type if feature.geometry else "null"
            geometry_type_counts[geom_type] = geometry_type_counts.get(geom_type, 0) + 1

        # Step 2 — duplicate detection.
        duplicate_groups = self._detect_duplicates(processed)
        self._mark_duplicates(processed, duplicate_groups)

        # Step 3 — aggregate summary.
        valid_count = sum(1 for pf in processed if pf.is_valid)
        total_duplicates = sum(len(g.feature_indices) - 1 for g in duplicate_groups)

        summary = AnalysisSummary(
            total_features=len(processed),
            valid_features=valid_count,
            invalid_features=len(processed) - valid_count,
            duplicate_groups=len(duplicate_groups),
            total_duplicates=total_duplicates,
            geometry_types=geometry_type_counts,
            issues=issues,
            duplicate_groups_detail=duplicate_groups,
        )

        logger.info(
            f"Processing complete: {valid_count}/{len(processed)} valid, "
            f"{len(duplicate_groups)} duplicate groups"
        )
        return processed, summary

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _feature_id(self, feature: FeatureModel) -> str | int | None:
        """Extract a displayable id from a feature (``id`` field or ``fid`` property)."""
        return feature.id or (
            feature.properties.get("fid") if feature.properties else None
        )

    def _process_single_feature(
        self,
        idx: int,
        feature: FeatureModel,
    ) -> tuple[ProcessedFeature, list[GeometryIssue]]:
        """
        Validate a single feature and compute area / centroid metrics.

        Args:
            idx:     Zero-based position in the parent FeatureCollection.
            feature: The feature to process.

        Returns:
            A ``(ProcessedFeature, issues)`` pair.  Issues are also embedded
            in the ProcessedFeature for quick access.
        """
        issues: list[GeometryIssue] = []
        issue_labels: list[str] = []
        is_valid = True
        area_m2: float | None = None
        centroid: dict[str, float] | None = None
        feature_id = self._feature_id(feature)

        if feature.geometry is None:
            issues.append(
                GeometryIssue(
                    feature_index=idx,
                    feature_id=feature_id,
                    issue_type="null_geometry",
                    description="Feature has no geometry.",
                    auto_fix_available=False,
                )
            )
            issue_labels.append("null_geometry")
            is_valid = False

        else:
            try:
                shapely_geom = shape(feature.geometry.model_dump(exclude_none=True))

                if shapely_geom.is_empty:
                    issues.append(
                        GeometryIssue(
                            feature_index=idx,
                            feature_id=feature_id,
                            issue_type="empty_geometry",
                            description="Geometry is empty (no coordinates).",
                            auto_fix_available=False,
                        )
                    )
                    issue_labels.append("empty_geometry")
                    is_valid = False

                elif not shapely_geom.is_valid:
                    reason = explain_validity(shapely_geom)
                    fixed = make_valid(shapely_geom)
                    issues.append(
                        GeometryIssue(
                            feature_index=idx,
                            feature_id=feature_id,
                            issue_type="invalid_geometry",
                            description=f"Geometry is invalid: {reason}",
                            auto_fix_available=True,
                            fixed_geometry=mapping(fixed),
                        )
                    )
                    issue_labels.append(f"invalid: {reason}")
                    is_valid = False
                    # Use the repaired geometry for metric computation.
                    shapely_geom = fixed

                # Compute metrics for any polygon-like geometry.
                if hasattr(shapely_geom, "area"):
                    area_m2 = round(shapely_geom.area * self._AREA_SCALE, 4)
                if hasattr(shapely_geom, "centroid"):
                    c = shapely_geom.centroid
                    centroid = {"lon": round(c.x, 8), "lat": round(c.y, 8)}

            except Exception as exc:
                logger.warning(f"Feature {idx}: geometry parse error — {exc}")
                issues.append(
                    GeometryIssue(
                        feature_index=idx,
                        feature_id=feature_id,
                        issue_type="parse_error",
                        description=f"Could not parse geometry: {exc}",
                        auto_fix_available=False,
                    )
                )
                issue_labels.append("parse_error")
                is_valid = False

        return (
            ProcessedFeature(
                index=idx,
                feature=feature,
                is_valid=is_valid,
                issues=issue_labels,
                is_duplicate=False,
                area_m2=area_m2,
                centroid=centroid,
            ),
            issues,
        )

    def _geometry_hash(self, feature: FeatureModel) -> str | None:
        """
        Produce a deterministic SHA-256 hash of a feature's geometry coordinates.

        Coordinate order and values are preserved exactly so that only
        geometrically identical features produce the same hash.

        Returns ``None`` for features with null or un-serialisable geometry.
        """
        if feature.geometry is None:
            return None
        try:
            coords_str = json.dumps(
                feature.geometry.model_dump(exclude_none=True),
                sort_keys=True,
            )
            return hashlib.sha256(coords_str.encode()).hexdigest()
        except Exception:
            return None

    def _detect_duplicates(
        self,
        processed: list[ProcessedFeature],
    ) -> list[DuplicateGroup]:
        """
        Group features that share an identical geometry hash.

        Only groups with two or more members are returned; singletons are ignored.

        Args:
            processed: All processed features for the collection.

        Returns:
            A list of ``DuplicateGroup`` objects, one per group.
        """
        # Map geometry hash → list of feature indices.
        hash_map: dict[str, list[int]] = {}
        for pf in processed:
            h = self._geometry_hash(pf.feature)
            if h is not None:
                hash_map.setdefault(h, []).append(pf.index)

        groups: list[DuplicateGroup] = []
        for group_id, indices in enumerate(
            indices for indices in hash_map.values() if len(indices) >= 2
        ):
            feature_ids = [self._feature_id(processed[i].feature) for i in indices]
            groups.append(
                DuplicateGroup(
                    group_id=group_id,
                    feature_indices=indices,
                    feature_ids=feature_ids,
                    duplicate_type="exact",
                    description=(
                        f"{len(indices)} features share identical geometry coordinates."
                    ),
                )
            )

        logger.debug(f"Found {len(groups)} duplicate groups")
        return groups

    def _mark_duplicates(
        self,
        processed: list[ProcessedFeature],
        groups: list[DuplicateGroup],
    ) -> None:
        """
        Flag duplicate features in-place.

        The *first* occurrence in each group is kept as the canonical feature;
        all subsequent occurrences are marked as duplicates.

        Args:
            processed: The full list of ProcessedFeature objects (mutated in-place).
            groups:    Duplicate groups produced by ``_detect_duplicates``.
        """
        for group in groups:
            # Keep feature_indices[0] as the original; flag the rest.
            for idx in group.feature_indices[1:]:
                processed[idx].is_duplicate = True
                processed[idx].duplicate_group_id = group.group_id
