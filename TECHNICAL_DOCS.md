# Technical Documentation — GeoJSON Farm Dashboard

## Architecture overview

```
Browser (Next.js 16)
    │  multipart file upload / JSON
    ▼
FastAPI backend (Python 3.14+)
    │  Pydantic validation → Shapely processing
    ▼
JSON response (ProcessGeoJSONResponse)
    │
    ▼
React state (page.tsx)
    ├─ MapView       (MapLibre GL)
    ├─ IssuesPanel
    ├─ FeatureTable
    └─ SummaryCards
```

The backend is stateless — every request carries the full FeatureCollection and returns a complete analysis result.  There is no database; all state lives in the browser for the lifetime of a session.

---

## Backend

### Entry point — `main.py`

Configures loguru (stderr + rotating file sink), creates the FastAPI application, registers CORS middleware from `app.config.Settings`, and mounts the GeoJSON router at `/api/geojson`.

### Configuration — `app/config.py`

`Settings` extends `pydantic_settings.BaseSettings`.  All fields are overridable via environment variables or a `.env` file:

| Field                 | Type        | Default            |
|-----------------------|-------------|--------------------|
| `app_name`            | `str`       | `"GeoJSON Dashboard API"` |
| `debug`               | `bool`      | `False`            |
| `allowed_origins`     | `List[str]` | `["http://localhost:3000", "http://127.0.0.1:3000", "http://frontend:3000"]` |
| `max_upload_size_mb`  | `int`       | `100`              |

### Models — `app/models/geojson_models.py`

All models use Pydantic v2.

| Model                    | Purpose                                                    |
|--------------------------|------------------------------------------------------------|
| `GeometryModel`          | Wraps GeoJSON geometry (coordinates + optional geometries) |
| `FeatureModel`           | GeoJSON Feature with optional id and properties            |
| `FeatureCollectionModel` | Root collection; supports optional `name` and legacy `crs` |
| `GeometryIssue`          | One detected problem; optionally includes `fixed_geometry` |
| `DuplicateGroup`         | Set of features sharing a geometry hash                    |
| `AnalysisSummary`        | Aggregated counts + full issue and duplicate lists         |
| `ProcessedFeature`       | Feature + analysis metadata (is_valid, area_m2, centroid)  |
| `ProcessGeoJSONResponse` | Top-level API response for `/upload` and `/update`         |
| `UpdateFeaturesRequest`  | Request body for `/update`                                 |

### File validation — `app/utils/file_validation.py`

`read_and_validate_geojson(file: UploadFile)` performs four ordered checks before any Pydantic or Shapely work:

1. **Extension** — filename must end in `.geojson`.
2. **Size** — payload must not exceed `MAX_BYTES` (derived from settings).
3. **JSON** — content must parse as valid UTF-8 JSON.
4. **GeoJSON type** — `type` field must be `"FeatureCollection"`, `"Feature"`, or `"GeometryCollection"`; a FeatureCollection must have a `features` key.

### Processing service — `app/services/geojson_service.py`

`GeoJSONProcessingService.process_feature_collection` is the only public method.  Internally it runs three passes:

#### Pass 1 — per-feature validation (`_process_single_feature`)

For each feature:
- **Null geometry** → `GeometryIssue(issue_type="null_geometry", auto_fix_available=False)`.
- **Empty geometry** → `GeometryIssue(issue_type="empty_geometry", auto_fix_available=False)`.
- **Invalid geometry** → Shapely's `explain_validity` for a human-readable reason; `make_valid` to compute a repaired geometry stored in `fixed_geometry`; `auto_fix_available=True`.
- **Parse error** → `GeometryIssue(issue_type="parse_error")` when Shapely cannot interpret the coordinates.
- Valid geometries get `area_m2` (rough, using `area × 1e10`) and `centroid` (lon/lat rounded to 8 dp).

#### Pass 2 — duplicate detection (`_detect_duplicates`)

Each feature's geometry is serialised to a JSON string with `sort_keys=True` and hashed with SHA-256.  Features sharing a hash are grouped.  Only groups with ≥ 2 members are returned.

#### Pass 3 — marking duplicates (`_mark_duplicates`)

The first feature in each group is the canonical copy; remaining members have `is_duplicate=True` and `duplicate_group_id` set.

### Routers — `app/routers/geojson.py`

| Endpoint    | Method | Request        | Response                   |
|-------------|--------|----------------|----------------------------|
| `/upload`   | POST   | multipart file | `ProcessGeoJSONResponse`   |
| `/update`   | POST   | JSON body      | `ProcessGeoJSONResponse`   |
| `/validate` | POST   | multipart file | `AnalysisSummary` (dict)   |

Both `/upload` and `/update` return the same `ProcessGeoJSONResponse` shape so the frontend can use a single refresh path for both workflows.

---

## Frontend

### State management

All dashboard state lives in `page.tsx` as two `useState` values:

