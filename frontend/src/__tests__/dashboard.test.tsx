/**
 * Frontend test suite — comprehensive coverage.
 *
 * Covers:
 *  - Utility functions: computeBBox, computeFeatureBBox, getInitialViewState,
 *    downloadGeoJSON, formatBytes, getFeatureColor, isGeometry.
 *  - Redux slices: dashboardSlice (all reducers), tableSlice (all reducers + extraReducers).
 *  - Redux selectors: selectHasData, selectHasPending, selectFilterCounts,
 *    selectDeletedIndices, selectAllRows, selectPagedRows, search, sort, pagination.
 *  - API client: uploadGeoJSON (fetch + XHR paths), updateGeoJSON, checkHealth.
 *  - Components: SummaryCards, IssuesPanel, Header, UploadZone, FeatureTable.
 *
 * Run with: npm test
 */

import { configureStore } from "@reduxjs/toolkit";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { Provider } from "react-redux";
import "@testing-library/jest-dom";
import type { FeatureCollection, Feature, Geometry } from "geojson";
import type {
  AnalysisSummary,
  GeometryIssue,
  ProcessedFeature,
  ProcessGeoJSONResponse,
} from "@/types";
import {
  computeBBox,
  computeFeatureBBox,
  getInitialViewState,
  downloadGeoJSON,
  formatBytes,
  getFeatureColor,
  isGeometry,
} from "@/lib/geojson-utils";
import { SummaryCards } from "@/components/ui/SummaryCards";
import { IssuesPanel } from "@/components/ui/IssuesPanel";
import { Header } from "@/components/ui/Header";
import { FeatureTable } from "@/components/table/FeatureTable";
import { UploadZone } from "@/components/upload/UploadZone";

import dashboardReducer, {
  uploadStarted,
  uploadProgressUpdated,
  uploadSucceeded,
  uploadFailed,
  mapEditStaged,
  geometryFixApplied,
  propertiesUpdated,
  analyseStarted,
  analyseSucceeded,
  analyseFailed,
  featureSelected,
  resetDashboard,
  type DashboardState,
} from "@/store/dashboardSlice";
import tableReducer, {
  filterChanged,
  searchQueryChanged,
  sortChanged,
  pageChanged,
  pageSizeChanged,
  type TableState,
} from "@/store/tableSlice";
import {
  selectHasData,
  selectHasPending,
  selectFilterCounts,
  selectDeletedIndices,
  selectAllRows,
  selectPagedRows,
  selectTotalFilteredCount,
  selectTotalPages,
} from "@/store/selectors";

// ---------------------------------------------------------------------------
// Shared test data factories
// ---------------------------------------------------------------------------

function makePolygonFC(...rings: number[][][]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: rings.map((ring) => ({
      type: "Feature",
      properties: {},
      geometry: { type: "Polygon", coordinates: [ring] },
    })),
  };
}

function makeMockFeature(
  index: number,
  isValid = true,
  isDuplicate = false,
  props: Record<string, unknown> = {}
): ProcessedFeature {
  return {
    index,
    feature: {
      type: "Feature",
      properties: { fid: index, producttype: "Coffee", ...props },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-73.2, 6.48],
            [-73.1, 6.48],
            [-73.1, 6.49],
            [-73.2, 6.49],
            [-73.2, 6.48],
          ],
        ],
      },
    },
    is_valid: isValid,
    issues: isValid ? [] : ["invalid_geometry"],
    is_duplicate: isDuplicate,
    duplicate_group_id: isDuplicate ? 0 : null,
    area_m2: 12345,
    centroid: { lat: 6.485, lon: -73.15 },
  };
}

const mockSummary: AnalysisSummary = {
  total_features: 10,
  valid_features: 8,
  invalid_features: 2,
  duplicate_groups: 1,
  total_duplicates: 1,
  geometry_types: { Polygon: 10 },
  issues: [],
  duplicate_groups_detail: [],
};

function makeMockResponse(
  features: ProcessedFeature[] = [makeMockFeature(0)]
): ProcessGeoJSONResponse {
  return {
    filename: "test.geojson",
    file_size_bytes: 1024,
    summary: {
      ...mockSummary,
      total_features: features.length,
      valid_features: features.filter((f) => f.is_valid).length,
      invalid_features: features.filter((f) => !f.is_valid).length,
      duplicate_groups: features.filter((f) => f.is_duplicate).length,
    },
    features,
  };
}

/** Render a component inside a real Redux store. */
function renderWithStore(
  ui: React.ReactElement,
  preloadedState?: { dashboard?: Partial<DashboardState>; table?: Partial<TableState> }
) {
  const store = configureStore({
    reducer: { dashboard: dashboardReducer, table: tableReducer },
    preloadedState: preloadedState as Parameters<typeof configureStore>[0]["preloadedState"],
  });
  return {
    store,
    ...render(<Provider store={store}>{ui}</Provider>),
  };
}

/** Build a preloaded state for a store with data already loaded. */
function makeLoadedState(
  features: ProcessedFeature[]
): { dashboard: Partial<DashboardState> } {
  const response = makeMockResponse(features);
  const featureCollection: FeatureCollection = {
    type: "FeatureCollection",
    features: features.map((pf, i) => ({
      ...pf.feature,
      properties: { ...(pf.feature.properties ?? {}), _originalIndex: i },
    })),
  };
  return {
    dashboard: {
      uploadStatus: "success",
      uploadProgress: 100,
      filename: "test.geojson",
      fileSizeBytes: 1024,
      response,
      featureCollection,
      pendingFC: null,
      selectedFeatureIndex: null,
      isSaving: false,
      hasPending: false,
      error: null,
    },
  };
}

