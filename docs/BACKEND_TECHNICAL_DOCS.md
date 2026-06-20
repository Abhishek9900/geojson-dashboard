# Backend Technical Docs

FastAPI service that validates, analyses, and repairs GeoJSON `FeatureCollection`
data for the dashboard frontend. Stateless — every request is processed and
returned in full; nothing is persisted to disk or a database.

## Stack

| Layer | Library | Version |
|---|---|---|
| Framework | FastAPI | 0.136.3 |
| Server | Uvicorn | 0.49.0 |
| Validation / schemas | Pydantic v2 | 2.13.4 |
| Settings | pydantic-settings | 2.14.1 |
| Geometry engine | Shapely | 2.1.2 |
| Logging | Loguru | 0.7.3 |
| Tests | pytest + httpx | 9.0.3 / 0.28.1 |
| Lint/format | Ruff | (see `ruff.toml`) |

## Directory layout

```
backend/
├── main.py                      # App instance, CORS, logging, lifespan, /health
├── app/
│   ├── config.py                # Settings (env-driven)
│   ├── models/
│   │   └── geojson_models.py    # Pydantic models — GeoJSON + API request/response shapes
│   ├── routers/
│   │   └── geojson.py           # /api/geojson/* endpoints
│   ├── services/
│   │   └── geojson_service.py   # Validation, repair, duplicate detection, summary
│   └── utils/
│       └── file_validation.py   # Pre-flight checks on uploaded files
├── tests/
│   └── test_geojson.py          # Endpoint + unit tests (httpx AsyncClient, ASGITransport)
├── ruff.toml                    # Lint/format config
├── pytest.ini
├── requirements.txt
└── Dockerfile
```

## Request flow

There are exactly two ways data enters the service, and both converge on the
same processing pipeline:

```
POST /api/geojson/upload (multipart file)
        │
        ▼
read_and_validate_geojson()   ── extension / size / JSON / structure checks
        │
        ▼
FeatureCollectionModel(**raw_data)   ── Pydantic parse
        │
        ▼
GeoJSONProcessingService.process_feature_collection()
        │
        ▼
ProcessGeoJSONResponse  ──────────────────────────────► returned to client


POST /api/geojson/save (JSON body: { feature_collection })
        │
        ▼
SaveFeaturesRequest.feature_collection   ── already a parsed FeatureCollectionModel
        │
        ▼
GeoJSONProcessingService.process_feature_collection()   ── same pipeline, no file I/O
        │
        ▼
ProcessGeoJSONResponse  ──────────────────────────────► returned to client
```

`/save` exists so the frontend can submit user edits (drawn/deleted features,
inline property changes, auto-fixed geometries) for a fresh validation pass
without re-uploading a file. Both endpoints return the identical
`ProcessGeoJSONResponse` shape so the frontend has one code path for
refreshing its panels regardless of which endpoint produced the data.

## Endpoints

All routes are mounted under the `/api/geojson` prefix (see `main.py`).

### `POST /api/geojson/upload`

Accepts a `.geojson` file as multipart form data, validates it, and returns a
full analysis report.

- **Request:** `multipart/form-data`, field name `file`
- **Response:** `200 ProcessGeoJSONResponse`
- **Errors:**
  - `400` — wrong extension, malformed JSON, or invalid GeoJSON type/structure
  - `413` — file exceeds `MAX_UPLOAD_SIZE_MB`
  - `500` — unexpected processing error

### `POST /api/geojson/save`

Accepts an edited `FeatureCollection` (from map draw/delete, table property
edits, or an applied auto-fix) and re-runs the full validation/analysis
pipeline against it.

- **Request:** `application/json`
  ```json
  { "feature_collection": { "type": "FeatureCollection", "features": [...] } }
  ```
