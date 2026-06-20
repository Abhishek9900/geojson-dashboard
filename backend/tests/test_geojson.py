"""
Backend test suite.

Covers:
  - File validation (extension, size, JSON, GeoJSON structure).
  - GeoJSONProcessingService unit tests (valid, invalid, duplicate, null geometry).
  - API endpoint integration tests (upload, update, validate, health).

Run with::

    pytest tests/ -v
"""

import json
from io import BytesIO

import pytest
from httpx import ASGITransport, AsyncClient

from app.models.geojson_models import FeatureCollectionModel
from app.services.geojson_service import GeoJSONProcessingService
from main import app

# ---------------------------------------------------------------------------
# Shared test fixtures (plain dicts — parsed lazily inside tests)
# ---------------------------------------------------------------------------

VALID_GEOJSON: dict = {
    "type": "FeatureCollection",
    "name": "Test",
    "features": [
        {
            "type": "Feature",
            "properties": {"fid": 1, "producttype": "Coffee", "DRI": 6.0},
            "geometry": {
                "type": "Polygon",
                "coordinates": [
                    [
                        [-73.195938, 6.482256],
                        [-73.195932, 6.482386],
                        [-73.196260, 6.482655],
                        [-73.196266, 6.482525],
                        [-73.195938, 6.482256],
                    ]
                ],
            },
        },
        {
            "type": "Feature",
            "properties": {"fid": 2, "producttype": "Corn", "DRI": 3.0},
            "geometry": {
                "type": "Polygon",
                "coordinates": [
                    [
                        [-73.196, 6.483],
                        [-73.197, 6.483],
                        [-73.197, 6.484],
                        [-73.196, 6.484],
                        [-73.196, 6.483],
                    ]
                ],
            },
        },
    ],
}

# Two features with identical geometry — should be flagged as a duplicate group.
DUPLICATE_GEOJSON: dict = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {"fid": 1},
            "geometry": {
                "type": "Polygon",
                "coordinates": [
                    [
                        [-73.195938, 6.482256],
                        [-73.195932, 6.482386],
                        [-73.196260, 6.482655],
                        [-73.195938, 6.482256],
                    ]
                ],
            },
        },
        {
            "type": "Feature",
            "properties": {"fid": 2},
            "geometry": {
                "type": "Polygon",
                "coordinates": [
                    [
                        [-73.195938, 6.482256],
                        [-73.195932, 6.482386],
                        [-73.196260, 6.482655],
                        [-73.195938, 6.482256],
                    ]
                ],
            },
        },
    ],
}

# Self-intersecting bowtie polygon — Shapely will flag this as invalid.
INVALID_GEOMETRY_GEOJSON: dict = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {},
            "geometry": {
                "type": "Polygon",
                "coordinates": [
                    [
                        [0, 0],
                        [2, 2],
                        [2, 0],
                        [0, 2],
                        [0, 0],
                    ]
                ],
            },
        }
    ],
}

NULL_GEOMETRY_GEOJSON: dict = {
    "type": "FeatureCollection",
    "features": [{"type": "Feature", "properties": {}, "geometry": None}],
}


def _upload_file(
    data: dict, filename: str = "test.geojson"
) -> tuple[str, tuple[str, BytesIO, str]]:
    """Build an httpx-compatible file tuple for multipart upload tests."""
    content = json.dumps(data).encode()
    return ("file", (filename, BytesIO(content), "application/geo+json"))


# ---------------------------------------------------------------------------
# Service unit tests
# ---------------------------------------------------------------------------