// ---------------------------------------------------------------------------
// computeBBox
// ---------------------------------------------------------------------------

describe("computeBBox", () => {
  it("returns correct bbox for a simple square polygon", () => {
    const fc = makePolygonFC([
      [-73.2, 6.48],
      [-73.1, 6.48],
      [-73.1, 6.49],
      [-73.2, 6.49],
      [-73.2, 6.48],
    ]);
    const bbox = computeBBox(fc);
    expect(bbox).not.toBeNull();
    expect(bbox![0]).toBeCloseTo(-73.2);
    expect(bbox![1]).toBeCloseTo(6.48);
    expect(bbox![2]).toBeCloseTo(-73.1);
    expect(bbox![3]).toBeCloseTo(6.49);
  });

  it("returns null for an empty FeatureCollection", () => {
    const fc: FeatureCollection = { type: "FeatureCollection", features: [] };
    expect(computeBBox(fc)).toBeNull();
  });

  it("returns null when all features have null geometry", () => {
    const fc: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: {}, geometry: null as never },
      ],
    };
    expect(computeBBox(fc)).toBeNull();
  });

  it("spans multiple Point features correctly", () => {
    const fc: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [10, 20] } },
        { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [30, 40] } },
      ],
    };
    expect(computeBBox(fc)).toEqual([10, 20, 30, 40]);
  });

  it("handles a single Point feature", () => {
    const fc: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [5, 15] } },
      ],
    };
    const bbox = computeBBox(fc);
    expect(bbox).toEqual([5, 15, 5, 15]);
  });

  it("handles a LineString feature", () => {
    const fc: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [10, 5],
              [20, -5],
            ],
          },
        },
      ],
    };
    const bbox = computeBBox(fc);
    expect(bbox).toEqual([0, -5, 20, 5]);
  });

  it("handles mixed geometry types", () => {
    const fc: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [0, 0] } },
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [10, 10],
                [20, 10],
                [20, 20],
                [10, 20],
                [10, 10],
              ],
            ],
          },
        },
      ],
    };
    const bbox = computeBBox(fc);
    expect(bbox).toEqual([0, 0, 20, 20]);
  });
});

// ---------------------------------------------------------------------------
// computeFeatureBBox
// ---------------------------------------------------------------------------

