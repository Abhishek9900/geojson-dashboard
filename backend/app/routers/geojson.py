"""
GeoJSON API Router.

Endpoints:
  POST /upload — upload a .geojson file, get back a full analysis report.
  POST /save   — re-analyse an edited FeatureCollection (called by the Save button).
"""

import json

from fastapi import APIRouter, File, HTTPException, UploadFile, status
from loguru import logger

from app.models.geojson_models import (
    FeatureCollectionModel,
    ProcessGeoJSONResponse,
    SaveFeaturesRequest,
)
from app.services.geojson_service import GeoJSONProcessingService
from app.utils.file_validation import read_and_validate_geojson

router = APIRouter()
_service = GeoJSONProcessingService()


@router.post(
    "/upload",
    response_model=ProcessGeoJSONResponse,
    summary="Upload and process a GeoJSON file",
    description=(
        "Accepts a .geojson file, validates it, detects duplicate and invalid "
        "geometries, and returns a full processing report."
    ),
)
async def upload_geojson(
    file: UploadFile = File(..., description="A .geojson file to process"),  # noqa: B008
) -> ProcessGeoJSONResponse:
    """
    Validate, parse, and analyse a GeoJSON FeatureCollection uploaded as a file.

    Raises:
        HTTPException 400: invalid file extension, bad JSON, or wrong GeoJSON type.
        HTTPException 413: file exceeds the configured size limit.
        HTTPException 500: unexpected processing error.
    """
    filename = file.filename or "unknown.geojson"

    try:
        raw_data = await read_and_validate_geojson(file)

        # Compute approximate payload size from the serialised form.
        file_size = len(json.dumps(raw_data).encode())

        feature_collection = FeatureCollectionModel(**raw_data)
        processed_features, summary = _service.process_feature_collection(
            feature_collection
        )

        return ProcessGeoJSONResponse(
            filename=filename,
            file_size_bytes=file_size,
            summary=summary,
            features=processed_features,
        )

    except HTTPException:
        # Re-raise validation errors from read_and_validate_geojson as-is.
        raise
    except Exception as exc:
        logger.exception(f"Unexpected error processing '{filename}': {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An unexpected error occurred while processing the file: {exc}",
        ) from exc


@router.post(
    "/save",
    response_model=ProcessGeoJSONResponse,
    summary="Save and re-analyse an edited FeatureCollection",
    description=(
        "Accepts an edited FeatureCollection (from the map or table editor) and "
        "returns it re-validated. The response shape is identical to /upload so "
        "the frontend can refresh all panels without special-casing."
    ),
)
async def save_features(
    request: SaveFeaturesRequest,
) -> ProcessGeoJSONResponse:
    """
    Re-validate an edited FeatureCollection and return a fresh analysis report.

    Called when the user clicks *Save* in the dashboard header.

    Raises:
        HTTPException 500: unexpected processing error.
    """
    try:
        processed_features, summary = _service.process_feature_collection(
            request.feature_collection
        )

        file_size = len(json.dumps(request.feature_collection.model_dump()).encode())
        logger.info(
            f"Saved: {summary.total_features} features, "
            f"{summary.invalid_features} invalid, "
            f"{summary.duplicate_groups} duplicate groups"
        )

        return ProcessGeoJSONResponse(
            filename="edited.geojson",
            file_size_bytes=file_size,
            summary=summary,
            features=processed_features,
        )

    except Exception as exc:
        logger.exception(f"Error saving collection: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save feature collection: {exc}",
        ) from exc
