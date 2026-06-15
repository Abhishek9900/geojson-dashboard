# GeoJSON Farm Dashboard — Frontend Technical Documentation

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Directory Structure](#3-directory-structure)
4. [Type System](#4-type-system)
5. [API Client (`lib/api.ts`)](#5-api-client)
6. [GeoJSON Utilities (`lib/geojson-utils.ts`)](#6-geojson-utilities)
7. [Redux Store](#7-redux-store)
   - 7.1 [Store Configuration](#71-store-configuration)
   - 7.2 [Dashboard Slice](#72-dashboard-slice)
   - 7.3 [Table Slice](#73-table-slice)
   - 7.4 [Async Thunks](#74-async-thunks)
   - 7.5 [Selectors](#75-selectors)
8. [Components](#8-components)
   - 8.1 [Layout & Providers](#81-layout--providers)
   - 8.2 [Dashboard Page](#82-dashboard-page)
   - 8.3 [Header](#83-header)
   - 8.4 [UploadZone](#84-uploadzone)
   - 8.5 [SummaryCards](#85-summarycards)
   - 8.6 [MapView](#86-mapview)
   - 8.7 [IssuesPanel](#87-issuespanel)
   - 8.8 [FeatureTable](#88-featuretable)
9. [State Management Data Flow](#9-state-management-data-flow)
10. [Testing](#10-testing)
11. [Configuration Files](#11-configuration-files)
12. [GeoJSON Architecture Notes](#12-geojson-architecture-notes)

---

## 1. Project Overview

The GeoJSON Farm Dashboard is a Next.js 16 single-page application for uploading, validating, visualising, and editing GeoJSON farm boundary data. It communicates with a FastAPI backend that performs geometry validation and duplicate detection.

**Key user flows:**

1. **Upload** — Drag-and-drop or click to upload a `.geojson` file. The file is POSTed to the backend, which returns a full analysis report.
2. **Inspect** — Summary cards show aggregate counts; the MapView renders features colour-coded by status; the IssuesPanel lists geometry errors and duplicate groups.
3. **Edit** — Features can be edited on the map (draw tools) or via inline property editing in the FeatureTable. Edits are staged locally.
4. **Save** — The "Save" button submits the current (possibly edited) FeatureCollection back to the backend for a fresh analysis.
5. **Download** — The current FeatureCollection (including edits) is serialised to a `.geojson` file and downloaded.

---

## 2. Tech Stack

| Concern | Library |
|---|---|
| Framework | Next.js 16 (App Router, `"use client"`) |
| Language | TypeScript 6 |
| State management | Redux Toolkit 2 (`createSlice`, `createSelector`, thunks) |
| Map | MapLibre GL 5 via `react-map-gl` 8 |
| Styling | Tailwind CSS 4 |
| Drag-and-drop upload | `react-dropzone` 15 |
| Toast notifications | `react-hot-toast` 2 |
| Testing | Jest 30 + React Testing Library 16 + `jest-dom` 6 |
| Linting / formatting | ESLint 9, Prettier 3 |
| Containerisation | Docker (multi-stage, Node 20 Alpine) |

---

## 3. Directory Structure

```
frontend/
├── src/
│   ├── app/
│   │   ├── layout.tsx          Root layout; wraps children in ReduxProvider + Toaster
│   │   ├── page.tsx            Main dashboard page (orchestrator component)
│   │   └── globals.css         Tailwind base styles
│   ├── components/
│   │   ├── map/
│   │   │   └── MapView.tsx     MapLibre GL map with draw tools and feature highlighting
│   │   ├── table/
│   │   │   └── FeatureTable.tsx Paginated, searchable, sortable, editable feature table
│   │   ├── ui/
│   │   │   ├── Header.tsx      Sticky top bar with brand, filename, and action buttons
│   │   │   ├── IssuesPanel.tsx Scrollable list of geometry issues and duplicate groups
│   │   │   └── SummaryCards.tsx Four metric cards (total / valid / invalid / duplicates)
│   │   └── upload/
│   │       └── UploadZone.tsx  Drag-and-drop upload zone with progress bar
│   ├── lib/
│   │   ├── api.ts              HTTP client for all backend endpoints
│   │   └── geojson-utils.ts    Pure GeoJSON utility functions
│   ├── providers/
│   │   └── ReduxProvider.tsx   Client-side Redux <Provider> wrapper
│   ├── store/
│   │   ├── index.ts            Barrel export
│   │   ├── store.ts            configureStore; exports RootState / AppDispatch / AppThunk
│   │   ├── hooks.ts            Typed useAppDispatch / useAppSelector
│   │   ├── dashboardSlice.ts   Upload + analysis + feature-edit state
│   │   ├── tableSlice.ts       Filter / search / sort / pagination UI state
│   │   ├── dashboardThunks.ts  uploadFile and analyseCurrentFC thunks
│   │   └── selectors.ts        Memoised derived-data selectors
│   ├── types/
│   │   └── index.ts            Shared TypeScript interfaces (mirrors backend Pydantic models)
│   └── __mocks__/
│       └── maplibre-gl.ts      Jest mock for maplibre-gl (no WebGL in jsdom)
├── __tests__/
│   └── dashboard.test.tsx      Full test suite
├── jest.config.ts
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── Dockerfile
```

---

## 4. Type System

**File:** `src/types/index.ts`

All types mirror the FastAPI backend's Pydantic models, enabling end-to-end type safety without code generation.

### API Response Types

```ts
GeometryIssue        // Single geometry problem on one feature
DuplicateGroup       // Set of features that are exact or near-exact duplicates
AnalysisSummary      // Aggregate counts + full issues + duplicate group detail
ProcessedFeature     // One feature annotated with validity, issues, area, centroid
ProcessGeoJSONResponse  // Top-level upload/update response (filename, size, summary, features)
UpdateFeaturesResponse  // Legacy update response (kept for compatibility)
```

### UI State Types

```ts
UploadStatus = "idle" | "uploading" | "success" | "error"
DashboardState       // Complete shape of the dashboard Redux slice
FeatureFilter = "all" | "valid" | "invalid" | "duplicate"
MapViewState         // { longitude, latitude, zoom }
```

---

## 5. API Client

**File:** `src/lib/api.ts`

All HTTP communication is centralised here. The rest of the application never calls `fetch` or `XMLHttpRequest` directly.

### Configuration

```ts
const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
```

Set `NEXT_PUBLIC_API_URL` in `.env.local` to point at a non-default backend.

### Functions

#### `uploadGeoJSON(file, onProgress?)`

```ts
async function uploadGeoJSON(
  file: File,
  onProgress?: (percent: number) => void
): Promise<ProcessGeoJSONResponse>
```

POSTs the file as `multipart/form-data` to `/api/geojson/upload`.

- When `onProgress` is provided, uses `XMLHttpRequest` so upload progress events can be forwarded to the Redux store (and rendered in the progress bar).
- Falls back to `fetch` when no progress callback is needed.

#### `updateGeoJSON(featureCollection)`

```ts
async function updateGeoJSON(
  featureCollection: FeatureCollection
): Promise<ProcessGeoJSONResponse>
```

POSTs an edited `FeatureCollection` as JSON to `/api/geojson/update`. Returns the same shape as `uploadGeoJSON` so the store can apply the same `analyseSucceeded` action.

#### `checkHealth()`

```ts
async function checkHealth(): Promise<{ status: string }>
```

Lightweight `GET /health` liveness check.

### Error Handling

The internal `handleResponse<T>` helper extracts `detail` or `error` fields from FastAPI error bodies and surfaces them as plain `Error` objects. Non-JSON error bodies (e.g. nginx gateway errors) are wrapped as `HTTP <status>`.

---

## 6. GeoJSON Utilities

**File:** `src/lib/geojson-utils.ts`

All functions are pure and side-effect-free unless noted. Exported functions:

| Function | Signature | Description |
|---|---|---|
| `computeBBox` | `(fc: FeatureCollection) => BBox \| null` | Walks all coordinates to return `[minLon, minLat, maxLon, maxLat]`. Returns `null` for empty or null-geometry collections. |
| `computeFeatureBBox` | `(feature: Feature<Geometry>) => BBox \| null` | Delegates to `computeBBox` with a single-feature collection. |
| `getInitialViewState` | `(fc: FeatureCollection) => MapViewState` | Returns a `{longitude, latitude, zoom}` centred on the data's bounding box, or `{0, 20, 2}` as a world-view fallback. |
| `downloadGeoJSON` | `(fc: FeatureCollection, filename: string) => void` | **Side-effect.** Creates an object URL, triggers a browser download, then immediately revokes the URL. Ensures `.geojson` extension. |
| `formatBytes` | `(bytes: number) => string` | Human-readable byte size: `"512 B"`, `"1.5 KB"`, `"2.50 MB"`. |
| `getFeatureColor` | `(isValid, isDuplicate, isSelected) => string` | Returns a hex colour string. Priority: selected (amber) > duplicate (violet) > invalid (red) > valid (green). |
| `isGeometry` | `(obj: unknown) => obj is Geometry` | Narrow type guard — checks for a non-null object with a `type` field. |

The internal `walkCoordinates` helper recursively walks nested coordinate arrays (supporting all GeoJSON geometry types including `GeometryCollection`) and calls a visitor on each `[lon, lat]` leaf.

---

## 7. Redux Store

### 7.1 Store Configuration

**File:** `src/store/store.ts`

```ts
const store = configureStore({
  reducer: {
    dashboard: dashboardReducer,
    table: tableReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredPaths: ["dashboard.featureCollection", "dashboard.pendingFC", "dashboard.response"],
      },
    }),
});
```

The serialisability check is relaxed for `featureCollection`, `pendingFC`, and `response` because large `FeatureCollection` objects with complex coordinate arrays would trigger false positives.

**Exported types:**

- `RootState` — inferred from `store.getState`
- `AppDispatch` — inferred from `store.dispatch`
- `AppThunk<ReturnType = void>` — typed thunk action creator type

### 7.2 Dashboard Slice

**File:** `src/store/dashboardSlice.ts`

Owns all state related to the loaded file and its analysis.

#### State Shape (`DashboardState`)

| Field | Type | Description |
|---|---|---|
| `uploadStatus` | `UploadStatus` | `"idle" \| "uploading" \| "success" \| "error"` |
| `uploadProgress` | `number` | 0–100 upload percentage |
| `filename` | `string \| null` | Name of the loaded file |
| `fileSizeBytes` | `number \| null` | Raw file size |
| `response` | `ProcessGeoJSONResponse \| null` | Last backend analysis result |
| `featureCollection` | `FeatureCollection \| null` | Live FC shown on map/table (may differ from `response` after edits) |
| `pendingFC` | `FeatureCollection \| null` | Staged FC awaiting re-analysis; non-null shows the Save button |
| `selectedFeatureIndex` | `number \| null` | Map ↔ table ↔ issues panel sync |
| `isSaving` | `boolean` | True while the re-analysis API call is in flight |
| `hasPending` | `boolean` | True after inline property edits (supplements `pendingFC` check) |
| `error` | `string \| null` | Last upload error message |

#### Reducers

| Action | Payload | Effect |
|---|---|---|
| `uploadStarted` | — | Sets status to `"uploading"`, clears error |
| `uploadProgressUpdated` | `number` | Updates `uploadProgress` |
| `uploadSucceeded` | `ProcessGeoJSONResponse` | Stores response, builds stamped FC, clears pending state |
| `uploadFailed` | `string` | Sets status to `"error"`, stores message |
| `mapEditStaged` | `FeatureCollection` | Applies optimistic patch: removes issues/duplicates for deleted features, stages FC |
| `geometryFixApplied` | `GeometryIssue` | Patches feature geometry in live FC, marks feature valid, removes issue from summary |
| `propertiesUpdated` | `{ index, props }` | Merges new property values into the feature (preserving `_` internal keys), sets `hasPending` |
| `analyseStarted` | — | Sets `isSaving = true` |
| `analyseSucceeded` | `ProcessGeoJSONResponse` | Replaces response + FC, clears pending state |
| `analyseFailed` | — | Sets `isSaving = false` |
| `featureSelected` | `number \| null` | Updates `selectedFeatureIndex` |
| `resetDashboard` | — | Returns to `initialState` |

#### `buildStampedFC` (internal helper)

Converts a `ProcessGeoJSONResponse` into a `FeatureCollection` where each feature gets a `properties._originalIndex` stamp. This stamp is used throughout the app to correlate live FC features with their backend `ProcessedFeature` records, even after map edits that add, remove, or reorder features.

### 7.3 Table Slice

**File:** `src/store/tableSlice.ts`

Owns all UI state for `FeatureTable` that is independent of loaded data.

#### State Shape (`TableState`)

| Field | Type | Default |
|---|---|---|
| `filter` | `FeatureFilter` | `"all"` |
| `searchQuery` | `string` | `""` |
| `sortKey` | `SortKey` | `"index"` |
| `sortDir` | `SortDir` | `"asc"` |
| `currentPage` | `number` | `1` |
| `pageSize` | `number` | `50` |

`SortKey = "index" | "type" | "valid" | "duplicate" | "area"`
`SortDir = "asc" | "desc"`

#### Reducers

| Action | Effect |
|---|---|
| `filterChanged` | Updates filter, resets to page 1 |
| `searchQueryChanged` | Updates search, resets to page 1 |
| `sortChanged` | Updates sort key + direction, resets to page 1 |
| `pageChanged` | Jumps to specified page |
| `pageSizeChanged` | Updates page size, resets to page 1 |

#### Extra Reducers (cross-slice)

- `uploadSucceeded` → reset to `initialState`
- `analyseSucceeded` → reset page to 1, clear search (preserves filter and page size)
- `resetDashboard` → reset to `initialState`

### 7.4 Async Thunks

**File:** `src/store/dashboardThunks.ts`

Thunks are separate from the slice to keep the slice a pure reducer with no side-effects.

#### `uploadFile(file: File): AppThunk`

1. Dispatches `uploadStarted`
2. Calls `uploadGeoJSON(file, percent => dispatch(uploadProgressUpdated(percent)))`
3. On success: dispatches `uploadSucceeded(result)`, fires a success toast
4. On error: dispatches `uploadFailed(message)`, fires an error toast

#### `analyseCurrentFC(): AppThunk`

1. Reads `pendingFC ?? featureCollection` from state; returns early if null
2. Dispatches `analyseStarted`
3. Calls `updateGeoJSON(fc)`
4. On success: dispatches `analyseSucceeded(result)`, fires a success toast
5. On error: dispatches `analyseFailed()`, fires an error toast

### 7.5 Selectors

**File:** `src/store/selectors.ts`

All expensive computations live here. Components call a selector and render its result.

#### Raw Selectors (no memoisation)

Cheap single-field projections: `selectDashboard`, `selectTable`, `selectResponse`, `selectFeatureCollection`, `selectSelectedIndex`, `selectUploadStatus`, `selectUploadProgress`, `selectFilename`, `selectIsSaving`, `selectError`, `selectHasPending`, `selectHasData`, plus all table UI selectors.

`selectHasPending` returns `true` when either `pendingFC !== null` or `hasPending === true`.

`selectHasData` returns `true` when `uploadStatus === "success"` and `response !== null`.

#### Derived (memoised) Selectors

**`selectDeletedIndices`** — `Set<number>` of original indices that exist in `response.features` but are absent from the live FC (deleted via map editing).

**`selectAllRows`** — Merges backend `ProcessedFeature` records with live FC metadata into `TableRow[]`. Two categories: deleted rows (in response, not in FC) followed by live rows. Each `TableRow` carries:

```ts
interface TableRow {
  index: number;        // Position in live FC
  pf: ProcessedFeature | null;  // null for newly-drawn features
  geomType: string;
  isDrawn: boolean;     // true = drawn after last analysis
  isDeleted: boolean;   // true = deleted via map edit
  isEdited: boolean;    // true = properties edited in table
}
```

**`selectFilterCounts`** — `Record<FeatureFilter, number>` for the filter tab badges. Excludes deleted rows from "all" count.

**`selectFilteredRows`** — Applies the active filter tab. Deleted and drawn features only appear under `"all"`.

**`selectSearchedRows`** — Case-insensitive search across feature index, geometry type, and all non-`_` property keys and values.

**`selectSortedRows`** — Sorts by `index`, `type` (alphabetical), `valid`, `duplicate`, or `area`.

**`selectTotalFilteredCount`** / **`selectTotalPages`** — Pagination metadata.

**`selectPagedRows`** — Final slice of sorted rows for the current page. This is what `FeatureTable` renders.

---

## 8. Components

### 8.1 Layout & Providers

**`src/app/layout.tsx`** — Root layout. Wraps the app in `ReduxProvider` and renders a `react-hot-toast` `<Toaster>` with dark-mode styling. Sets page title/description metadata.

**`src/providers/ReduxProvider.tsx`** — Thin `"use client"` wrapper around `react-redux`'s `<Provider>`. Required because `layout.tsx` is a server component.

### 8.2 Dashboard Page

**`src/app/page.tsx`** — Orchestrator component. Reads state from selectors, converts user interactions into dispatched actions/thunks, and passes props down to leaf components. Contains no business logic itself.

**Conditional rendering:**

- `!hasData` → shows `<UploadZone>`
- `hasData` → shows `<SummaryCards>`, `<MapView>` + `<IssuesPanel>` side-by-side, then `<FeatureTable>`

**Handler summary:**

| Handler | Dispatches |
|---|---|
| `handleUpload(file)` | `uploadFile(file)` thunk |
| `handleMapSave(fc)` | `mapEditStaged(fc)` + toast |
| `handleApplyFix(issue)` | `geometryFixApplied(issue)` + toast |
| `handleUpdateProperties(index, props)` | `propertiesUpdated({ index, props })` |
| `handleAnalyse()` | `analyseCurrentFC()` thunk |
| `handleDownload()` | `downloadGeoJSON(fc, filename)` + toast |
| `handleReset()` | `resetDashboard()` |
| `handleSelectFeature(idx)` | `featureSelected(idx < 0 ? null : idx)` |

### 8.3 Header

**`src/components/ui/Header.tsx`**

Sticky top bar (`z-50`). Always shows the brand name; conditionally renders:

- Filename badge (when `filename !== null`)
- Save button (when `onAnalyse` provided **and** `hasPending === true`)
- Download button (when `onDownload` provided)
- New File button (when `filename !== null`)

The Save button is `disabled` while `isSaving` is true.

**Props:**

```ts
interface HeaderProps {
  filename: string | null;
  onReset: () => void;
  onDownload?: () => void;
  onAnalyse?: () => void;
  hasPending: boolean;
  isSaving: boolean;
}
```

### 8.4 UploadZone

**`src/components/upload/UploadZone.tsx`**

Drag-and-drop zone powered by `react-dropzone`. Accepts only `.geojson` files (MIME types `application/json` and `application/geo+json`), max 1 file, max 100 MB.

**States:**

- `idle` — Upload icon, text prompt, browse link
- `isDragActive` — FileJson icon, "Drop your .geojson file here"
- `uploading` — Spinner, "Processing... {progress}%", progress bar
- `error` — Red error banner below the zone

The zone is `disabled` and `pointer-events-none` while `status === "uploading"`.

**Props:**

```ts
interface UploadZoneProps {
  onUpload: (file: File) => void;
  status: UploadStatus;
  progress: number;
  error: string | null;
}
```

### 8.5 SummaryCards

**`src/components/ui/SummaryCards.tsx`**

Four metric cards in a responsive `2 × 2` → `1 × 4` grid. Each card shows an icon, a large numeric value, and a label.

| Card | Value | Color |
|---|---|---|
| Total Features | `summary.total_features` | Blue |
| Valid | `summary.valid_features` | Green |
| Issues | `summary.invalid_features` | Red |
| Duplicate Groups | `summary.duplicate_groups` | Purple |

**Props:** `{ summary: AnalysisSummary }`

### 8.6 MapView

**`src/components/map/MapView.tsx`**

MapLibre GL map rendered via `react-map-gl`. Features are colour-coded by status using `getFeatureColor`. Includes draw tools (via `maplibre-gl-draw` or similar) for adding, editing, and deleting features. Fires `onSave(updatedFC)` when the user commits draw edits. Fires `onSelectFeature(index)` when a feature is clicked.

> **Note:** MapView is excluded from unit tests because MapLibre requires WebGL, which is unavailable in jsdom. The `src/__mocks__/maplibre-gl.ts` mock prevents import errors without attempting to render the map.

**Props:**

```ts
{
  featureCollection: FeatureCollection;
  processedFeatures: ProcessedFeature[];
  selectedIndex: number | null;
  onSelectFeature: (index: number) => void;
  onSave: (updatedFC: FeatureCollection) => void;
}
```

### 8.7 IssuesPanel

**`src/components/ui/IssuesPanel.tsx`**

Scrollable `h-[480px]` panel listing geometry issues and duplicate groups.

- If `summary.issues` and `summary.duplicate_groups_detail` are both empty, shows a "No issues found" placeholder.
- Each issue card shows the feature index/ID, description, issue type, and optionally a "Fixable" badge and "Apply fix" button.
- The header shows a "Fix all (N)" button when multiple fixable issues are present and `onApplyFix` is provided.
- Each duplicate group card shows the group description and clickable `#index` chips.

**Props:**

```ts
interface IssuesPanelProps {
  summary: AnalysisSummary;
  onSelectFeature: (index: number) => void;
  onApplyFix?: (issue: GeometryIssue) => void;
}
```

### 8.8 FeatureTable

**`src/components/table/FeatureTable.tsx`**

Paginated, searchable, sortable, and inline-editable feature list. Reads all state directly from Redux via `useAppSelector` — the parent page passes only two callbacks.

**Redux state consumed:** `filter`, `searchQuery`, `sortKey`, `sortDir`, `currentPage`, `pageSize`, `pagedRows`, `totalFilteredCount`, `totalPages`, `filterCounts`, `selectedIndex`, `featureCollection`.

**Local state:** `editingIndex`, `editProps`, `newPropKey`, `newPropValue` (inline edit form).

**Features:**

- Filter tabs (All / Valid / Issues / Duplicates) with count badges
- Free-text search bar
- Sortable columns (index, type, valid, duplicate, area) with chevron indicators
- Inline property editing: pencil → edit form → confirm/cancel
- Row status badges (DELETED, EDITED, DRAWN)
- Selected row amber highlight
- Full pagination with first/prev/page pills/next/last controls and page-size selector
- "No results" message when filter + search yield zero rows

**Props:**

```ts
interface FeatureTableProps {
  onSelectFeature: (index: number) => void;
  onUpdateProperties?: (index: number, props: Record<string, string>) => void;
}
```

---

## 9. State Management Data Flow

```
User action
    │
    ▼
page.tsx handler
    │
    ├─ sync action → dispatch(sliceAction(payload))
    │                       │
    │                       ▼
    │               Redux reducer mutates state (Immer)
    │
    └─ async action → dispatch(thunk())
                             │
                             ├─ dispatch(pendingAction)
                             ├─ await API call
                             └─ dispatch(succeededAction | failedAction)

State change
    │
    ▼
Memoised selectors recompute (only if inputs changed)
    │
    ▼
Subscribed components re-render with new derived data
```

**Feature index lifetime:**

A `_originalIndex` stamp is applied to each feature in the live `FeatureCollection` when a backend response is processed (`buildStampedFC`). This stamp is the stable link between:

- A row in `FeatureTable`
- A map feature in `MapView`
- An issue in `IssuesPanel`
- A `ProcessedFeature` in `response.features`

Newly drawn features have no `_originalIndex`. Deleted features retain their original index in the `deletedIndices` set.

---

## 10. Testing

Tests live in `src/__tests__/dashboard.test.tsx` and are run with Jest + React Testing Library.

```bash
npm test           # run once
npm run test:watch # watch mode
```

### Test Coverage Areas

| Area | What is tested |
|---|---|
| `computeBBox` | Simple polygon, empty FC, null geometries, multi-feature spanning |
| `formatBytes` | Bytes, KB, MB formatting |
| `getFeatureColor` | All four colour states and priority ordering |
| `isGeometry` | Positive and negative type guard cases |
| `SummaryCards` | Values, labels, zero-value rendering |
| `IssuesPanel` | Empty state, issue cards, fixable/non-fixable distinction, callbacks |
| `Header` | Brand, filename badge, conditional buttons, button callbacks |
| `FeatureTable` | Redux-connected: filter tabs, search, selection, empty state, property editing |
| `UploadZone` | Idle, uploading, error states |
| Redux slices | `dashboardSlice` and `tableSlice` reducer logic |
| Selectors | `selectFilterCounts`, `selectPagedRows`, `selectDeletedIndices`, search, sort |
| `downloadGeoJSON` | DOM side-effect (URL creation, anchor click) |
| `getInitialViewState` | Centroid computation, empty FC fallback |
| API client | `uploadGeoJSON` (fetch path, XHR path, error handling), `updateGeoJSON`, `checkHealth` |

### Test Utilities

**`makePolygonFC(...rings)`** — Creates a `FeatureCollection` of `Polygon` features from coordinate rings.

**`makeMockFeature(index, isValid, isDuplicate)`** — Creates a `ProcessedFeature` with a standard coffee-farm polygon.

**`renderWithStore(ui, preloadedState?)`** — Renders a component inside a real Redux store. Used for Redux-connected components like `FeatureTable`.

### Mocks

**`src/__mocks__/maplibre-gl.ts`** — Jest manual mock. Replaces `maplibre-gl` with a minimal stub so `MapView` can be imported without WebGL. `MapView` itself is not rendered in tests.

The mock is registered in `jest.config.ts`:

```ts
moduleNameMapper: {
  "^maplibre-gl$": "<rootDir>/src/__mocks__/maplibre-gl.ts",
}
```

---

## 11. Configuration Files

### `next.config.ts`

Standard Next.js config. No custom webpack overrides required.

### `tsconfig.json`

- `"strict": true`
- Path alias: `"@/*"` → `"./src/*"` (used throughout the codebase as `@/store`, `@/types`, etc.)

### `tailwind.config.ts`

Scans `./src/**/*.{ts,tsx}` for class names. No custom theme extensions (uses Tailwind defaults).

### `jest.config.ts`

Uses `next/jest` preset for Next.js-aware transformation. Key settings:

```ts
testEnvironment: "jsdom"
setupFilesAfterFramework: ["@testing-library/jest-dom"]
moduleNameMapper: {
  "^@/(.*)$": "<rootDir>/src/$1",
  "^maplibre-gl$": "<rootDir>/src/__mocks__/maplibre-gl.ts"
}
```

### `Dockerfile`

Multi-stage build:

1. **deps** — installs `node_modules` from `package-lock.json`
2. **builder** — copies source, runs `next build`
3. **runner** — minimal Node 20 Alpine image, copies only the `.next/standalone` output

### `.env.example`

```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

---

## 12. GeoJSON Architecture Notes

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
