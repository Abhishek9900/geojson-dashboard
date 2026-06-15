# Author Notes — GeoJSON Farm Dashboard

## Table of Contents

1. [Technology Stack Rationale](#1-technology-stack-rationale)
2. [Known Limitations](#2-known-limitations)
3. [Outstanding Questions](#3-outstanding-questions)

## 1. Technology Stack Rationale

### Why not R Shiny or Python Streamlit?

Both **R Shiny** and **Python Streamlit** were viable options for a data-heavy geospatial tool, and their appeal is real — minimal boilerplate, built-in reactivity, and rapid prototyping. However, both ultimately optimise for the *analyst* workflow, not the *product* workflow:

- **R Shiny** is excellent for statistical dashboards and data science teams, but its component model, deployment story (ShinyServer / shinyapps.io), and UI customisation ceiling make it a poor fit for anything that needs to feel like a modern web application. CSS control is limited, and the interactivity model does not translate well to complex client-side state such as a live-editable map with draw tools.
- **Python Streamlit** shares many of the same constraints. It re-runs the full Python script on every widget interaction, which creates noticeable latency when the data payload is a large FeatureCollection. Real-time upload progress, inline property editing, and synchronised map-table selection are all difficult to implement cleanly.

The requirements here — drag-and-drop upload with progress feedback, a WebGL map with draw/edit tools, a sortable table with inline editing, synchronised selection across components, and a download button — are fundamentally a **web application**, not a data notebook.

---

### Next.js 16 (not plain React)

A plain Create-React-App or Vite project was the obvious baseline, but **Next.js** was chosen for several reasons:

| Concern | Plain React | Next.js |
|---|---|---|
| Routing | Manual (React Router) | File-system routing, zero config |
| Build optimisation | Manual Webpack/Vite config | Automatic code splitting, image optimisation, bundle analysis |
| Developer experience | Varies | Turbopack (fast HMR), built-in lint config |
| SSR / SSG | Manual | First-class, toggleable per page |
| Deployment | Any static host | Vercel, Docker, or static export |

For this project only the App Router with client-side rendering is used (`"use client"` components), but the scaffolding is there to add server-side data fetching, API routes, or partial pre-rendering without restructuring the project. MapLibre GL JS requires browser APIs, so the map component is loaded via `dynamic(..., { ssr: false })`, which Next.js handles cleanly.

The broader reason is **ecosystem maturity**. Next.js is the production standard for React applications in 2024–2026, with a large community, long-term Vercel backing, and extensive third-party tooling. Choosing plain React would mean assembling the same capabilities from separate packages with more integration work and a less stable upgrade path.

---

### TypeScript (not JavaScript)

JavaScript was not seriously considered for a project of this complexity. The reasons are practical:

- **GeoJSON is deeply nested.** A plain JS object representing a `FeatureCollection → Feature → Geometry → coordinates[][]` with optional `properties` is invisible to the editor. TypeScript types (`FeatureCollection`, `ProcessedFeature`, `AnalysisSummary`) make the shape explicit, catch mistakes at author time, and serve as living documentation.
- **Refactoring safety.** Renaming a field in `DashboardState` or changing a function signature produces compile errors at every call site. In JS this is a manual grep exercise.
- **IDE support.** Autocomplete, inline type errors, and go-to-definition work reliably in TypeScript. In JS they depend on JSDoc hints that are rarely kept up to date.
- **Community direction.** All major React libraries — Redux Toolkit, MapLibre GL, Turf.js — ship TypeScript definitions. Opting out of TypeScript means fighting the ecosystem.

The `strict: true` TypeScript config was used throughout, which forces explicit handling of `null` and `undefined` — important for GeoJSON where geometry, properties, and feature IDs are all optional.

---

### Redux Toolkit (not `useState` / Context)

The initial prototype used component-level `useState` in `page.tsx`, passing state down via props. This became untenable once four independent concerns had to stay synchronised:

1. The **upload state** (idle / uploading / loaded / error) and the raw backend response.
2. The **live FeatureCollection** — the source of truth that accumulates map edits.
3. The **selected feature index** — needs to be readable by both the map (to highlight) and the table (to scroll and highlight the row).
4. The **pending re-analysis flag** — controls whether the Save button is visible in the Header.

Sharing these across `MapView`, `FeatureTable`, `IssuesPanel`, `SummaryCards`, and `Header` through props alone meant threading state through multiple layers of components that did not need it. The alternatives:

- **React Context** is fine for slowly-changing global values (theme, auth) but is not optimised for frequent updates. Every component consuming the context re-renders on any change, which is a problem for a map that receives pointer events.
- **Zustand / Jotai** are lightweight and would have worked; the decision to use **Redux Toolkit** came down to familiarity, the strength of Redux DevTools for debugging state transitions, and the `createSelector` / `reselect` memoisation pattern for derived values (filtered features, issue counts by type).

Redux Toolkit removes the boilerplate objections to classic Redux: `createSlice` colocates actions and reducers, `createAsyncThunk` handles the upload lifecycle cleanly, and `immer` makes state mutation syntax safe inside reducers.

---

### FastAPI (Python backend)

The backend language was never a difficult choice — Python dominates geospatial tooling, and the libraries required (`shapely`, `pyproj`, `fiona`, `rasterio`) have no serious equivalents in Node or Go.

Within the Python ecosystem, **FastAPI** was chosen over Flask and Django REST Framework as personal preference:

- **Performance.** FastAPI is built on Starlette (async) and Uvicorn, making it one of the fastest Python web frameworks available. For a file-upload endpoint that performs Shapely geometry operations, async handling of concurrent requests matters.
- **Pydantic v2 integration.** Request and response schemas are defined once as Pydantic models and are automatically validated, serialised, and exposed in the OpenAPI spec. This eliminates a whole class of serialisation bugs and means the Swagger docs at `/docs` are always accurate.
- **Developer experience.** Automatic OpenAPI / Swagger UI generation, clean dependency injection, and excellent typing support make FastAPI pleasant to maintain. Adding a new field to a response model is a one-line change.
- **Community and maturity.** FastAPI has become the de-facto Python API framework for new projects, with strong community support, active development, and broad adoption in production environments.

The backend is intentionally **stateless** — every request carries the full FeatureCollection and returns a complete analysis result. This simplifies horizontal scaling (no sticky sessions) and makes the API trivially testable.

---

### Supporting choices

| Choice | Rationale |
|---|---|
| **Tailwind CSS** | Utility-first styling eliminates context-switching between CSS files and components. Co-location of style and structure makes it easier to audit and refactor UI. The purge step keeps the production bundle small. |
| **MapLibre GL JS** | Open-source fork of Mapbox GL JS with no API key required. WebGL rendering handles thousands of features without performance degradation. First-class TypeScript types and an active community. |
| **Turf.js** | The standard client-side geospatial utility library for JavaScript. Used for bounding-box computation and coordinate helpers. |
| **Shapely** | The de-facto Python geometry library. `make_valid` and `explain_validity` are exactly what is needed for the geometry repair workflow. |
| **Loguru** | Simpler than the standard `logging` module, with structured output and automatic file rotation. `loguru` is a minor dependency but meaningfully improves log readability. |
| **Ruff** | Replaces Flake8 + isort + pyupgrade in a single fast binary. Enforcing consistent style mechanically means code review can focus on logic. |
| **ESLint + Prettier** | ESLint catches logic errors and enforces Next.js best practices; Prettier handles all formatting decisions so they are never debated in review. |
| **Docker Compose** | One command to run the full stack. Environment parity between development and any future deployment environment. |

---

## 2. Known Limitations

### File size and performance

The current implementation loads the **entire GeoJSON file into browser memory** and renders it as a single source in MapLibre GL. This works well up to approximately 5000–10000 simple features, but degrades beyond that:

- Large files take longer to parse in the browser even before the upload begins.
- The backend Shapely validation is synchronous and single-threaded. A file with 50000 features will block the Uvicorn worker for several seconds.
- MapLibre GL rendering slows noticeably with complex polygon geometry and many thousands of features.

**Suggested approaches for large datasets:**

| Scale | Approach |
|---|---|
| ~10 000–100 000 features | Stream JSON parsing (`oboe.js` / `json-stream-stringify`); process backend in batches with a task queue (Celery + Redis). |
| 100 000+ features | Store to **PostGIS**; serve vector tiles (`.mvt` / `.pbf`) via `pg_tileserv` or `Martin`; switch MapLibre source to `vector` tile source. |
| Very large (national / continental) | Pre-process with GDAL or ogr2ogr into a tiled format (GeoPackage or PMTiles); serve static tiles from object storage (S3 / R2). |

The architecture diagram in the README sketches the PostGIS path.

---

### Frontend testing

Tests are written with **Jest + React Testing Library** and cover unit logic and component rendering. What is not covered:

- **No visual / component-level tests.** There is no [Storybook](https://storybook.js.org/) integration, so individual components cannot be developed or reviewed in isolation. Adding Storybook would also enable interaction tests via `@storybook/test` and visual regression tests via Chromatic.
- **No end-to-end tests.** There is no [Playwright](https://playwright.dev/) or [Cypress](https://www.cypress.io/) suite covering the full upload → validate → edit → re-analyse → download flow. The interaction between the map draw tools and the Redux store is not tested at all.
- **The map is completely mocked.** `maplibre-gl` is replaced with a stub in Jest because JSDOM does not support WebGL or Canvas. This means no test exercises actual map rendering, draw-tool logic, or layer colour assignment.
- **No API integration tests from the frontend.** All backend calls are mocked via `jest.mock('../lib/api')`. A real integration test against a running backend would provide more confidence.

---

### Browser compatibility

The application was developed and tested on modern Chromium-based browsers (Chrome, Edge) and Firefox. The following are untested or known to be limited:

- **Safari.** MapLibre GL JS has known quirks with Safari's WebGL implementation. The draw tools have not been tested on Safari desktop or iOS Safari.
- **Firefox.** Functional but not systematically tested.
- **Mobile browsers.** Touch interactions with the MapLibre draw tools are likely broken or inconsistent. See the responsiveness note below.
- **Internet Explorer / legacy Edge.** Not supported. The code uses ES2020+ features (optional chaining, nullish coalescing, async/await) without transpiling for legacy targets.

---

### Responsiveness and mobile UX

The layout was designed for a **desktop viewport** (≥ 1280 px wide). No responsive design work has been done:

- The map and table sit side-by-side in a fixed two-column layout that breaks on tablet and mobile.
- The upload dropzone, summary cards, and header do not reflow for narrow screens.
- The map draw tools require a mouse; there is no touch equivalent.
- No `viewport` meta adjustments have been tested.

Adding mobile support would require a Tailwind responsive prefix pass (`sm:`, `md:`, `lg:`), a stacked layout at mobile widths, and either removing or replacing the draw tools with a touch-compatible alternative.

---

### General application limitations

- **Session-only state.** There is no persistence layer. Closing or refreshing the browser tab discards all edits. A "save session" feature would require either `localStorage` (with size constraints) or a backend database.
- **Single-file only.** One GeoJSON file can be loaded at a time. Comparing or merging two files is not supported.
- **Coordinate reference systems.** The application assumes all input data is in WGS 84 (EPSG:4326). Files in projected CRS (e.g. EPSG:27700 British National Grid) will render incorrectly without reprojection. Reprojection via `proj4` or a backend GDAL step would be needed.
- **Area calculation accuracy.** Areas are computed as `shapely_area × 1e10`, which is a planar approximation. For accurate geodetic areas, the calculation should use `pyproj.Geod.geometry_area_perimeter` or the equivalent.
- **No undo / redo.** Map edits are applied directly to the live FeatureCollection. There is no edit history, so mistakes require re-uploading the original file.
- **No user authentication.** The API is open — any client with network access can upload and re-analyse files. For a multi-user deployment, authentication (OAuth2, API keys) and per-user isolation would be required.
- **Property schema is untyped.** Feature properties are arbitrary JSON objects. There is no schema enforcement, no type coercion on table edits (all edits are saved as strings), and no validation that a required field (e.g. `crop_type`, `field_id`) is present.
- **No CI/CD pipeline.** There are no GitHub Actions workflows, so tests are not run automatically on push or pull request. There is also no commit hygiene tooling — `commitlint` (enforcing Conventional Commits) and `husky` (pre-commit/pre-push hooks for lint and tests) are absent. Adding these would prevent broken code from reaching the main branch and make the commit history machine-readable for automated changelog generation.

---

## 3. Outstanding Questions

### Duplicate detection vs. similarity detection

The current implementation detects **exact duplicates** by hashing the serialised geometry string (`json.dumps(geometry, sort_keys=True)`). This is reliable and fast but has meaningful blind spots:

**What it catches:**
- Two features whose GeoJSON geometry objects are byte-for-byte identical after key normalisation.

**What it misses:**
- Features with coordinates that differ by a rounding error (e.g. `[52.123456789, -1.987654321]` vs `[52.12345679, -1.98765432]`). These are almost certainly the same point but will not match the hash.
- Polygons with the same vertices listed in a different winding order or starting from a different vertex.
- Polygons that are geometrically equivalent after simplification (e.g. one has an extra intermediate vertex on a straight edge).
- Near-duplicate features that are genuinely very close but represent separate (e.g. adjacent) fields.

**Open questions:**

1. **What is the acceptable coordinate precision?** GeoJSON coordinates are floating-point numbers. Six decimal places (~0.11 m at the equator) is a common convention for agricultural data, but the codebase does not enforce or document this. Should coordinates be rounded to a fixed precision before hashing?

2. **What constitutes "close enough" to flag as a near-duplicate?** Options include:
   - Hausdorff distance below a configurable threshold (e.g. < 1 m).
   - Centroid distance below a threshold *and* area ratio within a tolerance.
   - Polygon overlap ratio (intersection / union, i.e. IoU) above a threshold (e.g. > 0.95).

3. **Should near-duplicates be flagged as warnings rather than errors?** Two features with 98% geometric overlap might be legitimate (one is a field, the other is a sub-parcel) or might be a data error. The current binary valid/duplicate classification does not express this ambiguity.

4. **What is the right user-facing action for near-duplicates?** The current UI shows duplicate groups and lets the user delete features. For near-duplicates the options are less clear: merge? keep both? review manually?

A pragmatic first step would be to round coordinates to 6 decimal places before hashing, which would catch the most common rounding-error duplicates without requiring a full spatial similarity search.

---

### Other open questions

5. **Auto-fix scope.** `make_valid` is applied silently to invalid geometries. For simple self-intersections this usually produces the intended polygon. For more complex cases (bowtie polygons, overlapping rings) the output may be geometrically valid but semantically wrong (e.g. a polygon split into a MultiPolygon). Should the user be shown a before/after comparison before accepting a fix?

6. **Geometry type changes on fix.** If `make_valid` converts a `Polygon` to a `MultiPolygon`, downstream consumers of the GeoJSON (farm management systems, precision agriculture platforms) may not handle the type change. Should the fix be rejected if it changes geometry type?

7. **Validation strictness.** The current validation flags `null_geometry` and `empty_geometry` as issues. Should features with null geometry be allowed as valid data (they are legal in the GeoJSON spec, RFC 7946 §3.2)?

8. **Area units.** Areas are displayed in m² internally but not surfaced in the UI. Should the table or tooltip show area in ha (hectares) for agricultural users? What threshold should trigger the switch from m² to ha?

9. **Property editing and data integrity.** Inline property editing in the table saves all values as strings. A field that was originally an integer (e.g. `field_id: 42`) becomes a string after editing. Should the editor detect and preserve original value types?

10. **Concurrent editing.** If the same file is opened in two browser tabs and both submit edits via `/update`, the second response silently overwrites the first. This is a consequence of the stateless design and is acceptable for a single-user tool, but should be documented as a limitation if multi-user access is ever considered.

11. **Projection handling.** Is there a requirement to support non-WGS84 input files? If so, the appropriate place to add reprojection is in `file_validation.py` before the Pydantic parsing step, using `pyproj`.

12. **Audit trail.** For regulatory or traceability purposes, should the application record *what* was changed, *by whom*, and *when*? This would require a backend database and authentication, but the question of whether an audit log is a requirement should be answered before the project grows further.

---

*These notes reflect the state of the project as of the v1 release. They are intended to inform the author and future contributors about the reasoning behind current decisions and the known edges of the implementation. Last updated: June 2026.*
