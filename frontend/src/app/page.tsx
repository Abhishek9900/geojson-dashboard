"use client";

/**
 * Main Dashboard Page.
 *
 * A thin orchestrator: reads data from Redux selectors and dispatches
 * actions / thunks.  All business logic lives in the store; all derived
 * table data lives in selectors.  This component's job is layout only.
 */

import { useAppDispatch, useAppSelector } from "@/store";
import {
  selectHasData,
  selectHasPending,
  selectIsSaving,
  selectFilename,
  selectResponse,
  selectFeatureCollection,
  selectSelectedIndex,
  selectUploadStatus,
  selectUploadProgress,
  selectError,
} from "@/store/selectors";
import {
  mapEditStaged,
  geometryFixApplied,
  propertiesUpdated,
  featureSelected,
  resetDashboard,
} from "@/store/dashboardSlice";
import { uploadFile, analyseCurrentFC } from "@/store/dashboardThunks";
import { downloadGeoJSON } from "@/lib/geojson-utils";
import type { GeometryIssue } from "@/types";
import type { FeatureCollection } from "geojson";
import toast from "react-hot-toast";

import { UploadZone } from "@/components/upload/UploadZone";
import { SummaryCards } from "@/components/ui/SummaryCards";
import { FeatureTable } from "@/components/table/FeatureTable";
import { MapView } from "@/components/map/MapView";
import { IssuesPanel } from "@/components/ui/IssuesPanel";
import { Header } from "@/components/ui/Header";

export default function DashboardPage() {
  const dispatch = useAppDispatch();

  // Selectors — each component only re-renders when its slice changes.
  const hasData = useAppSelector(selectHasData);
  const hasPending = useAppSelector(selectHasPending);
  const isSaving = useAppSelector(selectIsSaving);
  const filename = useAppSelector(selectFilename);
  const response = useAppSelector(selectResponse);
  const featureCollection = useAppSelector(selectFeatureCollection);
  const selectedIndex = useAppSelector(selectSelectedIndex);
  const uploadStatus = useAppSelector(selectUploadStatus);
  const uploadProgress = useAppSelector(selectUploadProgress);
  const error = useAppSelector(selectError);

  // ---- handlers ----

  function handleUpload(file: File) {
    dispatch(uploadFile(file));
  }

  function handleMapSave(updatedFC: FeatureCollection) {
    dispatch(mapEditStaged(updatedFC));
    toast.success("Edits staged — click Save to run analysis again.", {
      duration: 4000,
    });
  }

  function handleApplyFix(issue: GeometryIssue) {
    dispatch(geometryFixApplied(issue));
    toast.success(
      `Fix applied to feature #${issue.feature_index} — save & analyse to confirm.`,
      { icon: "🔧" }
    );
  }

  function handleUpdateProperties(index: number, props: Record<string, string>) {
    dispatch(propertiesUpdated({ index, props }));
  }

  function handleAnalyse() {
    dispatch(analyseCurrentFC());
  }

  function handleDownload() {
    const fc = featureCollection;
    if (fc && filename) {
      downloadGeoJSON(fc, filename);
      toast.success("File downloaded.");
    }
  }

  function handleReset() {
    dispatch(resetDashboard());
  }

  function handleSelectFeature(idx: number) {
    dispatch(featureSelected(idx < 0 ? null : idx));
  }

  // ---- render ----

  return (
    <div className="min-h-screen flex flex-col">
      <Header
        filename={filename}
        onReset={handleReset}
        onDownload={hasData ? handleDownload : undefined}
        onAnalyse={hasData ? handleAnalyse : undefined}
        hasPending={hasPending}
        isSaving={isSaving}
      />

      <main className="flex-1 p-4 md:p-6 space-y-6 max-w-[1600px] mx-auto w-full">
        {!hasData && (
          <UploadZone
            onUpload={handleUpload}
            status={uploadStatus}
            progress={uploadProgress}
            error={error}
          />
        )}

        {hasData && response && featureCollection && (
          <>
            <SummaryCards summary={response.summary} />

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              <div className="xl:col-span-2 rounded-xl overflow-hidden border border-slate-700 h-[480px]">
                <MapView
                  featureCollection={featureCollection}
                  processedFeatures={response.features}
                  selectedIndex={selectedIndex}
                  onSelectFeature={handleSelectFeature}
                  onSave={handleMapSave}
                />
              </div>

              <div className="xl:col-span-1">
                <IssuesPanel
                  summary={response.summary}
                  onSelectFeature={handleSelectFeature}
                  onApplyFix={handleApplyFix}
                />
              </div>
            </div>

            {/* FeatureTable reads its own state from Redux internally */}
            <FeatureTable
              onSelectFeature={handleSelectFeature}
              onUpdateProperties={handleUpdateProperties}
            />
          </>
        )}
      </main>
    </div>
  );
}