- `state: DashboardState` — upload status, the backend response, the live FeatureCollection, selected feature index, and any upload error.
- `pendingFC: FeatureCollection | null` — a FeatureCollection that has been edited locally but not yet re-analysed.  Non-null whenever the Save button should appear.

Child components are pure; they receive handlers via props and never mutate state themselves.

### `_originalIndex` stamp

On upload, each feature in the FeatureCollection is stamped with `_originalIndex: i` in its properties.  This index corresponds to the position in `response.features` and is used throughout:

- `MapView` uses it to look up the `ProcessedFeature` for colour and status.
- `IssuesPanel`'s Apply Fix locates the live feature by `_originalIndex` rather than array position (which changes as features are deleted).
- `FeatureTable` separates backend features from newly drawn features by the presence or absence of `_originalIndex`.

Properties beginning with `_` are treated as internal and are filtered out of all property editing UIs.

### Optimistic patch on map save

When the user saves edits in the map without running a full re-analysis:

1. `handleMapSave` removes issues and duplicate groups for deleted features from the local `response` copy.
2. The patched response is shown immediately in SummaryCards and IssuesPanel.
3. `pendingFC` is set, enabling the Save button in the Header.

The full re-analysis (via `/update`) corrects any approximations when the user clicks Save.

### API client — `src/lib/api.ts`

`uploadGeoJSON` uses `XMLHttpRequest` when an `onProgress` callback is provided (fetch does not expose upload progress).  All other calls use `fetch`.  Error handling extracts FastAPI's `detail` field for user-facing messages.

### Map — `src/components/map/MapView.tsx`

The map is initialised once on mount via a dynamic `import("maplibre-gl")` inside a `useEffect`.  Refs (`mapRef`, `editedFCRef`, `isEditingRef`, `drawToolRef`, `legendFilterRef`) keep map event handlers (closures captured at mount) in sync with React state without triggering re-renders.

Layer hierarchy:
1. `osm-tiles` raster background (OpenStreetMap).
2. `feature-fill` — polygon fill using `_color` and `_opacity` data-driven properties.
3. `feature-line` — outlines for polygons and line strings; `_lineWidth` is 4 px for the selected feature.
4. `feature-point` — circle layer for Point geometries.
5. `draw-preview-line` / `draw-preview-point` — ephemeral source showing the polygon being drawn.

Legend filtering dims non-matching features by setting `_opacity: 0.15` and `_lineOpacity: 0.2` rather than hiding them, so the overall map shape is preserved.

### Utility functions — `src/lib/geojson-utils.ts`

All functions are pure / side-effect-free (except `downloadGeoJSON` which triggers a browser download by design).

| Function              | Description                                            |
|-----------------------|--------------------------------------------------------|
| `computeBBox`         | Geographic bounding box for a FeatureCollection        |
| `computeFeatureBBox`  | Bounding box for a single feature                      |
| `getInitialViewState` | Initial map centre derived from data extent            |
| `downloadGeoJSON`     | Trigger browser download; revokes object URL after use |
| `formatBytes`         | Human-readable byte count (B / KB / MB)                |
| `getFeatureColor`     | Hex colour by feature status (priority: selected > dup > invalid > valid) |
| `isGeometry`          | Type guard for GeoJSON Geometry                        |

---

## Testing

### Backend (pytest)

```bash
cd backend && pytest tests/ -v
```

Tests use `httpx.AsyncClient` with `ASGITransport` so they run entirely in-process without a network server.

Test classes:
- `TestGeoJSONProcessingService` — unit tests for the processing service.
- `TestUploadEndpoint` — integration tests for `POST /api/geojson/upload`.
- `TestUpdateEndpoint` — integration tests for `POST /api/geojson/update`.
- `TestValidateEndpoint` — integration tests for `POST /api/geojson/validate`.
- `TestHealthEndpoint` — smoke test for `GET /health`.

### Frontend (Jest + React Testing Library)

```bash
cd frontend && npm test
```

`maplibre-gl` is mocked in `src/__mocks__/maplibre-gl.ts` (Jest auto-mock) because WebGL / Canvas is unavailable in JSDOM.

Test suites:
- `computeBBox` — bbox calculation for various FeatureCollections.
- `formatBytes` — byte formatting edge cases.
- `getFeatureColor` — colour priority logic.
- `isGeometry` — type guard edge cases.
- `SummaryCards` — metric rendering including zero values.
- `IssuesPanel` — issue cards, Apply Fix button visibility and callback.
- `Header` — filename display, button visibility, callbacks.
- `FeatureTable` — all four filter modes, sorting, row selection, filter callbacks.
- `UploadZone` — idle, uploading (with percentage), and error states.

---

## Linting and formatting

### Backend

```bash
ruff check backend/         # lint
ruff format backend/        # format
```

### Frontend

```bash
npm run lint                # ESLint (Next.js config)
npx prettier --write src/   # Prettier
```

Prettier config is in `frontend/.prettierrc`.
ESLint config is in `frontend/eslint.config.mjs`.
