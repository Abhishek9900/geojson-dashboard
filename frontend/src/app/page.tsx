"use client";

/**
 * Main Dashboard Page.
 *
 * Orchestrates file upload, map visualisation, data table, and editing.
 * State is kept at this level so all child panels stay in sync; prop-drilling
 * is intentional here — the component tree is shallow enough that a context
 * would add complexity without benefit.
 */

import { useState, useCallback } from "react";
import toast from "react-hot-toast";
import type { FeatureCollection, Geometry } from "geojson";

import { uploadGeoJSON, updateGeoJSON } from "@/lib/api";
import { downloadGeoJSON } from "@/lib/geojson-utils";
import type {
  DashboardState,
  FeatureFilter,
  ProcessGeoJSONResponse,
  GeometryIssue,
} from "@/types";

import { UploadZone } from "@/components/upload/UploadZone";
import { SummaryCards } from "@/components/ui/SummaryCards";
import { FeatureTable } from "@/components/table/FeatureTable";
import { MapView } from "@/components/map/MapView";
import { IssuesPanel } from "@/components/ui/IssuesPanel";
import { Header } from "@/components/ui/Header";

const initialState: DashboardState = {
  uploadStatus: "idle",
  filename: null,
  response: null,
  featureCollection: null,
  selectedFeatureIndex: null,
  error: null,
};

