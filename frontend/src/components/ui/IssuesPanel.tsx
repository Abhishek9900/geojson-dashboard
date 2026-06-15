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
  const idx = fc.features.findIndex(
    (f) => f.properties?._originalIndex === originalIndex
  );
  return idx === -1 ? originalIndex : idx;
}

export function IssuesPanel({ summary, featureCollection, onSelectFeature, onApplyFix }: IssuesPanelProps) {
  const hasIssues = summary.issues.length > 0 || summary.duplicate_groups_detail.length > 0;

  const fixableCount = summary.issues.filter(
    (i) => i.auto_fix_available && i.fixed_geometry != null
  ).length;

  return (
    <div className="h-[480px] flex flex-col rounded-xl border border-slate-700 bg-slate-900 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-700 flex-shrink-0 flex items-center justify-between">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400" />
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
            className="flex items-center gap-1 text-[10px] bg-green-600/20 hover:bg-green-600/30 text-green-300 border border-green-500/30 px-2 py-1 rounded-lg transition-colors"
            title="Apply all available automatic fixes"
          >
            <Wrench className="w-3 h-3" />
            Fix all ({fixableCount})
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {!hasIssues && (
          <div className="flex flex-col items-center justify-center h-full text-slate-500 text-sm gap-2">
            <span className="text-2xl">✅</span>
            <span>No issues found</span>
          </div>
        )}

        {/* Geometry Issues */}
        {summary.issues.map((issue, i) => {
          const canFix = issue.auto_fix_available && issue.fixed_geometry != null && onApplyFix;
          return (
            <div
              key={i}
              className="rounded-lg border border-red-500/20 bg-red-500/5 p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <button
                  // Issues chip click
                  onClick={() => onSelectFeature(resolveLiveIndex(featureCollection, issue.feature_index))}
                  className="flex-1 min-w-0 text-left group"
                >
                  <p className="text-xs font-mono text-red-300 truncate group-hover:text-red-200 transition-colors">
                    Feature #{issue.feature_index}
                    {issue.feature_id != null && ` (fid: ${issue.feature_id})`}
                  </p>
                  <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                    {issue.description}
                  </p>
                  {issue.issue_type && (
                    <p className="text-[10px] text-slate-500 mt-0.5 font-mono">
                      type: {issue.issue_type}
                    </p>
                  )}
                </button>

                <div className="flex flex-col gap-1 flex-shrink-0 items-end">
                  {issue.auto_fix_available && (
                    <span className="flex items-center gap-1 text-[10px] text-green-400 bg-green-500/10 border border-green-500/20 px-1.5 py-0.5 rounded">
                      <Wrench className="w-2.5 h-2.5" />
                      Fixable
                    </span>
                  )}
                  {canFix && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onApplyFix!(issue);
                      }}
                      className="flex items-center gap-1 text-[10px] bg-green-600 hover:bg-green-500 text-white px-2 py-0.5 rounded transition-colors font-medium"
                      title="Apply automatic fix for this geometry"
                    >
                      <Check className="w-2.5 h-2.5" />
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
            <div className="flex items-center gap-2 mb-2">
              <Copy className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />
              <p className="text-xs font-semibold text-purple-300">
                Duplicate Group {group.group_id + 1}
              </p>
            </div>
            <p className="text-xs text-slate-400 mb-2">{group.description}</p>
            <div className="flex flex-wrap gap-1">
              {group.feature_indices.map((idx) => (
                <button
                  key={idx}
                  // Duplicate group chip click  
                  onClick={() => onSelectFeature(resolveLiveIndex(featureCollection, idx))}
                  className="text-[10px] font-mono bg-purple-500/20 hover:bg-purple-500/30 text-purple-200 px-1.5 py-0.5 rounded transition-colors"
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