class TestGeoJSONProcessingService:
    """Unit tests for GeoJSONProcessingService in isolation."""

    def setup_method(self) -> None:
        self.service = GeoJSONProcessingService()

    # --- happy path ---

    def test_valid_collection_all_features_valid(self) -> None:
        fc = FeatureCollectionModel(**VALID_GEOJSON)
        features, summary = self.service.process_feature_collection(fc)

        assert summary.total_features == 2
        assert summary.valid_features == 2
        assert summary.invalid_features == 0
        assert summary.duplicate_groups == 0
        assert summary.issues == []

    def test_geometry_type_counts_correct(self) -> None:
        fc = FeatureCollectionModel(**VALID_GEOJSON)
        _, summary = self.service.process_feature_collection(fc)

        assert summary.geometry_types.get("Polygon") == 2

    def test_centroid_computed_for_valid_polygons(self) -> None:
        fc = FeatureCollectionModel(**VALID_GEOJSON)
        features, _ = self.service.process_feature_collection(fc)

        for f in features:
            assert f.centroid is not None, "Expected centroid for valid polygon"
            assert "lat" in f.centroid
            assert "lon" in f.centroid

    def test_area_computed_for_valid_polygons(self) -> None:
        fc = FeatureCollectionModel(**VALID_GEOJSON)
        features, _ = self.service.process_feature_collection(fc)

        for f in features:
            assert f.area_m2 is not None
            assert f.area_m2 > 0

    # --- duplicate detection ---

    def test_exact_duplicates_detected(self) -> None:
        fc = FeatureCollectionModel(**DUPLICATE_GEOJSON)
        features, summary = self.service.process_feature_collection(fc)

        assert summary.duplicate_groups == 1
        assert summary.total_duplicates == 1

    def test_first_duplicate_not_flagged(self) -> None:
        """The first occurrence in a duplicate group should be the kept copy."""
        fc = FeatureCollectionModel(**DUPLICATE_GEOJSON)
        features, _ = self.service.process_feature_collection(fc)

        assert not features[0].is_duplicate
        assert features[1].is_duplicate

    def test_duplicate_group_id_assigned(self) -> None:
        fc = FeatureCollectionModel(**DUPLICATE_GEOJSON)
        features, _ = self.service.process_feature_collection(fc)

        assert features[1].duplicate_group_id == 0

    # --- invalid geometry ---

    def test_invalid_geometry_detected(self) -> None:
        fc = FeatureCollectionModel(**INVALID_GEOMETRY_GEOJSON)
        _, summary = self.service.process_feature_collection(fc)

        assert summary.invalid_features >= 1
        issue_types = [i.issue_type for i in summary.issues]
        assert "invalid_geometry" in issue_types

    def test_auto_fix_available_for_invalid_geometry(self) -> None:
        fc = FeatureCollectionModel(**INVALID_GEOMETRY_GEOJSON)
        _, summary = self.service.process_feature_collection(fc)

        fixable = [i for i in summary.issues if i.auto_fix_available]
        assert len(fixable) >= 1
        assert fixable[0].fixed_geometry is not None

    # --- null geometry ---

    def test_null_geometry_flagged(self) -> None:
        fc = FeatureCollectionModel(**NULL_GEOMETRY_GEOJSON)
        _, summary = self.service.process_feature_collection(fc)

        assert summary.invalid_features == 1
        assert any(i.issue_type == "null_geometry" for i in summary.issues)

    def test_null_geometry_not_auto_fixable(self) -> None:
        fc = FeatureCollectionModel(**NULL_GEOMETRY_GEOJSON)
        _, summary = self.service.process_feature_collection(fc)

        null_issues = [i for i in summary.issues if i.issue_type == "null_geometry"]
        assert all(not i.auto_fix_available for i in null_issues)

    # --- edge cases ---

    def test_empty_feature_collection(self) -> None:
        fc = FeatureCollectionModel(**{"type": "FeatureCollection", "features": []})
        features, summary = self.service.process_feature_collection(fc)

        assert summary.total_features == 0
        assert summary.valid_features == 0
        assert summary.duplicate_groups == 0

    def test_single_feature_not_flagged_as_duplicate(self) -> None:
        fc = FeatureCollectionModel(**VALID_GEOJSON)
        features, _ = self.service.process_feature_collection(fc)

        assert not any(f.is_duplicate for f in features)

    def test_feature_index_matches_position(self) -> None:
        fc = FeatureCollectionModel(**VALID_GEOJSON)
        features, _ = self.service.process_feature_collection(fc)

        for i, f in enumerate(features):
            assert f.index == i