- **Response:** `200 ProcessGeoJSONResponse` (same shape as `/upload`;
  `filename` is hardcoded to `"edited.geojson"` since there's no source file)
- **Errors:** `500` — unexpected processing error

### `GET /health`

Liveness probe for Docker / load balancers. Returns `{"status": "ok", "version": "1.0.0"}`.

## Data models (`app/models/geojson_models.py`)

**GeoJSON structural models** (mirror RFC 7946 loosely — they accept input
shapes rather than fully validating them, since Shapely does the geometric
validation downstream):

- `GeometryModel` — `type`, `coordinates`, optional `geometries` (for `GeometryCollection`)
- `FeatureModel` — `type`, `properties`, `geometry`, optional `id`
- `FeatureCollectionModel` — `type`, optional `name`/`crs`, `features: list[FeatureModel]`

**Analysis result models:**

- `GeometryIssue` — one problem found on one feature
  - `feature_index`, `feature_id`, `issue_type` (e.g. `invalid_geometry`,
    `null_geometry`, `empty_geometry`, `parse_error`), `description`,
    `auto_fix_available`, `fixed_geometry` (present only when a repair was computed)
- `DuplicateGroup` — a set of features sharing identical geometry
  - `group_id`, `feature_indices`, `feature_ids`, `duplicate_type` (currently
    always `"exact"` — see [Known limitations](#known-limitations)), `description`
- `AnalysisSummary` — aggregate counts for the whole collection
  - `total_features`, `valid_features`, `invalid_features`, `duplicate_groups`,
    `total_duplicates`, `geometry_types` (counts per geometry type),
    `issues: list[GeometryIssue]`, `duplicate_groups_detail: list[DuplicateGroup]`
- `ProcessedFeature` — one input feature enriched with analysis metadata
  - `index` (stable position in the original array), `feature`, `is_valid`,
    `issues` (human-readable labels), `is_duplicate`, `duplicate_group_id`,
    `area_m2`, `centroid: {lat, lon}`

**API envelope models:**

- `ProcessGeoJSONResponse` — `filename`, `file_size_bytes`, `summary`, `features: list[ProcessedFeature]`
- `SaveFeaturesRequest` — `feature_collection: FeatureCollectionModel` (request body for `/save`)

## Processing pipeline (`app/services/geojson_service.py`)

`GeoJSONProcessingService.process_feature_collection()` is the single entry
point both endpoints call. It runs in three steps:

**1. Per-feature validation** (`_process_single_feature`)

For each feature, in order:
- Null geometry → `issue_type="null_geometry"`, not auto-fixable.
- Parse into a Shapely geometry via `shapely.geometry.shape()`.
  - Empty geometry → `issue_type="empty_geometry"`, not auto-fixable.
  - Invalid geometry (self-intersection, etc.) → `explain_validity()` supplies
    the human-readable reason, `make_valid()` computes a repaired geometry.
    `issue_type="invalid_geometry"`, **auto-fixable**; the repaired geometry
    is used for subsequent area/centroid calculations.
  - Any other parse exception → `issue_type="parse_error"`, not auto-fixable.
- Area (`area_m2`) and centroid are computed for any geometry that exposes
  Shapely's `.area` / `.centroid` (so points get a centroid but no area;
  polygons get both).
  - **Area conversion is approximate.** Shapely computes area in raw
    degrees², which is scaled by a flat constant (`_AREA_SCALE = 1e10`)
    calibrated for the equator. This is materially inaccurate at high
    latitudes — see [Known limitations](#known-limitations).

**2. Duplicate detection** (`_detect_duplicates`)

Each feature's geometry is serialised to canonical JSON (`sort_keys=True`)
and SHA-256 hashed. Features sharing a hash are grouped; groups with only one
member are discarded. This only catches **byte-identical coordinate
sequences** — see [Known limitations](#known-limitations) for what this misses.

**3. Marking + summary** (`_mark_duplicates`)

Within each duplicate group, the first occurrence is left as the canonical
feature; every subsequent occurrence is flagged `is_duplicate=True`. Counts
are aggregated into the `AnalysisSummary`.

## File validation (`app/utils/file_validation.py`)

Runs before any parsing, in this order, short-circuiting on the first failure:

1. Extension must be `.geojson` (case-insensitive) → `400`
2. Byte size must not exceed `settings.max_upload_size_mb` → `413`
3. Must decode as UTF-8 and parse as JSON → `400`
4. Top-level `type` must be one of `FeatureCollection`, `Feature`,
   `GeometryCollection` → `400`
   - **Only `FeatureCollection` is actually supported downstream.** A bare
     `Feature` or `GeometryCollection` passes this check but will fail (or
     behave unexpectedly) when `FeatureCollectionModel(**raw_data)` parses it,
     since that model expects a `features` array.
5. If `type == "FeatureCollection"`, a `features` key must be present → `400`

## Configuration (`app/config.py`)

Settings load from environment variables (or a `.env` file) via
`pydantic-settings`. See `backend/.env.example`:

| Variable | Default | Purpose |
|---|---|---|
| `DEBUG` | `false` | Sets Loguru console level to `DEBUG` vs `INFO` |
| `ALLOWED_ORIGINS` | `["http://localhost:3000", "http://frontend:3000"]` | CORS allow-list |
| `MAX_UPLOAD_SIZE_MB` | `100` | Upload size ceiling enforced in `file_validation.py` |

## Logging

Configured once in `main.py` via Loguru:
- Console sink: colourised, level `DEBUG` if `settings.debug` else `INFO`
- File sink: `logs/app.log`, rotates at 10 MB, retained for 7 days, level `INFO`

## Running locally

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Interactive API docs (Swagger UI) are available at `http://localhost:8000/docs`
once running.

## Testing

```bash
cd backend
pytest
```

Tests use `httpx.AsyncClient` with `ASGITransport` to exercise the FastAPI app
in-process (no real network calls). Coverage includes upload validation
(extension, size, malformed JSON, missing `features`), duplicate detection,
geometry repair, and the `/save` round-trip.

## Linting

```bash
cd backend
ruff check .
ruff format .
```

`ruff.toml` enables `E`/`W` (pycodestyle), `F` (pyflakes), `I` (import sort),
`UP` (pyupgrade — modern type syntax), `B` (bugbear), `SIM` (simplify), and
`ARG` (unused-argument detection). `E501` (line length) is ignored since the
formatter handles wrapping.

## Known limitations

These are pre-existing simplifications in the analysis logic, not regressions
from any refactor — worth knowing about if you extend this service:

- **Area calculation is latitude-naive.** The `_AREA_SCALE` constant
  approximates degrees² → m² assuming equatorial coordinates. Polygons far
  from the equator will report meaningfully wrong areas. A proper fix
  reprojects to an equal-area CRS (e.g. via `pyproj`) before computing area.
- **Duplicate detection is exact-match only.** `duplicate_type` in
  `DuplicateGroup` is always `"exact"` even though the model's docstring
  anticipates a `"near_exact"` variant; `NEAR_DUPLICATE_TOLERANCE` is defined
  but unused, and `shapely.ops.unary_union` is imported with a `noqa` for
  the same reason. Near-duplicate detection (e.g. via coordinate rounding or
  a buffer-and-compare approach) is not implemented.
- **No persistence.** Every request is processed from scratch in memory.
  There is no database, cache, or session — the frontend is the source of
  truth for "current" state between requests.
- **`/upload`'s file-type allow-list is wider than what's actually
  supported.** `file_validation.py` accepts `Feature` and `GeometryCollection`
  as top-level types, but `GeoJSONProcessingService` and the response models
  are built entirely around `FeatureCollection`. In practice, only
  `FeatureCollection` files work correctly end-to-end.
