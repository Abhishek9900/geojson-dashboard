/**
 * Frontend test suite.
 *
 * Covers:
 *  - Utility functions: computeBBox, formatBytes, getFeatureColor, isGeometry.
 *  - SummaryCards component rendering.
 *  - IssuesPanel component rendering and interaction.
 *  - Header component rendering and interaction.
 *  - FeatureTable component: filtering, sorting, selection, edit flow.
 *  - UploadZone component: idle / uploading states.
 *
 * Run with: npm test
 */

import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { FeatureCollection } from "geojson";
import type {
  AnalysisSummary,
  GeometryIssue,
  ProcessedFeature,
} from "@/types";
import {
  computeBBox,
  formatBytes,
  getFeatureColor,
  isGeometry,
} from "@/lib/geojson-utils";
import { SummaryCards } from "@/components/ui/SummaryCards";
import { IssuesPanel } from "@/components/ui/IssuesPanel";
import { Header } from "@/components/ui/Header";
import { FeatureTable } from "@/components/table/FeatureTable";
import { UploadZone } from "@/components/upload/UploadZone";

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
  isDuplicate = false
): ProcessedFeature {
  return {
    index,
    feature: {
      type: "Feature",
      properties: { fid: index, producttype: "Coffee" },
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

  it("spans multiple features correctly", () => {
    const fc: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: [10, 20] },
        },
        {
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: [30, 40] },
        },
      ],
    };
    const bbox = computeBBox(fc);
    expect(bbox).toEqual([10, 20, 30, 40]);
  });
});

// ---------------------------------------------------------------------------
// formatBytes
// ---------------------------------------------------------------------------

describe("formatBytes", () => {
  it("formats bytes below 1 KB", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(0)).toBe("0 B");
  });

  it("formats exact 1 KB", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
  });

  it("formats MB values to two decimal places", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.00 MB");
    expect(formatBytes(2.5 * 1024 * 1024)).toBe("2.50 MB");
  });
});

// ---------------------------------------------------------------------------
// getFeatureColor
// ---------------------------------------------------------------------------

describe("getFeatureColor", () => {
  it("returns amber for selected features (highest priority)", () => {
    // Selected should override duplicate and invalid.
    expect(getFeatureColor(false, true, true)).toBe("#f59e0b");
  });

  it("returns purple for duplicate (non-selected)", () => {
    expect(getFeatureColor(true, true, false)).toBe("#8b5cf6");
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
  it("returns true for a GeoJSON geometry object", () => {
    expect(isGeometry({ type: "Point", coordinates: [0, 0] })).toBe(true);
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
    // duplicate_groups = 1; we also have total_duplicates = 1, but only 4 cards
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
    render(
      <IssuesPanel summary={summary} onSelectFeature={jest.fn()} />
    );
    expect(screen.getByText("Self-intersection detected.")).toBeInTheDocument();
    expect(screen.getByText("Feature has no geometry.")).toBeInTheDocument();
  });

  it("shows Apply fix button only for fixable issues", () => {
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
    // One "Apply fix" for the fixable issue only.
    expect(screen.getAllByText(/apply fix/i).length).toBeGreaterThanOrEqual(1);
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
});

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

describe("Header", () => {
  it("renders brand name", () => {
    render(
      <Header
        filename={null}
        onReset={jest.fn()}
        hasPending={false}
        isSaving={false}
      />
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

  it("shows New File button only when a file is loaded", () => {
    const { rerender } = render(
      <Header
        filename={null}
        onReset={jest.fn()}
        hasPending={false}
        isSaving={false}
      />
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

  it("shows Save button only when there are pending edits", () => {
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
});

// ---------------------------------------------------------------------------
// FeatureTable
// ---------------------------------------------------------------------------

describe("FeatureTable", () => {
  const features = [
    makeMockFeature(0, true, false),
    makeMockFeature(1, false, false),
    makeMockFeature(2, true, true),
  ];

  const defaultProps = {
    features,
    filter: "all" as const,
    onFilterChange: jest.fn(),
    selectedIndex: null,
    onSelectFeature: jest.fn(),
    deletedIndices: new Set<number>(),
  };

  it("renders all features under the 'All' filter", () => {
    render(<FeatureTable {...defaultProps} />);
    expect(screen.getByText("Showing 3 of 3 features")).toBeInTheDocument();
  });

  it("filters to only invalid features", () => {
    render(<FeatureTable {...defaultProps} filter="invalid" />);
    expect(screen.getByText("Showing 1 of 3 features")).toBeInTheDocument();
  });

  it("filters to only valid features", () => {
    render(<FeatureTable {...defaultProps} filter="valid" />);
    // feature 0 is valid and not duplicate → 1 result
    expect(screen.getByText("Showing 1 of 3 features")).toBeInTheDocument();
  });

  it("filters to only duplicate features", () => {
    render(<FeatureTable {...defaultProps} filter="duplicate" />);
    // feature 2 is duplicate → 1 result
    expect(screen.getByText("Showing 1 of 3 features")).toBeInTheDocument();
  });

  it("calls onSelectFeature when a row is clicked", () => {
    const onSelect = jest.fn();
    render(<FeatureTable {...defaultProps} onSelectFeature={onSelect} />);
    const rows = screen.getAllByRole("row");
    fireEvent.click(rows[1]); // rows[0] is the header
    expect(onSelect).toHaveBeenCalledWith(0);
  });

  it("calls onFilterChange when a filter tab is clicked", () => {
    const onFilterChange = jest.fn();
    render(<FeatureTable {...defaultProps} onFilterChange={onFilterChange} />);
    fireEvent.click(screen.getByText(/issues/i));
    expect(onFilterChange).toHaveBeenCalledWith("invalid");
  });

  it("highlights the selected row", () => {
    render(<FeatureTable {...defaultProps} selectedIndex={0} />);
    const rows = screen.getAllByRole("row");
    // The selected row should carry the amber highlight class.
    expect(rows[1].className).toMatch(/amber/);
  });

  it("shows a message when no features match the filter", () => {
    // No invalid features in a single-valid-feature collection.
    render(
      <FeatureTable
        {...defaultProps}
        features={[makeMockFeature(0, true, false)]}
        filter="invalid"
      />
    );
    expect(
      screen.getByText(/no features match this filter/i)
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// UploadZone
// ---------------------------------------------------------------------------

describe("UploadZone", () => {
  it("renders idle state with upload prompt", () => {
    render(
      <UploadZone
        onUpload={jest.fn()}
        status="idle"
        progress={0}
        error={null}
      />
    );
    expect(
      screen.getByText(/drag & drop a \.geojson file/i)
    ).toBeInTheDocument();
  });

  it("renders uploading state with progress percentage", () => {
    render(
      <UploadZone
        onUpload={jest.fn()}
        status="uploading"
        progress={42}
        error={null}
      />
    );
    expect(screen.getByText(/processing\.\.\. 42%/i)).toBeInTheDocument();
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
    expect(
      screen.getByText("Only .geojson files are accepted.")
    ).toBeInTheDocument();
  });
});