# ---------------------------------------------------------------------------
# API endpoint integration tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestUploadEndpoint:
    """Integration tests for POST /api/geojson/upload."""

    async def test_upload_valid_geojson_returns_200(self) -> None:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/api/geojson/upload", files=[_upload_file(VALID_GEOJSON)]
            )

        assert response.status_code == 200
        body = response.json()
        assert body["summary"]["total_features"] == 2
        assert body["filename"] == "test.geojson"
        assert "features" in body

    async def test_upload_non_geojson_extension_returns_400(self) -> None:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/api/geojson/upload",
                files=[("file", ("data.json", BytesIO(b"{}"), "application/json"))],
            )

        assert response.status_code == 400
        assert "geojson" in response.json()["detail"].lower()

    async def test_upload_invalid_json_returns_400(self) -> None:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/api/geojson/upload",
                files=[
                    (
                        "file",
                        (
                            "bad.geojson",
                            BytesIO(b"not json!!!"),
                            "application/geo+json",
                        ),
                    )
                ],
            )

        assert response.status_code == 400

    async def test_upload_wrong_geojson_type_returns_400(self) -> None:
        data = {"type": "Topology", "objects": {}}
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/api/geojson/upload", files=[_upload_file(data)]
            )

        assert response.status_code == 400

    async def test_upload_missing_features_key_returns_400(self) -> None:
        data = {"type": "FeatureCollection"}  # no "features" key
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/api/geojson/upload", files=[_upload_file(data)]
            )

        assert response.status_code == 400

    async def test_upload_detects_duplicate_groups(self) -> None:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/api/geojson/upload", files=[_upload_file(DUPLICATE_GEOJSON)]
            )

        assert response.status_code == 200
        assert response.json()["summary"]["duplicate_groups"] == 1

    async def test_upload_detects_invalid_geometry(self) -> None:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/api/geojson/upload",
                files=[_upload_file(INVALID_GEOMETRY_GEOJSON)],
            )

        assert response.status_code == 200
        assert response.json()["summary"]["invalid_features"] >= 1

    async def test_upload_null_geometry_feature(self) -> None:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/api/geojson/upload",
                files=[_upload_file(NULL_GEOMETRY_GEOJSON)],
            )

        assert response.status_code == 200
        assert response.json()["summary"]["invalid_features"] == 1


@pytest.mark.asyncio
class TestSaveEndpoint:
    """Integration tests for POST /api/geojson/save."""

    async def test_save_valid_collection_returns_200(self) -> None:
        payload = {"feature_collection": VALID_GEOJSON}
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post("/api/geojson/save", json=payload)

        assert response.status_code == 200
        body = response.json()
        # Response shape must be identical to /upload.
        assert "summary" in body
        assert "features" in body
        assert body["summary"]["total_features"] == 2

    async def test_save_detects_duplicates(self) -> None:
        payload = {"feature_collection": DUPLICATE_GEOJSON}
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post("/api/geojson/save", json=payload)

        assert response.status_code == 200
        assert response.json()["summary"]["duplicate_groups"] == 1

    async def test_save_empty_collection(self) -> None:
        payload = {"feature_collection": {"type": "FeatureCollection", "features": []}}
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post("/api/geojson/save", json=payload)

        assert response.status_code == 200
        assert response.json()["summary"]["total_features"] == 0


@pytest.mark.asyncio
class TestHealthEndpoint:
    """Integration tests for GET /health."""

    async def test_health_returns_ok(self) -> None:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.get("/health")

        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "ok"
        assert "version" in body
