# Frontend Technical Docs

Next.js 16 single-page dashboard for uploading, inspecting, editing, and
re-validating GeoJSON farm-boundary data against the backend API.

## Stack

| Concern | Library | Version |
|---|---|---|
| Framework | Next.js (App Router) | ^16.2.9 |
| UI library | React | 19.2.7 |
| State management | Redux Toolkit | ^2.12.0 |
| Map rendering | MapLibre GL JS | ^5.24.0 |
| Styling | Tailwind CSS | — |
| File upload UI | react-dropzone | ^15.0.0 |
| Toasts | react-hot-toast | ^2.6.0 |
| Tests | Jest + Testing Library | — |
| Lint | ESLint (`eslint-config-next`) | — |

## Directory layout

```
frontend/src/
├── app/
│   ├── layout.tsx           # Root layout — wraps app in ReduxProvider, Toaster
│   ├── page.tsx             # Main dashboard page — the only route
│   └── globals.css
├── components/
│   ├── upload/UploadZone.tsx     # Drag-and-drop / click-to-upload, progress bar
│   ├── map/MapView.tsx           # MapLibre map, draw/delete/edit tools
│   ├── table/FeatureTable.tsx    # Paginated/searchable/sortable feature list
│   └── ui/
│       ├── Header.tsx            # Top bar: filename, Save, Download, New File
│       ├── SummaryCards.tsx      # Aggregate count cards
│       └── IssuesPanel.tsx       # Geometry issues + duplicate groups, auto-fix
├── store/
│   ├── store.ts              # configureStore, AppThunk type
│   ├── index.ts              # Barrel export
│   ├── hooks.ts              # Typed useAppDispatch / useAppSelector
│   ├── dashboardSlice.ts     # Data state: upload, response, live FeatureCollection
│   ├── tableSlice.ts         # UI-only state: filter, search, sort, pagination
│   ├── dashboardThunks.ts    # Async actions: uploadFile, saveChanges
│   └── selectors.ts          # All derived/memoised selectors
├── lib/
│   ├── api.ts                # fetch/XHR wrappers for the backend
│   └── geojson-utils.ts      # Pure helpers: bbox, download, formatting, colour
├── types/index.ts            # Shared types mirroring backend Pydantic models
├── providers/ReduxProvider.tsx
└── __tests__/dashboard.test.tsx   # Full suite: utils, slices, selectors, components
```

## Architecture overview

```
Browser
  │
  ▼
app/page.tsx  ── thin orchestrator: reads selectors, dispatches actions/thunks
  │
  ├─→ UploadZone        (no data yet)
  ├─→ SummaryCards       ┐
  ├─→ MapView             │  read from Redux via selectors,
  ├─→ IssuesPanel         │  call back up via props
  └─→ FeatureTable       ┘  (reads/dispatches Redux directly — see below)
        │
        ▼
   Redux store (dashboard + table slices)
        │
        ▼
   dashboardThunks → lib/api.ts → FastAPI backend
```

`page.tsx` is deliberately layout-only. Business logic lives in the store;
derived/computed table data lives in `selectors.ts`. `FeatureTable` is the one
exception to "components read via props" — it reads its own filter/search/sort/page
state directly from the `table` slice via `useAppSelector`, so `page.tsx` doesn't
need to thread that state through.

## State model (`store/dashboardSlice.ts`)

```ts
interface DashboardState {
  uploadStatus: "idle" | "uploading" | "success" | "error";
  uploadProgress: number;
  filename: string | null;
  fileSizeBytes: number | null;
  response: ProcessGeoJSONResponse | null;   // last backend analysis report
  featureCollection: FeatureCollection | null; // live data shown on map/table
  hasUnsavedChanges: boolean;                  // true when featureCollection has diverged from `response`
  selectedFeatureIndex: number | null;
  isSaving: boolean;
  error: string | null;
}
```

**Two kinds of "current data" are tracked deliberately:**

- `response` — the last full analysis from the backend (`/upload` or `/save`).
  This is the source of truth for issues, duplicate groups, and per-feature
  validity/area/centroid.
- `featureCollection` — the live geometry/properties shown on the map and
  table. After an upload or save these match exactly (each feature stamped
  with `properties._originalIndex` linking it back to its `ProcessedFeature`
  in `response.features`). Local edits (map draw/delete, inline property
  edits, applied auto-fixes) mutate `featureCollection` immediately for a
  responsive UI, while `hasUnsavedChanges` flips to `true` and the Header's
  Save button appears. `response` is patched optimistically alongside it
  (e.g. removing issues for deleted features) so the UI doesn't look stale
  while waiting for the next save — but the full re-validation only happens
  once the user clicks Save and the backend responds.

### Actions

