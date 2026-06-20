"use client";

/**
 * Panel showing geometry issues and duplicate groups.
 * Includes "Apply Fix" buttons for issues that have a fixed_geometry available.
 */

import { AlertTriangle, Copy, Wrench, Check } from "lucide-react";
import type { AnalysisSummary, GeometryIssue } from "@/types";
import type { FeatureCollection } from "geojson";

interface IssuesPanelProps {
  summary: AnalysisSummary;
  featureCollection: FeatureCollection | null;
  onSelectFeature: (index: number) => void;
  onApplyFix?: (issue: GeometryIssue) => void;
}

// Helper to resolve originalIndex → live FC array position
function resolveLiveIndex(fc: FeatureCollection | null, originalIndex: number): number {
  if (!fc) return originalIndex;
  const idx = fc.features.findIndex((f) => f.properties?._originalIndex === originalIndex);
  return idx === -1 ? originalIndex : idx;
}

export function IssuesPanel({
  summary,
  featureCollection,
  onSelectFeature,
  onApplyFix,
}: IssuesPanelProps) {
  const hasIssues = summary.issues.length > 0 || summary.duplicate_groups_detail.length > 0;

  const fixableCount = summary.issues.filter(
    (i) => i.auto_fix_available && i.fixed_geometry != null
  ).length;

  return (
    <div className="flex h-[480px] flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900">
      <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-700 px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <AlertTriangle className="h-4 w-4 text-amber-400" />
          Issues & Duplicates
        </h2>
        {fixableCount > 0 && onApplyFix && (
          <button
            onClick={() => {
              const fixable = summary.issues.filter(
                (i) => i.auto_fix_available && i.fixed_geometry != null
              );
              fixable.forEach((i) => onApplyFix!(i));
            }}
            className="flex items-center gap-1 rounded-lg border border-green-500/30 bg-green-600/20 px-2 py-1 text-[10px] text-green-300 transition-colors hover:bg-green-600/30"
            title="Apply all available automatic fixes"
          >
            <Wrench className="h-3 w-3" />
            Fix all ({fixableCount})
          </button>
        )}
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {!hasIssues && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-slate-500">
            <span className="text-2xl">✅</span>
            <span>No issues found</span>
          </div>
        )}

        {/* Geometry Issues */}
        {summary.issues.map((issue, i) => {
          const canFix = issue.auto_fix_available && issue.fixed_geometry != null && onApplyFix;
          return (
            <div key={i} className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
              <div className="flex items-start justify-between gap-2">
                <button
                  // Issues chip click
                  onClick={() =>
                    onSelectFeature(resolveLiveIndex(featureCollection, issue.feature_index))
                  }
                  className="group min-w-0 flex-1 text-left"
                >
                  <p className="truncate font-mono text-xs text-red-300 transition-colors group-hover:text-red-200">
                    Feature #{issue.feature_index}
                    {issue.feature_id != null && ` (fid: ${issue.feature_id})`}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-300">{issue.description}</p>
                  {issue.issue_type && (
                    <p className="mt-0.5 font-mono text-[10px] text-slate-500">
                      type: {issue.issue_type}
                    </p>
                  )}
                </button>

                <div className="flex flex-shrink-0 flex-col items-end gap-1">
                  {issue.auto_fix_available && (
                    <span className="flex items-center gap-1 rounded border border-green-500/20 bg-green-500/10 px-1.5 py-0.5 text-[10px] text-green-400">
                      <Wrench className="h-2.5 w-2.5" />
                      Fixable
                    </span>
                  )}
                  {canFix && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onApplyFix!(issue);
                      }}
                      className="flex items-center gap-1 rounded bg-green-600 px-2 py-0.5 text-[10px] font-medium text-white transition-colors hover:bg-green-500"
                      title="Apply automatic fix for this geometry"
                    >
                      <Check className="h-2.5 w-2.5" />
                      Apply fix
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* Duplicate Groups */}
        {summary.duplicate_groups_detail.map((group) => (
          <div
            key={group.group_id}
            className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-3"
          >
            <div className="mb-2 flex items-center gap-2">
              <Copy className="h-3.5 w-3.5 flex-shrink-0 text-purple-400" />
              <p className="text-xs font-semibold text-purple-300">
                Duplicate Group {group.group_id + 1}
              </p>
            </div>
            <p className="mb-2 text-xs text-slate-400">{group.description}</p>
            <div className="flex flex-wrap gap-1">
              {group.feature_indices.map((idx) => (
                <button
                  key={idx}
                  // Duplicate group chip click
                  onClick={() => onSelectFeature(resolveLiveIndex(featureCollection, idx))}
                  className="rounded bg-purple-500/20 px-1.5 py-0.5 font-mono text-[10px] text-purple-200 transition-colors hover:bg-purple-500/30"
                >
                  #{idx}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
