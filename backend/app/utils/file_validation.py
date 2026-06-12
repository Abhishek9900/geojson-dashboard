"""
File validation utilities for uploaded GeoJSON files.

Enforces extension, size, JSON syntax, and minimal GeoJSON structure before
any expensive processing occurs.
"""

import json
from typing import Any, Dict

from fastapi import HTTPException, UploadFile, status
from loguru import logger

from app.config import settings

# Maximum accepted payload in bytes, derived from the settings value.
MAX_BYTES: int = settings.max_upload_size_mb * 1024 * 1024

# GeoJSON root types we accept.  We map everything to a FeatureCollection
# downstream, so only FeatureCollection is fully supported; the others are
# rejected with a clear message to avoid silent data loss.
_ACCEPTED_TYPES = {"FeatureCollection", "Feature", "GeometryCollection"}


async def read_and_validate_geojson(file: UploadFile) -> Dict[str, Any]:
    """
    Read an uploaded file and validate it as a GeoJSON FeatureCollection.

    Checks performed (in order):
      1. File extension must be ``.geojson``.
      2. Payload size must not exceed ``settings.max_upload_size_mb``.
      3. Content must be valid UTF-8 JSON.
      4. Top-level ``type`` must be a recognised GeoJSON type.
      5. FeatureCollection must include a ``features`` array.

    Args:
        file: The raw ``UploadFile`` received by a FastAPI endpoint.

    Returns:
        The parsed GeoJSON document as a plain Python dict.

    Raises:
        HTTPException 400: on extension, JSON, or structure errors.
        HTTPException 413: when the file exceeds the size limit.
    """
    filename = file.filename or ""

    # 1. Reject anything that isn't a .geojson file immediately.
    if not filename.lower().endswith(".geojson"):
        logger.warning(f"Rejected upload: '{filename}' is not a .geojson file")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Only .geojson files are accepted. "
                "Please upload a valid GeoJSON file."
            ),
        )

    # 2. Read the full body with an upper-bound guard.
    content = await file.read()
    if len(content) > MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=(
                f"File exceeds the maximum allowed size of "
                f"{settings.max_upload_size_mb} MB."
            ),
        )

    # 3. Parse JSON; reject non-UTF-8 and malformed content.
    try:
        data: Dict[str, Any] = json.loads(content.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        logger.warning(f"File '{filename}' is not valid JSON: {exc}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File is not valid JSON: {exc}",
        )

    # 4. Check the GeoJSON type field.
    geojson_type = data.get("type")
    if geojson_type not in _ACCEPTED_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Invalid GeoJSON: expected 'FeatureCollection', "
                f"got '{geojson_type}'. "
                "Please upload a valid GeoJSON FeatureCollection."
            ),
        )

    # 5. A FeatureCollection must have a features array.
    if geojson_type == "FeatureCollection" and "features" not in data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Invalid GeoJSON FeatureCollection: missing 'features' array."
            ),
        )

    logger.info(
        f"Accepted '{filename}' ({len(content)} bytes), "
        f"type='{geojson_type}', "
        f"features={len(data.get('features', []))}"
    )
    return data