| Action | Trigger | Effect |
|---|---|---|
| `uploadStarted` / `uploadProgressUpdated` / `uploadSucceeded` / `uploadFailed` | `uploadFile` thunk | Drive the upload lifecycle; `uploadSucceeded` stamps and stores the new `featureCollection` |
| `mapEditStaged` | MapView "Save" (local, see below) | Replaces `featureCollection` with the edited version; optimistically trims issues/duplicate groups for deleted features; sets `hasUnsavedChanges` |
| `geometryFixApplied` | IssuesPanel "Apply Fix" | Patches one feature's geometry in `featureCollection`, marks it valid in `response`, removes its issue |
| `propertiesUpdated` | FeatureTable inline edit | Merges new property values into one feature, stamps `_edited: true`, sets `hasUnsavedChanges` |
| `saveStarted` / `saveSucceeded` / `saveFailed` | `saveChanges` thunk | `saveSucceeded` replaces both `response` and `featureCollection` with the fresh backend result and clears `hasUnsavedChanges` |
| `featureSelected` | map click / table row / issue card | Sets `selectedFeatureIndex`, used to sync highlighting across all three panels |
| `resetDashboard` | Header "New File" | Returns to `initialState` |

### Naming convention: "Save" is the one verb

Every layer — the Header button label, the Redux actions (`saveStarted` /
`saveSucceeded` / `saveFailed`), the thunk (`saveChanges`), the API client
function (`saveFeatureCollection`), and the backend route (`POST /api/geojson/save`)
— uses **save**, consistently. There is no separate "update" or "analyse"
terminology anywhere in this flow; if you're adding a new feature that
re-submits data to the backend, follow this naming rather than introducing a
new verb.

### Two distinct "saves" — don't confuse them

- **MapView's local save** (`onSave` prop, wired to `mapEditStaged`) commits
  draw/delete edits from the map's edit-mode toolbar into Redux. This is a
  client-side commit only — it does **not** call the backend. It exists so
  the map's edit session has a clear "done editing" boundary distinct from
  the global save.
- **The Header's Save button** (`onSave` prop, wired to `saveChanges()`) is
  the one that calls the backend (`POST /api/geojson/save`) and refreshes
  `response` with a real re-validation. It only appears when
  `hasUnsavedChanges` is true.