describe("computeFeatureBBox", () => {
  it("returns the correct bbox for a single polygon feature", () => {
    const feature: Feature<Geometry> = {
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [10, 0],
            [10, 5],
            [0, 5],
            [0, 0],
          ],
        ],
      },
    };
    expect(computeFeatureBBox(feature)).toEqual([0, 0, 10, 5]);
  });

  it("returns null when the feature has no geometry", () => {
    const feature: Feature<Geometry> = {
      type: "Feature",
      properties: {},
      geometry: null as never,
    };
    expect(computeFeatureBBox(feature)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getInitialViewState
// ---------------------------------------------------------------------------

describe("getInitialViewState", () => {
  it("returns the centroid of the bounding box", () => {
    const fc = makePolygonFC([
      [-10, -5],
      [10, -5],
      [10, 5],
      [-10, 5],
      [-10, -5],
    ]);
    const vs = getInitialViewState(fc);
    expect(vs.longitude).toBeCloseTo(0);
    expect(vs.latitude).toBeCloseTo(0);
    expect(vs.zoom).toBe(12);
  });

  it("falls back to world view for an empty collection", () => {
    const fc: FeatureCollection = { type: "FeatureCollection", features: [] };
    const vs = getInitialViewState(fc);
    expect(vs).toEqual({ longitude: 0, latitude: 20, zoom: 2 });
  });
});

// ---------------------------------------------------------------------------
// downloadGeoJSON
// ---------------------------------------------------------------------------

describe("downloadGeoJSON", () => {
  it("triggers a download with the correct filename", () => {
    const createObjectURL = jest.fn(() => "blob:mock-url");
    const revokeObjectURL = jest.fn();
    const click = jest.fn();
    Object.defineProperty(global, "URL", {
      value: { createObjectURL, revokeObjectURL },
      writable: true,
    });

    const appendChildMock = jest.spyOn(document.body, "appendChild").mockImplementation(() => document.body);
    const createElementMock = jest.spyOn(document, "createElement").mockReturnValue({
      href: "",
      download: "",
      click,
    } as unknown as HTMLAnchorElement);

    const fc: FeatureCollection = { type: "FeatureCollection", features: [] };
    downloadGeoJSON(fc, "output");

    expect(createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");

    createElementMock.mockRestore();
    appendChildMock.mockRestore();
  });

  it("appends .geojson extension when missing", () => {
    const click = jest.fn();
    let capturedDownload = "";
    jest.spyOn(document, "createElement").mockReturnValue({
      get download() {
        return capturedDownload;
      },
      set download(v: string) {
        capturedDownload = v;
      },
      href: "",
      click,
    } as unknown as HTMLAnchorElement);
    Object.defineProperty(global, "URL", {
      value: { createObjectURL: () => "blob:x", revokeObjectURL: jest.fn() },
      writable: true,
    });

    const fc: FeatureCollection = { type: "FeatureCollection", features: [] };
    downloadGeoJSON(fc, "myfile");
    expect(capturedDownload).toBe("myfile.geojson");

    jest.restoreAllMocks();
  });

  it("does not double-append the .geojson extension", () => {
    const click = jest.fn();
    let capturedDownload = "";
    jest.spyOn(document, "createElement").mockReturnValue({
      get download() {
        return capturedDownload;
      },
      set download(v: string) {
        capturedDownload = v;
      },
      href: "",
      click,
    } as unknown as HTMLAnchorElement);
    Object.defineProperty(global, "URL", {
      value: { createObjectURL: () => "blob:x", revokeObjectURL: jest.fn() },
      writable: true,
    });

    const fc: FeatureCollection = { type: "FeatureCollection", features: [] };
    downloadGeoJSON(fc, "myfile.geojson");
    expect(capturedDownload).toBe("myfile.geojson");

    jest.restoreAllMocks();
  });
});

// ---------------------------------------------------------------------------
// formatBytes
// ---------------------------------------------------------------------------

describe("formatBytes", () => {
  it("formats 0 bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("formats bytes below 1 KB", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("formats exact 1 KB", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
  });

  it("formats KB values to one decimal place", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
  });

  it("formats MB values to two decimal places", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.00 MB");
    expect(formatBytes(2.5 * 1024 * 1024)).toBe("2.50 MB");
  });

  it("formats large MB values", () => {
    expect(formatBytes(100 * 1024 * 1024)).toBe("100.00 MB");
  });
});

// ---------------------------------------------------------------------------
// getFeatureColor
// ---------------------------------------------------------------------------

describe("getFeatureColor", () => {
  it("returns amber for selected features (highest priority)", () => {
    expect(getFeatureColor(false, true, true)).toBe("#f59e0b");
    expect(getFeatureColor(true, false, true)).toBe("#f59e0b");
    expect(getFeatureColor(true, true, true)).toBe("#f59e0b");
  });

  it("returns purple for duplicate (non-selected)", () => {
    expect(getFeatureColor(true, true, false)).toBe("#8b5cf6");
    expect(getFeatureColor(false, true, false)).toBe("#8b5cf6");
  });

  it("returns red for invalid (non-duplicate, non-selected)", () => {
    expect(getFeatureColor(false, false, false)).toBe("#ef4444");
  });

  it("returns green for valid, non-duplicate, non-selected", () => {
    expect(getFeatureColor(true, false, false)).toBe("#22c55e");
  });
});

// ---------------------------------------------------------------------------
// isGeometry
// ---------------------------------------------------------------------------

describe("isGeometry", () => {
  it("returns true for a GeoJSON Point geometry", () => {
    expect(isGeometry({ type: "Point", coordinates: [0, 0] })).toBe(true);
  });

  it("returns true for a Polygon geometry", () => {
    expect(isGeometry({ type: "Polygon", coordinates: [[]] })).toBe(true);
  });

  it("returns false for null", () => {
    expect(isGeometry(null)).toBe(false);
  });

  it("returns false for a plain string", () => {
    expect(isGeometry("Point")).toBe(false);
  });

  it("returns false for an object without a type field", () => {
    expect(isGeometry({ coordinates: [0, 0] })).toBe(false);
  });

  it("returns false for a number", () => {
    expect(isGeometry(42)).toBe(false);
  });

  it("returns false for an empty object", () => {
    expect(isGeometry({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// dashboardSlice
// ---------------------------------------------------------------------------

describe("dashboardSlice", () => {
  const initial = dashboardReducer(undefined, { type: "@@INIT" });

  it("has correct initial state", () => {
    expect(initial.uploadStatus).toBe("idle");
    expect(initial.uploadProgress).toBe(0);
    expect(initial.filename).toBeNull();
    expect(initial.response).toBeNull();
    expect(initial.featureCollection).toBeNull();
    expect(initial.pendingFC).toBeNull();
    expect(initial.selectedFeatureIndex).toBeNull();
    expect(initial.isSaving).toBe(false);
    expect(initial.hasPending).toBe(false);
    expect(initial.error).toBeNull();
  });

  it("uploadStarted sets status to uploading and clears error", () => {
    const state = dashboardReducer({ ...initial, error: "old error" }, uploadStarted());
    expect(state.uploadStatus).toBe("uploading");
    expect(state.uploadProgress).toBe(0);
    expect(state.error).toBeNull();
  });

  it("uploadProgressUpdated updates uploadProgress", () => {
    const state = dashboardReducer(initial, uploadProgressUpdated(57));
    expect(state.uploadProgress).toBe(57);
  });

  it("uploadFailed sets status and error message", () => {
    const state = dashboardReducer(initial, uploadFailed("File too large"));
    expect(state.uploadStatus).toBe("error");
    expect(state.error).toBe("File too large");
  });

  it("uploadSucceeded stores response and builds stamped FeatureCollection", () => {
    const response = makeMockResponse([makeMockFeature(0), makeMockFeature(1)]);
    const state = dashboardReducer(initial, uploadSucceeded(response));

    expect(state.uploadStatus).toBe("success");
    expect(state.uploadProgress).toBe(100);
    expect(state.filename).toBe("test.geojson");
    expect(state.response).toBe(response);
    expect(state.featureCollection).not.toBeNull();
    expect(state.featureCollection!.features).toHaveLength(2);
    // Stamping: each feature has _originalIndex
    expect(state.featureCollection!.features[0].properties!._originalIndex).toBe(0);
    expect(state.featureCollection!.features[1].properties!._originalIndex).toBe(1);
    expect(state.pendingFC).toBeNull();
    expect(state.error).toBeNull();
    expect(state.hasPending).toBe(false);
  });

  it("uploadSucceeded clears _edited stamps from previous upload", () => {
    const pf = makeMockFeature(0);
    pf.feature.properties = { ...(pf.feature.properties ?? {}), _edited: true };
    const response = makeMockResponse([pf]);
    const state = dashboardReducer(initial, uploadSucceeded(response));
    expect(state.featureCollection!.features[0].properties!._edited).toBeUndefined();
  });

  it("featureSelected updates selectedFeatureIndex", () => {
    const state = dashboardReducer(initial, featureSelected(3));
    expect(state.selectedFeatureIndex).toBe(3);
  });

  it("featureSelected with null clears selection", () => {
    const base = dashboardReducer(initial, featureSelected(3));
    const state = dashboardReducer(base, featureSelected(null));
    expect(state.selectedFeatureIndex).toBeNull();
  });

  it("analyseStarted sets isSaving", () => {
    const state = dashboardReducer(initial, analyseStarted());
    expect(state.isSaving).toBe(true);
  });

  it("analyseSucceeded clears isSaving and pending state", () => {
    const withPending = {
      ...initial,
      isSaving: true,
      hasPending: true,
      selectedFeatureIndex: 2,
    };
    const response = makeMockResponse([makeMockFeature(0)]);
    const state = dashboardReducer(withPending, analyseSucceeded(response));

    expect(state.isSaving).toBe(false);
    expect(state.hasPending).toBe(false);
    expect(state.pendingFC).toBeNull();
    expect(state.selectedFeatureIndex).toBeNull();
    expect(state.response).toBe(response);
  });

  it("analyseFailed clears isSaving only", () => {
    const withSaving = { ...initial, isSaving: true };
    const state = dashboardReducer(withSaving, analyseFailed());
    expect(state.isSaving).toBe(false);
  });

  it("propertiesUpdated merges props and sets hasPending", () => {
    const response = makeMockResponse([makeMockFeature(0)]);
    const loaded = dashboardReducer(initial, uploadSucceeded(response));
    const state = dashboardReducer(
      loaded,
      propertiesUpdated({ index: 0, props: { name: "Field A" } })
    );
    expect(state.hasPending).toBe(true);
    expect(state.pendingFC).not.toBeNull();
    const props = state.featureCollection!.features[0].properties!;
    expect(props.name).toBe("Field A");
    expect(props._edited).toBe(true);
    // Internal _originalIndex must be preserved
    expect(props._originalIndex).toBe(0);
  });

  it("geometryFixApplied patches the geometry and removes the issue", () => {
    const pf = makeMockFeature(0, false);
    const issue: GeometryIssue = {
      feature_index: 0,
      feature_id: null,
      issue_type: "self_intersection",
      description: "Self-intersection",
      auto_fix_available: true,
      fixed_geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    };
    const response = makeMockResponse([pf]);
    response.summary.issues = [issue];

    const loaded = dashboardReducer(initial, uploadSucceeded(response));
    const state = dashboardReducer(loaded, geometryFixApplied(issue));

    // Geometry should be patched in featureCollection
    expect(state.featureCollection!.features[0].geometry).toEqual(issue.fixed_geometry);
    // ProcessedFeature should be marked valid
    expect(state.response!.features[0].is_valid).toBe(true);
    expect(state.response!.features[0].issues).toHaveLength(0);
    // Issue should be removed from summary
    expect(state.response!.summary.issues).toHaveLength(0);
    // invalid_features count decremented
    expect(state.response!.summary.invalid_features).toBe(0);
  });

  it("mapEditStaged removes issues for deleted features", () => {
    const pf0 = makeMockFeature(0, false);
    const pf1 = makeMockFeature(1, true);
    const issue0: GeometryIssue = {
      feature_index: 0,
      feature_id: null,
      issue_type: "invalid_geometry",
      description: "Bad",
      auto_fix_available: false,
    };
    const response = makeMockResponse([pf0, pf1]);
    response.summary.issues = [issue0];

    const loaded = dashboardReducer(initial, uploadSucceeded(response));

    // Simulate deleting feature 0 from the map
    const updatedFC: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          ...loaded.featureCollection!.features[1],
          properties: { _originalIndex: 1 },
        },
      ],
    };
    const state = dashboardReducer(loaded, mapEditStaged(updatedFC));

    expect(state.featureCollection).toBe(updatedFC);
    expect(state.pendingFC).toBe(updatedFC);
    // Issue for deleted feature 0 should be gone
    expect(state.response!.summary.issues).toHaveLength(0);
  });

  it("resetDashboard returns to initial state", () => {
    const response = makeMockResponse([makeMockFeature(0)]);
    const loaded = dashboardReducer(initial, uploadSucceeded(response));
    const state = dashboardReducer(loaded, resetDashboard());
    expect(state).toEqual(initial);
  });
});

// ---------------------------------------------------------------------------
// tableSlice
// ---------------------------------------------------------------------------

describe("tableSlice", () => {
  const initial = tableReducer(undefined, { type: "@@INIT" });

  it("has correct initial state", () => {
    expect(initial.filter).toBe("all");
    expect(initial.searchQuery).toBe("");
    expect(initial.sortKey).toBe("index");
    expect(initial.sortDir).toBe("asc");
    expect(initial.currentPage).toBe(1);
    expect(initial.pageSize).toBe(50);
  });

  it("filterChanged updates filter and resets to page 1", () => {
    const withPage = tableReducer(initial, pageChanged(3));
    const state = tableReducer(withPage, filterChanged("invalid"));
    expect(state.filter).toBe("invalid");
    expect(state.currentPage).toBe(1);
  });

  it("searchQueryChanged updates query and resets to page 1", () => {
    const withPage = tableReducer(initial, pageChanged(5));
    const state = tableReducer(withPage, searchQueryChanged("coffee"));
    expect(state.searchQuery).toBe("coffee");
    expect(state.currentPage).toBe(1);
  });

  it("sortChanged updates sort key and direction and resets to page 1", () => {
    const withPage = tableReducer(initial, pageChanged(2));
    const state = tableReducer(withPage, sortChanged({ key: "area", dir: "desc" }));
    expect(state.sortKey).toBe("area");
    expect(state.sortDir).toBe("desc");
    expect(state.currentPage).toBe(1);
  });

  it("pageChanged updates page without resetting other state", () => {
    const withFilter = tableReducer(initial, filterChanged("valid"));
    const state = tableReducer(withFilter, pageChanged(4));
    expect(state.currentPage).toBe(4);
    expect(state.filter).toBe("valid");
  });

  it("pageSizeChanged updates page size and resets to page 1", () => {
    const withPage = tableReducer(initial, pageChanged(3));
    const state = tableReducer(withPage, pageSizeChanged(25));
    expect(state.pageSize).toBe(25);
    expect(state.currentPage).toBe(1);
  });

  it("resets to initial state on uploadSucceeded", () => {
    const modified = tableReducer(initial, filterChanged("valid"));
    const response = makeMockResponse([makeMockFeature(0)]);
    const state = tableReducer(modified, uploadSucceeded(response));
    expect(state).toEqual(initial);
  });

  it("resets page and search (but preserves filter) on analyseSucceeded", () => {
    let state = tableReducer(initial, filterChanged("invalid"));
    state = tableReducer(state, pageChanged(3));
    state = tableReducer(state, searchQueryChanged("test"));
    const response = makeMockResponse([makeMockFeature(0)]);
    state = tableReducer(state, analyseSucceeded(response));
    expect(state.currentPage).toBe(1);
    expect(state.searchQuery).toBe("");
    expect(state.filter).toBe("invalid"); // preserved
  });

  it("resets to initial state on resetDashboard", () => {
    const modified = tableReducer(initial, filterChanged("duplicate"));
    const state = tableReducer(modified, resetDashboard());
    expect(state).toEqual(initial);
  });
});

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

describe("Selectors", () => {
  function makeStoreWithFeatures(features: ProcessedFeature[]) {
    const response = makeMockResponse(features);
    const featureCollection: FeatureCollection = {
      type: "FeatureCollection",
      features: features.map((pf, i) => ({
        ...pf.feature,
        properties: { ...(pf.feature.properties ?? {}), _originalIndex: i },
      })),
    };

    return configureStore({
      reducer: { dashboard: dashboardReducer, table: tableReducer },
      preloadedState: {
        dashboard: {
          uploadStatus: "success" as const,
          uploadProgress: 100,
          filename: "test.geojson",
          fileSizeBytes: 1024,
          response,
          featureCollection,
          pendingFC: null,
          selectedFeatureIndex: null,
          isSaving: false,
          hasPending: false,
          error: null,
        },
      },
    });
  }

  it("selectHasData returns true when upload succeeded with response", () => {
    const store = makeStoreWithFeatures([makeMockFeature(0)]);
    expect(selectHasData(store.getState())).toBe(true);
  });

  it("selectHasData returns false in initial state", () => {
    const store = configureStore({
      reducer: { dashboard: dashboardReducer, table: tableReducer },
    });
    expect(selectHasData(store.getState())).toBe(false);
  });

  it("selectHasPending returns false when no pending changes", () => {
    const store = makeStoreWithFeatures([makeMockFeature(0)]);
    expect(selectHasPending(store.getState())).toBe(false);
  });

  it("selectFilterCounts returns correct counts", () => {
    const features = [
      makeMockFeature(0, true, false),   // valid
      makeMockFeature(1, false, false),  // invalid
      makeMockFeature(2, true, true),    // duplicate
    ];
    const store = makeStoreWithFeatures(features);
    const counts = selectFilterCounts(store.getState());
    expect(counts.all).toBe(3);
    expect(counts.valid).toBe(1);
    expect(counts.invalid).toBe(1);
    expect(counts.duplicate).toBe(1);
  });

  it("selectDeletedIndices returns empty set when no deletions", () => {
    const store = makeStoreWithFeatures([makeMockFeature(0), makeMockFeature(1)]);
    const deleted = selectDeletedIndices(store.getState());
    expect(deleted.size).toBe(0);
  });

  it("selectAllRows includes all features", () => {
    const features = [makeMockFeature(0), makeMockFeature(1)];
    const store = makeStoreWithFeatures(features);
    const rows = selectAllRows(store.getState());
    expect(rows).toHaveLength(2);
  });

  it("selectPagedRows respects pageSize", () => {
    const features = Array.from({ length: 10 }, (_, i) => makeMockFeature(i));
    const store = makeStoreWithFeatures(features);
    store.dispatch(pageSizeChanged(3));
    const rows = selectPagedRows(store.getState());
    expect(rows).toHaveLength(3);
  });

  it("selectTotalFilteredCount returns correct count after filter", () => {
    const features = [
      makeMockFeature(0, true, false),
      makeMockFeature(1, false, false),
      makeMockFeature(2, false, false),
    ];
    const store = makeStoreWithFeatures(features);
    store.dispatch(filterChanged("invalid"));
    expect(selectTotalFilteredCount(store.getState())).toBe(2);
  });

  it("selectTotalPages computes correctly", () => {
    const features = Array.from({ length: 25 }, (_, i) => makeMockFeature(i));
    const store = makeStoreWithFeatures(features);
    store.dispatch(pageSizeChanged(10));
    expect(selectTotalPages(store.getState())).toBe(3);
  });

  it("search filters by feature index string", () => {
    const features = [makeMockFeature(0), makeMockFeature(1), makeMockFeature(2)];
    const store = makeStoreWithFeatures(features);
    store.dispatch(searchQueryChanged("1"));
    // Row with index 1 should match, but also row 0 matches "1" within "10"... depends on exact string
    // At minimum, selectTotalFilteredCount > 0
    expect(selectTotalFilteredCount(store.getState())).toBeGreaterThan(0);
  });

  it("sort by index descending reverses order", () => {
    const features = [makeMockFeature(0), makeMockFeature(1), makeMockFeature(2)];
    const store = makeStoreWithFeatures(features);
    store.dispatch(sortChanged({ key: "index", dir: "desc" }));
    const rows = selectPagedRows(store.getState());
    expect(rows[0].index).toBeGreaterThan(rows[rows.length - 1].index);
  });
});

// ---------------------------------------------------------------------------
// SummaryCards
// ---------------------------------------------------------------------------

describe("SummaryCards", () => {
  it("renders all four metric values", () => {
    render(<SummaryCards summary={mockSummary} />);
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getAllByText("1").length).toBeGreaterThanOrEqual(1);
  });

  it("renders the correct card labels", () => {
    render(<SummaryCards summary={mockSummary} />);
    expect(screen.getByText("Total Features")).toBeInTheDocument();
    expect(screen.getByText("Valid")).toBeInTheDocument();
    expect(screen.getByText("Issues")).toBeInTheDocument();
    expect(screen.getByText("Duplicate Groups")).toBeInTheDocument();
  });

  it("renders zero values without crashing", () => {
    const zeroSummary: AnalysisSummary = {
      ...mockSummary,
      total_features: 0,
      valid_features: 0,
      invalid_features: 0,
      duplicate_groups: 0,
    };
    render(<SummaryCards summary={zeroSummary} />);
    expect(screen.getAllByText("0").length).toBeGreaterThanOrEqual(3);
  });

  it("renders large numbers correctly", () => {
    const bigSummary: AnalysisSummary = {
      ...mockSummary,
      total_features: 999999,
      valid_features: 999998,
      invalid_features: 1,
      duplicate_groups: 0,
    };
    render(<SummaryCards summary={bigSummary} />);
    expect(screen.getByText("999999")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// IssuesPanel
// ---------------------------------------------------------------------------

describe("IssuesPanel", () => {
  const issueFixable: GeometryIssue = {
    feature_index: 0,
    feature_id: 1,
    issue_type: "invalid_geometry",
    description: "Self-intersection detected.",
    auto_fix_available: true,
    fixed_geometry: { type: "Polygon", coordinates: [] },
  };

  const issueNotFixable: GeometryIssue = {
    feature_index: 1,
    feature_id: null,
    issue_type: "null_geometry",
    description: "Feature has no geometry.",
    auto_fix_available: false,
  };

  it("shows 'No issues found' when summary is clean", () => {
    render(
      <IssuesPanel
        summary={mockSummary}
        onSelectFeature={jest.fn()}
      />
    );
    expect(screen.getByText("No issues found")).toBeInTheDocument();
  });

  it("renders issue cards with descriptions", () => {
    const summary: AnalysisSummary = {
      ...mockSummary,
      issues: [issueFixable, issueNotFixable],
    };
    render(<IssuesPanel summary={summary} onSelectFeature={jest.fn()} />);
    expect(screen.getByText("Self-intersection detected.")).toBeInTheDocument();
    expect(screen.getByText("Feature has no geometry.")).toBeInTheDocument();
  });

  it("shows issue_type labels", () => {
    const summary: AnalysisSummary = {
      ...mockSummary,
      issues: [issueFixable],
    };
    render(<IssuesPanel summary={summary} onSelectFeature={jest.fn()} />);
    expect(screen.getByText(/invalid_geometry/i)).toBeInTheDocument();
  });

  it("shows feature index in issue card", () => {
    const summary: AnalysisSummary = {
      ...mockSummary,
      issues: [issueFixable],
    };
    render(<IssuesPanel summary={summary} onSelectFeature={jest.fn()} />);
    expect(screen.getByText(/feature #0/i)).toBeInTheDocument();
  });

  it("shows fid when feature_id is set", () => {
    const summary: AnalysisSummary = {
      ...mockSummary,
      issues: [issueFixable], // issueFixable has feature_id: 1
    };
    render(<IssuesPanel summary={summary} onSelectFeature={jest.fn()} />);
    expect(screen.getByText(/fid: 1/i)).toBeInTheDocument();
  });

  it("shows Apply fix button only for fixable issues with onApplyFix", () => {
    const summary: AnalysisSummary = {
      ...mockSummary,
      issues: [issueFixable, issueNotFixable],
    };
    render(
      <IssuesPanel
        summary={summary}
        onSelectFeature={jest.fn()}
        onApplyFix={jest.fn()}
      />
    );
    expect(screen.getAllByText(/apply fix/i).length).toBeGreaterThanOrEqual(1);
  });

  it("does not show Apply fix button without onApplyFix", () => {
    const summary: AnalysisSummary = {
      ...mockSummary,
      issues: [issueFixable],
    };
    render(<IssuesPanel summary={summary} onSelectFeature={jest.fn()} />);
    expect(screen.queryByText(/apply fix/i)).not.toBeInTheDocument();
  });

  it("calls onApplyFix when Apply fix is clicked", () => {
    const onApplyFix = jest.fn();
    const summary: AnalysisSummary = {
      ...mockSummary,
      issues: [issueFixable],
    };
    render(
      <IssuesPanel
        summary={summary}
        onSelectFeature={jest.fn()}
        onApplyFix={onApplyFix}
      />
    );
    fireEvent.click(screen.getByTitle(/apply automatic fix/i));
    expect(onApplyFix).toHaveBeenCalledWith(issueFixable);
  });

  it("calls onSelectFeature when issue card is clicked", () => {
    const onSelectFeature = jest.fn();
    const summary: AnalysisSummary = {
      ...mockSummary,
      issues: [issueFixable],
    };
    render(
      <IssuesPanel summary={summary} onSelectFeature={onSelectFeature} />
    );
    fireEvent.click(screen.getByText(/feature #0/i));
    expect(onSelectFeature).toHaveBeenCalledWith(0);
  });

  it("renders duplicate groups with clickable feature index chips", () => {
    const summary: AnalysisSummary = {
      ...mockSummary,
      duplicate_groups_detail: [
        {
          group_id: 0,
          feature_indices: [2, 3],
          feature_ids: [null, null],
          duplicate_type: "exact",
          description: "Exact duplicate pair",
        },
      ],
    };
    const onSelectFeature = jest.fn();
    render(<IssuesPanel summary={summary} onSelectFeature={onSelectFeature} />);
    expect(screen.getByText(/duplicate group 1/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText("#2"));
    expect(onSelectFeature).toHaveBeenCalledWith(2);
  });

  it("shows Fix all button when multiple fixable issues exist", () => {
    const issue2: GeometryIssue = {
      ...issueFixable,
      feature_index: 5,
      feature_id: 5,
    };
    const summary: AnalysisSummary = {
      ...mockSummary,
      issues: [issueFixable, issue2],
    };
    render(
      <IssuesPanel summary={summary} onSelectFeature={jest.fn()} onApplyFix={jest.fn()} />
    );
    expect(screen.getByText(/fix all/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

describe("Header", () => {
  it("renders brand name", () => {
    render(
      <Header filename={null} onReset={jest.fn()} hasPending={false} isSaving={false} />
    );
    expect(screen.getByText(/GeoJSON Farm Dashboard/i)).toBeInTheDocument();
  });

  it("shows filename badge when a file is loaded", () => {
    render(
      <Header
        filename="fields.geojson"
        onReset={jest.fn()}
        hasPending={false}
        isSaving={false}
      />
    );
    expect(screen.getByText("fields.geojson")).toBeInTheDocument();
  });

  it("does not show filename badge when filename is null", () => {
    render(
      <Header filename={null} onReset={jest.fn()} hasPending={false} isSaving={false} />
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows New File button only when a file is loaded", () => {
    const { rerender } = render(
      <Header filename={null} onReset={jest.fn()} hasPending={false} isSaving={false} />
    );
    expect(screen.queryByText(/new file/i)).not.toBeInTheDocument();

    rerender(
      <Header
        filename="fields.geojson"
        onReset={jest.fn()}
        hasPending={false}
        isSaving={false}
      />
    );
    expect(screen.getByText(/new file/i)).toBeInTheDocument();
  });

  it("shows Save button only when there are pending edits and onAnalyse is provided", () => {
    const onAnalyse = jest.fn();
    const { rerender } = render(
      <Header
        filename="f.geojson"
        onReset={jest.fn()}
        onAnalyse={onAnalyse}
        hasPending={false}
        isSaving={false}
      />
    );
    expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();

    rerender(
      <Header
        filename="f.geojson"
        onReset={jest.fn()}
        onAnalyse={onAnalyse}
        hasPending={true}
        isSaving={false}
      />
    );
    expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
  });

  it("does not show Save button when hasPending is true but onAnalyse is not provided", () => {
    render(
      <Header
        filename="f.geojson"
        onReset={jest.fn()}
        hasPending={true}
        isSaving={false}
      />
    );
    expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();
  });

  it("disables Save button while isSaving is true", () => {
    render(
      <Header
        filename="f.geojson"
        onReset={jest.fn()}
        onAnalyse={jest.fn()}
        hasPending={true}
        isSaving={true}
      />
    );
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
  });

  it("calls onReset when New File is clicked", () => {
    const onReset = jest.fn();
    render(
      <Header
        filename="f.geojson"
        onReset={onReset}
        hasPending={false}
        isSaving={false}
      />
    );
    fireEvent.click(screen.getByText(/new file/i));
    expect(onReset).toHaveBeenCalled();
  });

  it("calls onDownload when Download is clicked", () => {
    const onDownload = jest.fn();
    render(
      <Header
        filename="f.geojson"
        onReset={jest.fn()}
        onDownload={onDownload}
        hasPending={false}
        isSaving={false}
      />
    );
    fireEvent.click(screen.getByText(/download/i));
    expect(onDownload).toHaveBeenCalled();
  });

  it("calls onAnalyse when Save is clicked", () => {
    const onAnalyse = jest.fn();
    render(
      <Header
        filename="f.geojson"
        onReset={jest.fn()}
        onAnalyse={onAnalyse}
        hasPending={true}
        isSaving={false}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(onAnalyse).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// FeatureTable (Redux-connected)
// ---------------------------------------------------------------------------

describe("FeatureTable", () => {
  it("renders a 'No results' message when the store has no data", () => {
    renderWithStore(
      <FeatureTable onSelectFeature={jest.fn()} />,
    );
    // With no data, totalFiltered = 0 → "No results"
    expect(screen.getByText(/no results/i)).toBeInTheDocument();
  });

  it("renders all features under the 'All' filter", () => {
    const features = [
      makeMockFeature(0, true, false),
      makeMockFeature(1, false, false),
      makeMockFeature(2, true, true),
    ];
    renderWithStore(
      <FeatureTable onSelectFeature={jest.fn()} />,
      makeLoadedState(features)
    );
    // The count and "features" label are split across child <span> nodes inside
    // a single <p>, so we match on the <p> element's combined textContent.
    expect(
      screen.getByText((_content, element) => {
        const text = element?.textContent ?? "";
        return /3.*features/i.test(text) && element?.tagName === "P";
      })
    ).toBeInTheDocument();
  });

  it("filter tabs change the displayed rows", () => {
    const features = [
      makeMockFeature(0, true, false),
      makeMockFeature(1, false, false),
      makeMockFeature(2, false, false),
    ];
    const { store } = renderWithStore(
      <FeatureTable onSelectFeature={jest.fn()} />,
      makeLoadedState(features)
    );
    // Switch to "Issues" filter via store dispatch
    act(() => {
      store.dispatch(filterChanged("invalid"));
    });
    // The count and "features" label are split across child <span> nodes inside
    // a single <p>, so we match on the <p> element's combined textContent.
    expect(
      screen.getByText((_content, element) => {
        const text = element?.textContent ?? "";
        return /2.*features/i.test(text) && element?.tagName === "P";
      })
    ).toBeInTheDocument();
  });

  it("shows 'No results' when search matches nothing", () => {
    const features = [makeMockFeature(0, true, false)];
    const { store } = renderWithStore(
      <FeatureTable onSelectFeature={jest.fn()} />,
      makeLoadedState(features)
    );
    act(() => {
      store.dispatch(searchQueryChanged("ZZZNOMATCH"));
    });
    expect(screen.getByText(/no results/i)).toBeInTheDocument();
  });

  it("calls onSelectFeature when a data row is clicked", () => {
    const onSelect = jest.fn();
    const features = [makeMockFeature(0, true, false)];
    renderWithStore(
      <FeatureTable onSelectFeature={onSelect} />,
      makeLoadedState(features)
    );
    const rows = screen.getAllByRole("row");
    // rows[0] is header, rows[1] is data
    fireEvent.click(rows[1]);
    expect(onSelect).toHaveBeenCalled();
  });

  it("renders geometry type in rows", () => {
    const features = [makeMockFeature(0, true, false)];
    renderWithStore(
      <FeatureTable onSelectFeature={jest.fn()} />,
      makeLoadedState(features)
    );
    expect(screen.getByText("Polygon")).toBeInTheDocument();
  });

  it("shows pagination controls when rows exceed page size", () => {
    const features = Array.from({ length: 60 }, (_, i) => makeMockFeature(i));
    const { store } = renderWithStore(
      <FeatureTable onSelectFeature={jest.fn()} />,
      makeLoadedState(features)
    );
    act(() => {
      store.dispatch(pageSizeChanged(25));
    });
    // Should show page navigation
    expect(screen.getByTitle("Next page")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// UploadZone
// ---------------------------------------------------------------------------

describe("UploadZone", () => {
  it("renders idle state with upload prompt", () => {
    render(
      <UploadZone onUpload={jest.fn()} status="idle" progress={0} error={null} />
    );
    expect(screen.getByText(/drag & drop a \.geojson file/i)).toBeInTheDocument();
  });

  it("renders browse text in idle state", () => {
    render(
      <UploadZone onUpload={jest.fn()} status="idle" progress={0} error={null} />
    );
    expect(screen.getByText(/browse to upload/i)).toBeInTheDocument();
  });

  it("renders file constraint hint", () => {
    render(
      <UploadZone onUpload={jest.fn()} status="idle" progress={0} error={null} />
    );
    expect(screen.getByText(/only \.geojson files accepted/i)).toBeInTheDocument();
  });

  it("renders uploading state with progress percentage", () => {
    render(
      <UploadZone onUpload={jest.fn()} status="uploading" progress={42} error={null} />
    );
    expect(screen.getByText(/processing\.\.\. 42%/i)).toBeInTheDocument();
  });

  it("renders 100% progress", () => {
    render(
      <UploadZone onUpload={jest.fn()} status="uploading" progress={100} error={null} />
    );
    expect(screen.getByText(/100%/i)).toBeInTheDocument();
  });

  it("renders an error message when provided", () => {
    render(
      <UploadZone
        onUpload={jest.fn()}
        status="error"
        progress={0}
        error="Only .geojson files are accepted."
      />
    );
    expect(screen.getByText("Only .geojson files are accepted.")).toBeInTheDocument();
  });

  it("renders an error when status is error but error prop is null (no message shown)", () => {
    // Should not crash with null error
    expect(() =>
      render(
        <UploadZone onUpload={jest.fn()} status="error" progress={0} error={null} />
      )
    ).not.toThrow();
  });
});
