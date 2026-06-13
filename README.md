# GeoJSON Farm Dashboard

A full-stack web application for uploading, validating, visualising, and editing GeoJSON farm data.

## Features

1. **Upload** — Drag-and-drop or click to upload a `.geojson` file (up to 100 MB). The file is POSTed to the backend, which returns a full analysis report.
2. **Map** — Colour-coded MapLibre GL map with legend filtering, feature selection, and an edit mode for drawing new features, deleting features, and editing attribute properties.
3. **Auto-fix** — Apply Shapely-computed geometry repairs with a single click.
4. **Inspect** — Summary cards show aggregate counts; the MapView renders features colour-coded by status; the IssuesPanel lists geometry errors and duplicate groups.
5. **Table** — Sortable, filterable feature table with inline property editing.
6. **Edit** — Features can be edited on the map (draw tools) or via inline property editing in the FeatureTable. Edits are staged locally.
7. **Save** — This button submits the current (possibly edited) FeatureCollection back to the backend for a fresh analysis.
8. **Download** — The current FeatureCollection (including edits) is serialised to a `.geojson` file and downloaded.

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 · TypeScript · Redux Toolkit 2 · Tailwind CSS · MapLibre GL JS · Turf.js |
| Backend | FastAPI · Shapely · Pydantic v2 · Loguru |
| Containerisation | Docker · Docker Compose |

## Quick start with Docker Compose

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) ≥ 4.x

### Run

```bash
git clone https://github.com/Abhishek9900/geojson-dashboard.git
cd geojson-dashboard
docker compose up --build
```

| Service  | URL                       |
|----------|---------------------------|
| Frontend | <http://localhost:3000>     |
| Backend  | <http://localhost:8000>     |
| API docs | <http://localhost:8000/docs> |

---

## Local Development (without Docker)

### Prerequisites

- [Python](https://www.python.org/downloads/release/python-3140/) ≥ 3.14
- [NodeJS](https://nodejs.org/en) ≥ v24

### Backend (FastAPI + Python 3.14+)

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python3 -m uvicorn main:app --reload --port 8000 # uvicorn main:app --reload --port 8000
```

Run tests:

```bash
python3 -m pytest tests/ -v
```

### Frontend (Next.js 16 + TypeScript)

```bash
cd frontend
npm install
npm run dev  # http://localhost:3000
```

Run tests:

```bash
npm test
```

Lint:

```bash
npm run lint         # ESLint
npm run type-check   # TypeScript checks
npm run format:check # Prettier
```

---

## Environment variables

### Backend (`backend/.env`)

| Variable            | Default                                 | Description                      |
|---------------------|-----------------------------------------|----------------------------------|
| `DEBUG`             | `false`                                 | Enable debug logging             |
| `ALLOWED_ORIGINS`   | `["http://localhost:3000", "http://127.0.0.1:3000"]`             | CORS allowed origins (JSON list) |
| `MAX_UPLOAD_SIZE_MB`| `100`                                   | Upload size cap in megabytes     |

Copy `backend/.env.example` to `backend/.env` and adjust as needed.

### Frontend (`frontend/.env.local`)

| Variable              | Default                   | Description         |
|-----------------------|---------------------------|---------------------|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000`   | Backend base URL    |

Copy `frontend/.env.example` to `frontend/.env.local`.

---

## Project structure

```
geojson-dashboard/
├── backend/
│   ├── app/
│   │   ├── config.py              # Pydantic settings
│   │   ├── models/
│   │   │   └── geojson_models.py  # Request / response Pydantic models
│   │   ├── routers/
│   │   │   └── geojson.py         # FastAPI route handlers
│   │   ├── services/
│   │   │   └── geojson_service.py # Geometry processing logic
│   │   └── utils/
│   │       └── file_validation.py # Upload validation helpers
│   ├── tests/
│   │   └── test_geojson.py        # pytest test suite
│   └── main.py                    # Application entry point
└── frontend/
    ├── src/
    │   ├── app/
    │   │   ├── layout.tsx         # Root layout; wraps children in ReduxProvider + Toaster
    │   │   ├── page.tsx           # Main dashboard page (orchestrator component)
    │   │   └── globals.css        # Tailwind base styles
    │   ├── components/
    │   │   ├── map/
    │   │   │   └── MapView.tsx    # MapLibre GL map with draw tools and feature highlighting
    │   │   ├── table/
    │   │   │   └── FeatureTable.tsx # Paginated, searchable, sortable, editable feature table
    │   │   ├── ui/
    │   │   │   ├── Header.tsx      # Sticky top bar with brand, filename, and action buttons
    │   │   │   ├── IssuesPanel.tsx # Scrollable list of geometry issues and duplicate groups
    │   │   │   └── SummaryCards.tsx # Four metric cards (total / valid / invalid / duplicates)
    │   │   └── upload/
    │   │       └── UploadZone.tsx # Drag-and-drop upload zone with progress bar
    │   ├── lib/
    │   │   ├── api.ts             # HTTP client for all backend endpoints
    │   │   └── geojson-utils.ts   # Pure GeoJSON utility functions
    │   ├── providers/
    │   │   └── ReduxProvider.tsx  # Client-side Redux <Provider> wrapper
    │   ├── store/
    │   │   ├── index.ts           # Barrel export
    │   │   ├── store.ts           # configureStore; exports RootState / AppDispatch / AppThunk
    │   │   ├── hooks.ts           # Typed useAppDispatch / useAppSelector
    │   │   ├── dashboardSlice.ts  # Upload + analysis + feature-edit state
    │   │   ├── tableSlice.ts      # Filter / search / sort / pagination UI state
    │   │   ├── dashboardThunks.ts # uploadFile and analyseCurrentFC thunks
    │   │   └── selectors.ts      # Memoised derived-data selectors
    │   ├── types/
    │   │   └── index.ts          # Shared TypeScript interfaces (mirrors backend Pydantic models)
    │   └── __mocks__/
    │       └── maplibre-gl.ts     # Jest mock for maplibre-gl (no WebGL in jsdom)
    ├── __tests__/
    │   └── dashboard.test.tsx     # Full test suite
    ├── *.ts, *.json        # Config files
```

---

## API reference

See the interactive Swagger docs at `http://localhost:8000/docs`.

| Method | Path                    | Description                                         |
|--------|-------------------------|-----------------------------------------------------|
| `GET`  | `/health`               | Liveness probe                                      |
| `POST` | `/api/geojson/upload`   | Upload and process a `.geojson` file                |
| `POST` | `/api/geojson/update`   | Re-analyse an edited FeatureCollection              |
| `POST` | `/api/geojson/validate` | Validate a file; returns summary only (no features) |

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

## GeoJSON Architecture Notes

For scaling to a production SaaS GIS platform:

```
Client Upload (.geojson)
    ↓
FastAPI preprocessing (Shapely validation, duplicate detection)
    ↓
PostGIS storage (spatial indexing, ST_IsValid, ST_MakeValid)
    ↓
GDAL → Vector Tiles (.mvt / .pbf)
    ↓
MapLibre GL JS (tile rendering, fast at scale)
```

The current implementation uses raw GeoJSON rendering, which is suitable for files up to ~10 000 features. For larger datasets, move to the vector tiles pipeline described above.