Both are named "Save" by design (it's the same end-user concept — "save my
edits" — at two different scopes), but they dispatch different actions and
only one of them talks to the network.

## Table UI state (`store/tableSlice.ts`)

Kept in Redux (rather than `FeatureTable` local state) specifically so the
table preserves position when the user clicks a feature on the map or in the
issues panel, and resets predictably on new data:

```ts
interface TableState {
  filter: "all" | "valid" | "invalid" | "duplicate";
  searchQuery: string;
  sortKey: "index" | "type" | "valid" | "duplicate" | "area";
  sortDir: "asc" | "desc";
  currentPage: number;
  pageSize: number;
}
```

`extraReducers` listen for `dashboardSlice` actions:
- `uploadSucceeded` → full reset to `initialState` (new dataset, nothing to preserve)
- `saveSucceeded` → resets page to 1 and clears search, but **keeps** the
  active filter tab and page size, since those usually still apply after a re-save

## Selectors (`store/selectors.ts`)

Two kinds:

**Raw / cheap** — direct property access, no memoisation needed
(`selectFeatureCollection`, `selectIsSaving`, `selectHasUnsavedChanges`, etc.)

**Derived / memoised** (via `createSelector`) — the table's
filter → search → sort → paginate pipeline:

```
selectAllProcessedFeatures
        │
selectPresentOriginalIndices ──→ selectDeletedIndices
        │
        ▼
selectAllRows  (merges backend ProcessedFeature with live FeatureCollection state
                into a TableRow; computes isDrawn / isDeleted / isEdited flags)
        │
        ▼
selectFilteredRows  (apply active filter tab)
        │
        ▼
selectSearchedRows  (apply free-text search across visible properties)
        │
        ▼
selectSortedRows    (apply sort key/direction)
        │
        ├─→ selectTotalFilteredCount / selectTotalPages
        │
        ▼
selectPagedRows  (slice to current page; deleted rows are pinned above every
                  page, outside the page-size count, so pending deletions are
                  always visible before the next save)
```

`TableRow.index` uses a **negative sentinel** (`-(originalIndex + 1)`) for
deleted rows so it can never collide with a live array position — this is a
React-key convenience only; components must use `row.originalIndex` for any
actual property lookup on a deleted row.

## API client (`lib/api.ts`)

Three functions, all returning typed promises and normalising backend error
bodies (`detail` / `error` fields) into plain `Error` objects:

| Function | Endpoint | Notes |
|---|---|---|
| `uploadGeoJSON(file, onProgress?)` | `POST /api/geojson/upload` | Uses `XMLHttpRequest` when `onProgress` is supplied (for the progress bar), falls back to `fetch` otherwise |
| `saveFeatureCollection(fc)` | `POST /api/geojson/save` | Plain `fetch`, JSON body |
| `checkHealth()` | `GET /health` | Liveness check; not currently wired into any UI |

Base URL comes from `NEXT_PUBLIC_API_URL` (defaults to `http://localhost:8000`).

## Thunks (`store/dashboardThunks.ts`)

- **`uploadFile(file)`** — dispatches the upload lifecycle actions, forwards
  XHR progress events into `uploadProgressUpdated`, and fires a success/error toast.
- **`saveChanges()`** — reads the current `featureCollection` from state,
  calls `saveFeatureCollection`, dispatches `saveSucceeded`/`saveFailed`, and
  toasts the result. No-ops if there's no `featureCollection` yet.

## Components

### `MapView.tsx`

The most stateful component — owns its own edit-mode session
(`isEditing`, `drawTool`, `drawPoints`, `attrEdit`) on top of the Redux-backed
`featureCollection` prop.

- **Render-vs-effect note:** `editedFC` (the map's working copy) is kept in
  sync with the `featureCollection` prop via a render-time check
  (`if (!isEditing && featureCollection !== lastSyncedFCRef.current) { ... setEditedFC(...) }`)
  rather than inside a `useEffect`. This follows React's
  ["you might not need an effect"](https://react.dev/learn/you-might-not-need-an-effect)
  guidance for adjusting state during render and avoids an extra render pass;
  don't move this back into an effect without good reason, since
  `react-hooks/set-state-in-effect` will flag it again.
- Colour-codes features by status (valid / invalid / duplicate / selected)
  via `getFeatureColor()`.
- Legend click sets a `LegendFilter` that dims non-matching features to greyscale.
- Edit mode supports: drawing new polygons (click to add vertices,
  double-click to close) or points, deleting the selected feature, and
  editing attribute properties via an inline modal — all staged in local
  `editedFC` state until "Save" (→ `onSave` → `mapEditStaged`) or "Cancel"
  (discards back to the `featureCollection` prop).

### `FeatureTable.tsx`

Reads its own UI state from the `table` slice and derived rows from
`selectors.ts`; only needs `onSelectFeature` and `onUpdateProperties` as props.
Inline property editing is staged in local component state
(`editingIndex` / `editProps`) until the row's save button commits it via
`onUpdateProperties` → `propertiesUpdated`.

### `IssuesPanel.tsx`

Lists `GeometryIssue`s and `DuplicateGroup`s from `response.summary`. Issue
cards resolve a feature's `_originalIndex` to its current live array position
(`resolveLiveIndex`) before calling `onSelectFeature`, since a feature's
position in `featureCollection` can shift after deletions. "Apply Fix" only
shows for issues with `auto_fix_available` and a non-null `fixed_geometry`.

### `Header.tsx`

Stateless — all five props (`filename`, `onReset`, `onDownload`, `onSave`,
`hasUnsavedChanges`, `isSaving`) are passed down from `page.tsx`. The Save
button only renders when both `onSave` and `hasUnsavedChanges` are truthy,
and is disabled while `isSaving`.

### `UploadZone.tsx`

Wraps `react-dropzone`; accepts `.geojson` files up to the configured max
size, shows a progress bar driven by Redux state (not local state) so it
stays in sync with the XHR upload happening in the thunk.

## Types (`types/index.ts`)

Single source of truth for shapes that mirror the backend's Pydantic models
(`GeometryIssue`, `DuplicateGroup`, `AnalysisSummary`, `ProcessedFeature`,
`ProcessGeoJSONResponse`) plus a few frontend-only types (`UploadStatus`,
`FeatureFilter`, `MapViewState`). `UploadStatus` is defined once here and
re-exported through `dashboardSlice.ts` — don't redefine it elsewhere.

`DashboardState` is **not** defined here; its single definition lives in
`store/dashboardSlice.ts` next to the reducer that owns it, since that's the
shape actually used by the store.

## Running locally

```bash
cd frontend
npm install
npm run dev
```

Requires `NEXT_PUBLIC_API_URL` pointed at a running backend (see
`frontend/.env.example`; defaults to `http://localhost:8000`).

## Testing

```bash
cd frontend
npm test
```

`src/__tests__/dashboard.test.tsx` is the entire suite: pure utility
functions, every `dashboardSlice`/`tableSlice` reducer case, every memoised
selector (including pagination/search/sort edge cases), and component
behaviour for `SummaryCards`, `IssuesPanel`, `Header`, `UploadZone`, and the
Redux-connected `FeatureTable`. MapLibre is mocked (`src/__mocks__/maplibre-gl.ts`)
since it requires a real WebGL context.

## Linting

```bash
cd frontend
npx eslint .
npx tsc --noEmit
```

Config is `eslint-config-next` (core-web-vitals + typescript) via
`eslint.config.mjs`. Notably enforces `react-hooks/set-state-in-effect` — see
the `MapView.tsx` note above if you see this rule fire.

## Known limitations

- `checkHealth()` exists in the API client but isn't called from any
  component — there's no liveness indicator in the UI yet.
- Duplicate detection is exact-match only (inherited from the backend); the
  frontend has no separate near-duplicate visualisation.
- `MapView`'s draw tool only supports polygons and points — no lines/multi-geometries.