export default function DashboardPage() {
  const [state, setState] = useState<DashboardState>(initialState);
  const [filter, setFilter] = useState<FeatureFilter>("all");
  const [uploadProgress, setUploadProgress] = useState(0);
  /** Edited FeatureCollection that has not yet been re-analysed by the backend. */
  const [pendingFC, setPendingFC] = useState<FeatureCollection | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // -------------------------------------------------------------------------
  // Upload handler
  // -------------------------------------------------------------------------

  const handleUpload = useCallback(async (file: File) => {
    setState((s) => ({ ...s, uploadStatus: "uploading", error: null }));
    setUploadProgress(0);

    try {
      const result: ProcessGeoJSONResponse = await uploadGeoJSON(
        file,
        setUploadProgress
      );

      // Stamp each feature with its original index so later edits
      // (deletions, property changes) can be traced back to the analysis result.
      const fc: FeatureCollection = {
        type: "FeatureCollection",
        features: result.features.map((pf, i) => ({
          ...pf.feature,
          properties: { ...(pf.feature.properties ?? {}), _originalIndex: i },
        })),
      };

      setState({
        uploadStatus: "success",
        filename: result.filename,
        response: result,
        featureCollection: fc,
        selectedFeatureIndex: null,
        error: null,
      });
      setPendingFC(null);

      const { summary } = result;
      toast.success(
        `Loaded ${summary.total_features} features — ` +
          `${summary.invalid_features} issues, ` +
          `${summary.duplicate_groups} duplicate groups`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      setState((s) => ({ ...s, uploadStatus: "error", error: message }));
      toast.error(message);
    }
  }, []);

  // -------------------------------------------------------------------------
  // Map edit → stage changes without re-analysing
  // -------------------------------------------------------------------------

  /**
   * Called when the user clicks Save inside the map edit toolbar.
   * Stages the edited FC locally and patches the panels optimistically
   * (removes issues / duplicate groups for deleted features).
   * The full re-analysis only happens when the user clicks Save in the Header.
   */
  const handleMapSave = useCallback((updatedFC: FeatureCollection) => {
    setPendingFC(updatedFC);

    setState((s) => {
      if (!s.response) return { ...s, featureCollection: updatedFC };

      // Indices that still exist in the updated FC.
      const presentOriginalIndices = new Set(
        updatedFC.features
          .map((f) => f.properties?._originalIndex)
          .filter((v) => v != null)
      );

      // Remove issues whose feature was deleted.
      const remainingIssues = s.response.summary.issues.filter((issue) =>
        presentOriginalIndices.has(issue.feature_index)
      );

      // Drop duplicate groups where every member was deleted; strip
      // deleted members from partially-deleted groups.
      const remainingDuplicateGroups = s.response.summary.duplicate_groups_detail
        .map((group) => ({
          ...group,
          feature_indices: group.feature_indices.filter((i) =>
            presentOriginalIndices.has(i)
          ),
        }))
        .filter((group) => group.feature_indices.length > 1);

      // Mark deleted features in the processed list so FeatureTable can show them.
      const patchedFeatures = s.response.features.map((pf) =>
        !presentOriginalIndices.has(pf.index) ? { ...pf, _deleted: true } : pf
      );

      return {
        ...s,
        featureCollection: updatedFC,
        response: {
          ...s.response,
          features: patchedFeatures,
          summary: {
            ...s.response.summary,
            issues: remainingIssues,
            invalid_features: remainingIssues.length,
            duplicate_groups: remainingDuplicateGroups.length,
            duplicate_groups_detail: remainingDuplicateGroups,
          },
        },
      };
    });

    toast.success("Edits staged — click Save to run analysis again.", {
      duration: 4000,
    });
  }, []);

  // -------------------------------------------------------------------------
  // Apply auto-fix from IssuesPanel
  // -------------------------------------------------------------------------

  /**
   * Patch the feature at ``issue.feature_index`` with the backend-computed
   * repaired geometry, then stage the result for re-analysis.
   */
  const handleApplyFix = useCallback(
    (issue: GeometryIssue) => {
      if (!issue.fixed_geometry || !state.featureCollection) return;

      const fc = state.featureCollection;
      const originalIdx = issue.feature_index;

      // Locate the feature by its _originalIndex stamp, not array position
      // (the array may have been reordered by edits).
      const liveIdx = fc.features.findIndex(
        (f) => f.properties?._originalIndex === originalIdx
      );
      if (liveIdx === -1) return; // feature was deleted

      const updatedFC: FeatureCollection = {
        ...fc,
        features: fc.features.map((f, i) =>
          i === liveIdx
            ? { ...f, geometry: issue.fixed_geometry as unknown as Geometry }
            : f
        ),
      };

      setPendingFC(updatedFC);
      setState((s) => {
        if (!s.response) return { ...s, featureCollection: updatedFC };

        const patchedFeatures = s.response.features.map((pf) =>
          pf.index === originalIdx ? { ...pf, is_valid: true, issues: [] } : pf
        );
        const remainingIssues = s.response.summary.issues.filter(
          (i) => i.feature_index !== originalIdx
        );

        return {
          ...s,
          featureCollection: updatedFC,
          response: {
            ...s.response,
            features: patchedFeatures,
            summary: {
              ...s.response.summary,
              issues: remainingIssues,
              invalid_features: Math.max(
                0,
                s.response.summary.invalid_features - 1
              ),
            },
          },
        };
      });

      toast.success(
        `Fix applied to feature #${originalIdx} — save & analyse to confirm.`,
        { icon: "🔧" }
      );
    },
    [state.featureCollection]
  );

  // -------------------------------------------------------------------------
  // Inline property update from FeatureTable
  // -------------------------------------------------------------------------

  const handleUpdateProperties = useCallback(
    (index: number, props: Record<string, string>) => {
      setState((s) => {
        if (!s.featureCollection) return s;

        const updatedFC: FeatureCollection = {
          ...s.featureCollection,
          features: s.featureCollection.features.map((f, i) =>
            i === index ? { ...f, properties: { ...props } } : f
          ),
        };

        setPendingFC(updatedFC);
        return { ...s, featureCollection: updatedFC };
      });
    },
    []
  );

  // -------------------------------------------------------------------------
  // Save & Analyse — post current FC to backend for full re-analysis
  // -------------------------------------------------------------------------

  const handleAnalyse = useCallback(async () => {
    const fc = pendingFC ?? state.featureCollection;
    if (!fc) return;

    setIsSaving(true);
    try {
      const result = await updateGeoJSON(fc);

      const freshFC: FeatureCollection = {
        type: "FeatureCollection",
        features: result.features.map((pf, i) => ({
          ...pf.feature,
          properties: { ...(pf.feature.properties ?? {}), _originalIndex: i },
        })),
      };

      setState((s) => ({
        ...s,
        response: result,
        featureCollection: freshFC,
        selectedFeatureIndex: null,
      }));
      setPendingFC(null);

      const { summary } = result;
      toast.success(
        `Analysis complete — ${summary.total_features} features, ` +
          `${summary.invalid_features} issues, ` +
          `${summary.duplicate_groups} duplicate groups`
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setIsSaving(false);
    }
  }, [pendingFC, state.featureCollection]);

  // -------------------------------------------------------------------------
  // Download
  // -------------------------------------------------------------------------

  const handleDownload = useCallback(() => {
    const fc = pendingFC ?? state.featureCollection;
    if (fc && state.filename) {
      downloadGeoJSON(fc, state.filename);
      toast.success("File downloaded.");
    }
  }, [pendingFC, state.featureCollection, state.filename]);

  // -------------------------------------------------------------------------
  // Reset — return to the upload screen
  // -------------------------------------------------------------------------

  const handleReset = useCallback(() => {
    setState(initialState);
    setPendingFC(null);
    setFilter("all");
    setUploadProgress(0);
  }, []);

  // -------------------------------------------------------------------------
  // Feature selection — index of -1 means deselect
  // -------------------------------------------------------------------------

  const handleSelectFeature = useCallback((idx: number) => {
    setState((s) => ({
      ...s,
      selectedFeatureIndex: idx < 0 ? null : idx,
    }));
  }, []);

  // -------------------------------------------------------------------------
  // Derived values
  // -------------------------------------------------------------------------

  const hasData = state.uploadStatus === "success" && state.response !== null;
  const hasPending = pendingFC !== null;

  // Compute the set of original indices that have been deleted since upload.
  const presentOriginalIndices = new Set(
    state.featureCollection?.features
      .map((f) => f.properties?._originalIndex)
      .filter((v) => v != null)
  );
  const deletedIndices = new Set(
    state.response?.features
      .map((_, i) => i)
      .filter((i) => !presentOriginalIndices.has(i))
  );

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="min-h-screen flex flex-col">
      <Header
        filename={state.filename}
        onReset={handleReset}
        onDownload={hasData ? handleDownload : undefined}
        onAnalyse={hasData ? handleAnalyse : undefined}
        hasPending={hasPending}
        isSaving={isSaving}
      />

      <main className="flex-1 p-4 md:p-6 space-y-6 max-w-[1600px] mx-auto w-full">
        {/* Upload zone — shown until data is loaded */}
        {!hasData && (
          <UploadZone
            onUpload={handleUpload}
            status={state.uploadStatus}
            progress={uploadProgress}
            error={state.error}
          />
        )}

        {/* Dashboard panels — shown after a successful upload */}
        {hasData && state.response && state.featureCollection && (
          <>
            <SummaryCards summary={state.response.summary} />

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              <div className="xl:col-span-2 rounded-xl overflow-hidden border border-slate-700 h-[480px]">
                <MapView
                  featureCollection={state.featureCollection}
                  processedFeatures={state.response.features}
                  selectedIndex={state.selectedFeatureIndex}
                  onSelectFeature={handleSelectFeature}
                  onSave={handleMapSave}
                />
              </div>

              <div className="xl:col-span-1">
                <IssuesPanel
                  summary={state.response.summary}
                  onSelectFeature={handleSelectFeature}
                  onApplyFix={handleApplyFix}
                />
              </div>
            </div>

            <FeatureTable
              features={state.response.features}
              featureCollection={state.featureCollection}
              filter={filter}
              onFilterChange={setFilter}
              selectedIndex={state.selectedFeatureIndex}
              onSelectFeature={handleSelectFeature}
              onUpdateProperties={handleUpdateProperties}
              deletedIndices={deletedIndices}
            />
          </>
        )}
      </main>
    </div>
  );
}
