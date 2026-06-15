# GeoJSON Dashboard — Backend Technical Documentation

## Table of Contents

1. [Overview](#overview)
2. [Project Structure](#project-structure)
3. [Configuration](#configuration)
4. [Dependencies](#dependencies)
5. [API Reference](#api-reference)
6. [Data Models](#data-models)
7. [Services](#services)
8. [Utilities](#utilities)
9. [Logging](#logging)
10. [Docker & Deployment](#docker--deployment)
11. [Development Tooling](#development-tooling)
12. [Testing](#testing)
13. [Error Handling](#error-handling)

---

## Overview

The **GeoJSON Dashboard API** is a FastAPI-based backend service for uploading, validating, processing, and managing GeoJSON farm data. It performs geometry validation using Shapely, detects duplicate features, computes basic spatial metrics (area, centroid), and returns enriched analysis reports to a Next.js frontend.

- **Version:** 1.0.0
- **Python runtime:** 3.14 (slim Docker image)
- **Framework:** FastAPI + Uvicorn (2 workers)
- **Port:** 8000

---

## Project Structure

```
backend/
├── main.py                        # Application entry point, CORS, lifespan hooks
├── requirements.txt               # Pinned Python dependencies
├── Dockerfile                     # Container image definition
├── .env.example                   # Environment variable template
├── ruff.toml                      # Linter / formatter configuration
├── pytest.ini                     # Test runner configuration
├── logs/
│   └── app.log                    # Rotating application log
└── app/
    ├── config.py                  # Pydantic Settings (env-driven config)
    ├── models/
    │   └── geojson_models.py      # Pydantic request/response/domain models
    ├── routers/
    │   └── geojson.py             # HTTP route handlers
    ├── services/
    │   └── geojson_service.py     # Core processing logic
    └── utils/
        └── file_validation.py     # Upload validation helpers
```

---

## Configuration

Configuration is handled via **Pydantic Settings** (`app/config.py`). Values are loaded from environment variables or a `.env` file.

| Variable              | Type         | Default                                              | Description                              |
|-----------------------|--------------|------------------------------------------------------|------------------------------------------|
| `APP_NAME`            | `str`        | `"GeoJSON Dashboard API"`                            | Application display name                 |
| `DEBUG`               | `bool`       | `false`                                              | Enables DEBUG-level log output           |
| `ALLOWED_ORIGINS`     | `List[str]`  | `["http://localhost:3000", "http://frontend:3000"]`  | CORS allowed origins                     |
| `MAX_UPLOAD_SIZE_MB`  | `int`        | `100`                                                | Maximum accepted file size in megabytes  |

### `.env.example`

```env
DEBUG=true
ALLOWED_ORIGINS=["http://localhost:3000", "http://127.0.0.1:3000"]
MAX_UPLOAD_SIZE_MB=100
```

---

## Dependencies

All dependencies are pinned in `requirements.txt`.

| Package                | Version   | Purpose                                         |
|------------------------|-----------|-------------------------------------------------|
| `fastapi`              | 0.136.3   | Web framework                                   |
| `uvicorn`              | 0.49.0    | ASGI server                                     |
| `pydantic`             | 2.13.4    | Data validation and serialisation               |
| `pydantic-settings`    | 2.14.1    | Environment-driven configuration                |
| `shapely`              | 2.1.2     | Geometry validation, repair, and metric computation |
| `geojson`              | 3.3.0     | GeoJSON parsing support                         |
| `loguru`               | 0.7.3     | Structured logging                              |
| `python-multipart`     | 0.0.32    | Multipart form-data (file upload) parsing       |
| `aiofiles`             | 25.1.0    | Async file I/O                                  |
| `httpx`                | 0.28.1    | Async HTTP client (used in tests)               |
| `anyio`                | 4.13.0    | Async concurrency primitives                    |
| `pytest`               | 9.0.3     | Test framework                                  |
| `pytest-asyncio`       | 1.4.0     | Async test support                              |

> **Note:** Shapely requires the system library `libgeos-dev`, installed via `apt-get` in the Dockerfile.

---

## API Reference

All endpoints are served under the `/api/geojson` prefix. The API is also documented via FastAPI's built-in OpenAPI UI at `/docs`.

### Health Check

#### `GET /health`

Lightweight liveness probe used by Docker and load balancers.

**Response `200 OK`:**
```json
{
  "status": "ok",
  "version": "1.0.0"
}
```

---

### `POST /api/geojson/upload`

Upload a `.geojson` file and receive a full analysis report.

**Request:** `multipart/form-data`

| Field  | Type   | Required | Description              |
|--------|--------|----------|--------------------------|
| `file` | File   | Yes      | A `.geojson` file to process |

**Response `200 OK`:** [`ProcessGeoJSONResponse`](#processgeojsonresponse)

**Error responses:**

| Code | Condition                                                    |
|------|--------------------------------------------------------------|
| 400  | File extension is not `.geojson`                            |
| 400  | File is not valid UTF-8 JSON                                |
| 400  | GeoJSON `type` is not `FeatureCollection`                   |
| 400  | `FeatureCollection` is missing a `features` array           |
| 413  | File exceeds `MAX_UPLOAD_SIZE_MB`                           |
| 500  | Unexpected processing error                                  |

---

### `POST /api/geojson/update`

Re-analyse an edited `FeatureCollection`. Called when the user clicks *Save & Analyse* in the dashboard. The response shape is identical to `/upload` so the frontend can refresh all panels without special-casing.

**Request body:** [`UpdateFeaturesRequest`](#updatefeaturesrequest)

```json
{
  "feature_collection": { ... }
}
```

**Response `200 OK`:** [`ProcessGeoJSONResponse`](#processgeojsonresponse)

**Error responses:**

| Code | Condition                       |
|------|---------------------------------|
| 500  | Unexpected processing error     |

---

### `POST /api/geojson/validate`

Lightweight validation endpoint. Parses and validates a GeoJSON file and returns only the `AnalysisSummary`, skipping the full feature list. Useful for pre-flight checks from external tools.

**Request:** `multipart/form-data`

| Field  | Type   | Required | Description              |
|--------|--------|----------|--------------------------|
| `file` | File   | Yes      | A `.geojson` file to validate |

**Response `200 OK`:** [`AnalysisSummary`](#analysissummary) (as plain dict)

---

## Data Models

All models are defined in `app/models/geojson_models.py` using Pydantic v2.

### GeoJSON Structure Models

#### `GeometryType` (Enum)

Enumerates the seven GeoJSON geometry types per RFC 7946 §3.1: `Point`, `LineString`, `Polygon`, `MultiPoint`, `MultiLineString`, `MultiPolygon`, `GeometryCollection`.

#### `GeometryModel`

| Field        | Type             | Description                                  |
|--------------|------------------|----------------------------------------------|
| `type`       | `str`            | Geometry type name                           |
| `coordinates`| `Any` (optional) | Coordinate array                             |
| `geometries` | `List[Any]` (optional) | Child geometries (GeometryCollection only) |

#### `FeatureModel`

| Field        | Type                      | Description                        |
|--------------|---------------------------|------------------------------------|
| `type`       | `str`                     | Always `"Feature"`                 |
| `properties` | `Dict[str, Any]` (optional) | Arbitrary feature attributes      |
| `geometry`   | `GeometryModel` (optional)  | The feature's geometry             |
| `id`         | `str \| int` (optional)   | Feature identifier (RFC 7946 §3.2) |

#### `FeatureCollectionModel`

| Field      | Type                     | Description                             |
|------------|--------------------------|-----------------------------------------|
| `type`     | `str`                    | Always `"FeatureCollection"`            |
| `name`     | `str` (optional)         | Collection name                         |
| `crs`      | `Dict[str, Any]` (optional) | Legacy CRS member                    |
| `features` | `List[FeatureModel]`     | The list of features                    |

---

### Analysis & Processing Models

#### `GeometryIssue`

Describes a geometry problem found during processing.

| Field               | Type                   | Description                                          |
|---------------------|------------------------|------------------------------------------------------|
| `feature_index`     | `int`                  | Zero-based index in the parent collection            |
| `feature_id`        | `str \| int` (optional)| Feature's `id` or `fid` property                    |
| `issue_type`        | `str`                  | Machine-readable label (e.g. `"invalid_geometry"`)   |
| `description`       | `str`                  | Human-readable explanation                           |
| `auto_fix_available`| `bool`                 | Whether `make_valid` was able to repair the geometry |
| `fixed_geometry`    | `Dict[str, Any]` (optional) | The repaired geometry, if available            |

**Known `issue_type` values:**

| Value              | Description                                                  |
|--------------------|--------------------------------------------------------------|
| `null_geometry`    | Feature has no geometry object                               |
| `empty_geometry`   | Geometry exists but contains no coordinates                  |
| `invalid_geometry` | Shapely reports the geometry as topologically invalid        |
| `parse_error`      | Geometry could not be parsed at all                          |

#### `DuplicateGroup`

A set of features sharing identical (or near-identical) geometries.

| Field             | Type                           | Description                                        |
|-------------------|--------------------------------|----------------------------------------------------|
| `group_id`        | `int`                          | Sequential group identifier                        |
| `feature_indices` | `List[int]`                    | Indices of features in this group                  |
| `feature_ids`     | `List[str \| int \| None]`     | Their ids (may be `null`)                          |
| `duplicate_type`  | `str`                          | `"exact"` = same coordinate hash                  |
| `description`     | `str`                          | Human-readable summary                             |

#### `AnalysisSummary`

Aggregated results for a processed `FeatureCollection`.

| Field                    | Type                  | Description                                      |
|--------------------------|-----------------------|--------------------------------------------------|
| `total_features`         | `int`                 | Total feature count                              |
| `valid_features`         | `int`                 | Count of geometrically valid features            |
| `invalid_features`       | `int`                 | Count of invalid features                        |
| `duplicate_groups`       | `int`                 | Number of duplicate groups found                 |
| `total_duplicates`       | `int`                 | Total redundant features (sum of group sizes − 1)|
| `geometry_types`         | `Dict[str, int]`      | Geometry type → count map                        |
| `issues`                 | `List[GeometryIssue]` | All detected issues                              |
| `duplicate_groups_detail`| `List[DuplicateGroup]`| Full detail for each duplicate group             |

#### `ProcessedFeature`

A GeoJSON feature enriched with processing metadata.

| Field               | Type                   | Description                                         |
|---------------------|------------------------|-----------------------------------------------------|
| `index`             | `int`                  | Zero-based position in the original input           |
| `feature`           | `FeatureModel`         | The original feature                                |
| `is_valid`          | `bool`                 | Whether the geometry is valid                       |
| `issues`            | `List[str]`            | Human-readable issue labels                         |
| `is_duplicate`      | `bool`                 | Whether this feature is a duplicate                 |
| `duplicate_group_id`| `int` (optional)       | ID of the duplicate group (if `is_duplicate`)       |
| `area_m2`           | `float` (optional)     | Approximate area in m² (polygon-type geometries only)|
| `centroid`          | `Dict[str, float]` (optional) | `{lon, lat}` centroid in decimal degrees   |

---

### API Request / Response Models

#### `ProcessGeoJSONResponse`

Returned by `/upload` and `/update`.

| Field             | Type                      | Description                    |
|-------------------|---------------------------|--------------------------------|
| `filename`        | `str`                     | Original uploaded filename     |
| `file_size_bytes` | `int`                     | Approximate serialised size    |
| `summary`         | `AnalysisSummary`         | Aggregated analysis results    |
| `features`        | `List[ProcessedFeature]`  | Per-feature enriched results   |

#### `UpdateFeaturesRequest`

Request body for `/update`.

| Field                | Type                     | Description                    |
|----------------------|--------------------------|--------------------------------|
| `feature_collection` | `FeatureCollectionModel` | The edited feature collection  |

---

## Services

### `GeoJSONProcessingService` (`app/services/geojson_service.py`)

The core processing class. Instantiated once as a module-level singleton in the router.

#### Constants

| Name                       | Value   | Description                                              |
|----------------------------|---------|----------------------------------------------------------|
| `NEAR_DUPLICATE_TOLERANCE` | `1e-7`  | Coordinate tolerance in degrees (reserved for future use)|
| `_AREA_SCALE`              | `1e10`  | Conversion factor: degrees² → approximate m²             |

#### `process_feature_collection(feature_collection) → (features, summary)`

Main entry point. Runs the three-stage pipeline:

1. **Per-feature validation** — calls `_process_single_feature` for each feature. Detects null, empty, and topologically invalid geometries. Uses `make_valid` to attempt automatic repair.
2. **Duplicate detection** — calls `_detect_duplicates` to group features by SHA-256 geometry hash.
3. **Marking & summarising** — calls `_mark_duplicates` to flag duplicates in-place, then assembles the `AnalysisSummary`.

#### `_process_single_feature(idx, feature) → (ProcessedFeature, issues)`

Validates a single feature:

- **Null geometry:** flags as `null_geometry`, marks invalid.
- **Empty geometry:** flags as `empty_geometry`, marks invalid.
- **Invalid geometry (Shapely):** calls `explain_validity` for a reason string, then `make_valid` for a repaired geometry. The repaired geometry is used for metric computation.
- **Parse error:** catches all other exceptions, flags as `parse_error`.
- **Metrics:** computes `area_m2` (rounded to 4 decimal places, scaled by `1e10`) and `centroid` (`{lon, lat}`, rounded to 8 decimal places) for all geometry types that support them.

#### `_geometry_hash(feature) → str | None`

Produces a deterministic SHA-256 hash of the geometry by serialising it with `json.dumps(..., sort_keys=True)`. Returns `None` for null or un-serialisable geometries.

#### `_detect_duplicates(processed) → List[DuplicateGroup]`

Builds a `hash → [indices]` map and returns a `DuplicateGroup` for every group with two or more members. The first occurrence is treated as the canonical feature.

#### `_mark_duplicates(processed, groups) → None`

Mutates `ProcessedFeature` objects in-place. For each group, all features beyond the first (`feature_indices[1:]`) have `is_duplicate = True` and `duplicate_group_id` set.

---

## Utilities

### `read_and_validate_geojson(file)` (`app/utils/file_validation.py`)

Async function that validates an uploaded file before any processing occurs. Checks are applied in order and fail fast:

1. **Extension check** — filename must end with `.geojson` (case-insensitive). Returns `HTTP 400` otherwise.
2. **Size check** — raw byte count must not exceed `MAX_BYTES = MAX_UPLOAD_SIZE_MB × 1024²`. Returns `HTTP 413` otherwise.
3. **JSON parsing** — decodes as UTF-8 and parses JSON. Returns `HTTP 400` on `JSONDecodeError` or `UnicodeDecodeError`.
4. **GeoJSON type check** — `type` field must be one of `FeatureCollection`, `Feature`, or `GeometryCollection`. Returns `HTTP 400` otherwise.
5. **FeatureCollection structure** — if type is `FeatureCollection`, a `features` key must be present. Returns `HTTP 400` otherwise.

Returns the parsed document as a plain Python `dict` on success.

---

## Logging

Logging is configured in `main.py` using **Loguru**.

| Sink       | Level           | Format                                              | Rotation / Retention     |
|------------|-----------------|-----------------------------------------------------|--------------------------|
| `stderr`   | DEBUG (dev) / INFO (prod) | Colourised timestamp, level, module, function, line, message | — |
| `logs/app.log` | INFO        | Same structured format (plain text)                 | 10 MB rotation, 7-day retention |

Log level is controlled by the `DEBUG` environment variable. When `DEBUG=true`, stderr emits at `DEBUG`; in production it uses `INFO`.

---

## Docker & Deployment

### `Dockerfile` summary

```dockerfile
FROM python:3.14-slim
# Installs libgeos-dev (required by Shapely) and curl (for HEALTHCHECK)
RUN apt-get update && apt-get install -y libgeos-dev curl
COPY requirements.txt . && pip install -r requirements.txt
COPY . .
RUN mkdir -p logs
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8000/health || exit 1
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
```

### Key points

- **Base image:** `python:3.14-slim` — minimal footprint.
- **GEOS dependency:** `libgeos-dev` must be installed at the OS level for Shapely's C extensions.
- **Health check:** Docker polls `GET /health` every 30 s. The container is marked unhealthy after 3 consecutive failures.
- **Workers:** 2 Uvicorn workers; increase for higher throughput in production.
- **Logs directory:** created at build time so the Loguru file sink works out of the box.

### `.dockerignore`

The `.dockerignore` file is present to exclude unnecessary files (e.g. `__pycache__`, `*.pyc`, local `.env`) from the image context.

---

## Development Tooling

### Linting & Formatting — Ruff (`ruff.toml`)

| Rule set | Code | Description                    |
|----------|------|--------------------------------|
| pycodestyle errors  | `E` | Style errors         |
| pycodestyle warnings| `W` | Style warnings       |
| Pyflakes            | `F` | Undefined names, unused imports|
| isort               | `I` | Import order                   |
| pyupgrade           | `UP`| Modernise syntax               |
| flake8-bugbear      | `B` | Common bugs and design issues  |
| flake8-simplify     | `SIM`| Code simplification           |
| unused arguments    | `ARG`| Warn on unused `*args`/`**kwargs` |

`E501` (line-too-long) is ignored — line length is managed by the formatter.

**Quote style:** double quotes. **Indent style:** spaces.

Run:
```bash
ruff check .
ruff format .
```

---

## Testing

Tests live in `tests/` and are driven by `pytest` with `pytest-asyncio`.

### `pytest.ini`

```ini
[pytest]
pythonpath = .
asyncio_mode = auto
testpaths = tests
```

- `pythonpath = .` — makes `app` importable from the repo root without installation.
- `asyncio_mode = auto` — all `async def` test functions are treated as async tests automatically.
- `testpaths = tests` — restricts discovery to the `tests/` directory.

The primary test file is `tests/test_geojson.py` (~15 KB), covering GeoJSON processing scenarios.

Run tests:
```bash
pytest
```

---

## Error Handling

| HTTP Code | When raised                                             | Source                        |
|-----------|---------------------------------------------------------|-------------------------------|
| 400       | Bad file extension, malformed JSON, wrong GeoJSON type, missing `features` | `file_validation.py` |
| 413       | File exceeds `MAX_UPLOAD_SIZE_MB`                      | `file_validation.py`          |
| 500       | Any unhandled exception in a route handler             | `routers/geojson.py`          |

All `HTTPException`s from `read_and_validate_geojson` are re-raised as-is in the `/upload` handler. The `/update` route wraps all exceptions in a generic `HTTP 500` with the exception message in `detail`.

Unexpected errors are logged with `logger.exception(...)` before re-raising, which captures the full stack trace in both the console sink and `logs/app.log`.
