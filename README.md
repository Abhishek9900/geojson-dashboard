# GeoJSON Farm Dashboard

A full-stack web application for uploading, validating, visualising, and editing GeoJSON farm data.

## Features

- **Upload** — drag-and-drop `.geojson` files (up to 100 MB).
- **Validate** — detect invalid geometries (self-intersections, empty rings, null geometry) and exact-duplicate features.
- **Auto-fix** — apply Shapely-computed geometry repairs with a single click.
- **Map** — colour-coded MapLibre GL map with legend filtering, feature selection, and an edit mode for drawing new features, deleting features, and editing attribute properties.
- **Table** — sortable, filterable feature table with inline property editing.
- **Re-analyse** — after any edits, submit the updated FeatureCollection back to the backend for a fresh analysis report.
- **Download** — export the current (possibly edited) collection as a `.geojson` file.

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 · TypeScript · Tailwind CSS · MapLibre GL JS · Turf.js |
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
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000 # python -m uvicorn main:app --reload --port 8000
```

Run tests:

```bash
pytest tests/ -v
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
    └── src/
        ├── app/
        │   └── page.tsx            # Main dashboard page
        ├── components/
        │   ├── map/MapView.tsx     # MapLibre GL map + edit toolbar
        │   ├── table/FeatureTable.tsx
        │   ├── ui/
        │   │   ├── Header.tsx
        │   │   ├── IssuesPanel.tsx
        │   │   └── SummaryCards.tsx
        │   └── upload/UploadZone.tsx
        ├── lib/
        │   ├── api.ts              # HTTP client
        │   └── geojson-utils.ts   # Pure utility functions
        ├── types/index.ts          # Shared TypeScript types
        └── __tests__/
            └── dashboard.test.tsx  # Jest test suite
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
