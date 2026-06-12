"use client";

/**
 * Interactive feature table with filtering, sorting, row selection,
 * and inline property editing.
 */

import { useState, useMemo } from "react";
import { CheckCircle, XCircle, Copy, ChevronDown, ChevronUp, Pencil, Check, X } from "lucide-react";
import type { ProcessedFeature, FeatureFilter } from "@/types";
import type { FeatureCollection } from "geojson";

interface FeatureTableProps {
  features: ProcessedFeature[];
  featureCollection?: FeatureCollection; // full FC to access drawn features
  filter: FeatureFilter;
  onFilterChange: (f: FeatureFilter) => void;
  selectedIndex: number | null;
  onSelectFeature: (index: number) => void;
  onUpdateProperties?: (index: number, props: Record<string, string>) => void;
  deletedIndices: Set<number>;
}

type SortKey = "index" | "type" | "valid" | "duplicate" | "area";
type SortDir = "asc" | "desc";

const FILTER_LABELS: Record<FeatureFilter, string> = {
  all: "All",
  valid: "Valid",
  invalid: "Issues",
  duplicate: "Duplicates",
};

// A "virtual" row combining both a processedFeature (if available) and the
// raw feature index from the full FC.
interface TableRow {
  index: number;            // index into featureCollection.features
  pf: ProcessedFeature | null; // null for drawn-but-not-yet-processed features
  geomType: string;
  isDrawn: boolean;
  isDeleted: boolean;
}

export function FeatureTable({
  features,
  featureCollection,
  filter,
  onFilterChange,
  selectedIndex,
  onSelectFeature,
  onUpdateProperties,
  deletedIndices = new Set(),
}: FeatureTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("index");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Inline property editing state
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editProps, setEditProps] = useState<Record<string, string>>({});
  const [newPropKey, setNewPropKey] = useState("");
  const [newPropValue, setNewPropValue] = useState("");

  // Build the unified row list: backend features + any drawn features not yet processed
  const allRows = useMemo<TableRow[]>(() => {
    const rows: TableRow[] = [];

    // First add deleted backend features (present in `features` but absent from FC)
    features.forEach((pf, i) => {
      if (deletedIndices.has(i)) {
        rows.push({
          index: i,
          pf,
          geomType: pf.feature.geometry?.type ?? "null",
          isDrawn: false,
          isDeleted: true,
        });
      }
    });

    // Then walk the live FC — use _originalIndex to classify each feature
    (featureCollection?.features ?? []).forEach((f, idx) => {
      const originalIdx: number | undefined = f.properties?._originalIndex;
      const isDrawn = originalIdx == null;
      const pf = originalIdx != null ? features[originalIdx] ?? null : null;
      rows.push({
        index: idx,
        pf,
        geomType: f.geometry?.type ?? "null",
        isDrawn,
        isDeleted: false,
      });
    });

    return rows;
  }, [features, featureCollection, deletedIndices]);

  const filtered = useMemo(() => {
    return allRows.filter((row) => {
      if (row.isDeleted) return filter === "all";
      if (row.isDrawn) return filter === "all"; // drawn features only show in "all"
      const pf = row.pf!;
      if (filter === "valid") return pf.is_valid && !pf.is_duplicate;
      if (filter === "invalid") return !pf.is_valid;
      if (filter === "duplicate") return pf.is_duplicate;
      return true;
    });
  }, [allRows, filter]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "index") cmp = a.index - b.index;
      else if (sortKey === "type") cmp = a.geomType.localeCompare(b.geomType);
      else if (sortKey === "valid")
        cmp = Number(b.pf?.is_valid ?? true) - Number(a.pf?.is_valid ?? true);
      else if (sortKey === "duplicate")
        cmp = Number(b.pf?.is_duplicate ?? false) - Number(a.pf?.is_duplicate ?? false);
      else if (sortKey === "area")
        cmp = (a.pf?.area_m2 ?? 0) - (b.pf?.area_m2 ?? 0);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function SortIcon({ column }: { column: SortKey }) {
    if (sortKey !== column) return null;
    return sortDir === "asc" ? (
      <ChevronUp className="w-3 h-3" />
    ) : (
      <ChevronDown className="w-3 h-3" />
    );
  }

  const filterCounts: Record<FeatureFilter, number> = {
    all: allRows.length,
    valid: allRows.filter((r) => r.pf && r.pf.is_valid && !r.pf.is_duplicate).length,
    invalid: allRows.filter((r) => r.pf && !r.pf.is_valid).length,
    duplicate: allRows.filter((r) => r.pf?.is_duplicate).length,
  };

  // ---- inline editing helpers ----
  function startEdit(row: TableRow) {
    const rawProps =
      row.pf?.feature.properties ??
      featureCollection?.features[row.index]?.properties ??
      {};
    const props: Record<string, string> = {};
    Object.entries(rawProps).forEach(([k, v]) => {
      if (!k.startsWith("_")) props[k] = String(v ?? "");
    });
    setEditProps(props);
    setEditingIndex(row.index);
    setNewPropKey("");
    setNewPropValue("");
  }

  function commitEdit(index: number) {
    onUpdateProperties?.(index, editProps);
    setEditingIndex(null);
  }

  function cancelEdit() {
    setEditingIndex(null);
  }

  function addNewProp() {
    const k = newPropKey.trim();
    if (!k) return;
    setEditProps((p) => ({ ...p, [k]: newPropValue }));
    setNewPropKey("");
    setNewPropValue("");
  }

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900 overflow-hidden">
      {/* Table header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 gap-4 flex-wrap">
        <h2 className="text-sm font-semibold">Feature Table</h2>

        {/* Filter tabs */}
        <div className="flex gap-1">
          {(Object.keys(FILTER_LABELS) as FeatureFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => onFilterChange(f)}
              className={[
                "text-xs px-3 py-1 rounded-lg transition-colors font-medium",
                filter === f
                  ? "bg-green-600 text-white"
                  : "bg-slate-800 text-slate-400 hover:text-slate-200",
              ].join(" ")}
            >
              {FILTER_LABELS[f]}
              <span className="ml-1.5 text-[10px] opacity-70">({filterCounts[f]})</span>
            </button>
          ))}
        </div>
      </div>

      {/* Scrollable table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-400 border-b border-slate-700">
              {[
                { key: "index" as SortKey, label: "#" },
                { key: "type" as SortKey, label: "Geometry" },
                { key: "valid" as SortKey, label: "Valid" },
                { key: "duplicate" as SortKey, label: "Duplicate" },
                { key: "area" as SortKey, label: "Area (approx)" },
              ].map(({ key, label }) => (
                <th
                  key={key}
                  className="text-left px-4 py-2 cursor-pointer hover:text-slate-200 transition-colors select-none"
                  onClick={() => toggleSort(key)}
                >
                  <span className="inline-flex items-center gap-1">
                    {label}
                    <SortIcon column={key} />
                  </span>
                </th>
              ))}
              <th className="text-left px-4 py-2">Properties</th>
              <th className="text-left px-4 py-2">Issues</th>
              {onUpdateProperties && <th className="text-left px-4 py-2 w-10"></th>}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                  No features match this filter.
                </td>
              </tr>
            )}
            {sorted.map((row) => {
              const { index, pf, isDrawn } = row;
              const isSelected = index === selectedIndex;
              const isEditing = editingIndex === index;

              const rawProps =
                pf?.feature.properties ??
                featureCollection?.features[index]?.properties ??
                {};
              const displayProps = Object.entries(rawProps).filter(([k]) => !k.startsWith("_"));

              return (
                <>
                  <tr
                    key={index}
                    onClick={() => !isEditing && onSelectFeature(index)}
                    className={[
                      "border-b border-slate-800 cursor-pointer transition-colors",
                      isSelected ? "bg-amber-500/10 border-amber-500/20"
                        : row.isDeleted ? "bg-red-500/5 border-red-500/10"
                        : "hover:bg-slate-800/60",
                      row.isDeleted ? "opacity-60" : "",
                      pf?.is_duplicate ? "opacity-75" : "",
                    ].join(" ")}
                  >
                    {/* Index */}
                    <td className="px-4 py-2.5 font-mono text-slate-400">
                      <span className="flex items-center gap-1.5">
                        {index}
                        {isDrawn && (
                          <span className="inline-block bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded px-1 py-px text-[9px] font-semibold tracking-wide">
                            NEW
                          </span>
                        )}
                        {row.isDeleted && (
                          <span className="inline-block bg-red-500/20 text-red-300 border border-red-500/30 rounded px-1 py-px text-[9px] font-semibold tracking-wide">
                            DELETED
                          </span>
                        )}
                      </span>
                    </td>

                    {/* Geometry type */}
                    <td className="px-4 py-2.5 font-mono text-slate-300">{row.geomType}</td>

                    {/* Valid */}
                    <td className="px-4 py-2.5">
                      {isDrawn ? (
                        <span className="text-slate-500 text-[10px]">pending</span>
                      ) : pf?.is_valid ? (
                        <CheckCircle className="w-4 h-4 text-green-400" />
                      ) : (
                        <XCircle className="w-4 h-4 text-red-400" />
                      )}
                    </td>

                    {/* Duplicate */}
                    <td className="px-4 py-2.5">
                      {pf?.is_duplicate ? (
                        <span className="inline-flex items-center gap-1 text-purple-300">
                          <Copy className="w-3 h-3" />
                          Group {pf.duplicate_group_id}
                        </span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>

                    {/* Area */}
                    <td className="px-4 py-2.5 font-mono text-slate-400">
                      {pf?.area_m2 != null ? `~${pf.area_m2.toLocaleString()} m²` : "—"}
                    </td>

                    {/* Properties */}
                    <td className="px-4 py-2.5 max-w-[300px]">
                      {isEditing ? (
                        <div
                          className="space-y-1.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {Object.entries(editProps).map(([k, v]) => (
                            <div key={k} className="flex items-center gap-1">
                              <span className="text-slate-500 font-mono text-[10px] w-20 shrink-0 truncate">
                                {k}:
                              </span>
                              <input
                                type="text"
                                value={v}
                                onChange={(e) =>
                                  setEditProps((p) => ({ ...p, [k]: e.target.value }))
                                }
                                className="flex-1 bg-slate-900 border border-slate-600 rounded px-1.5 py-0.5 text-[11px] text-slate-200 focus:outline-none focus:border-green-500 min-w-0"
                              />
                              <button
                                onClick={() =>
                                  setEditProps((p) => {
                                    const n = { ...p };
                                    delete n[k];
                                    return n;
                                  })
                                }
                                className="text-red-400 hover:text-red-300 transition-colors"
                                title="Remove property"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                          {/* Add new key */}
                          <div className="flex items-center gap-1 pt-1 border-t border-slate-700">
                            <input
                              type="text"
                              placeholder="key"
                              value={newPropKey}
                              onChange={(e) => setNewPropKey(e.target.value)}
                              className="w-16 bg-slate-900 border border-slate-600 rounded px-1.5 py-0.5 text-[10px] text-slate-300 focus:outline-none focus:border-green-500 font-mono"
                            />
                            <input
                              type="text"
                              placeholder="value"
                              value={newPropValue}
                              onChange={(e) => setNewPropValue(e.target.value)}
                              onKeyDown={(e) => e.key === "Enter" && addNewProp()}
                              className="flex-1 bg-slate-900 border border-slate-600 rounded px-1.5 py-0.5 text-[10px] text-slate-300 focus:outline-none focus:border-green-500 min-w-0"
                            />
                            <button
                              onClick={addNewProp}
                              className="text-green-400 hover:text-green-300 text-xs px-1"
                              title="Add property"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {displayProps.slice(0, 4).map(([k, v]) => (
                            <span
                              key={k}
                              className="inline-block bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] truncate max-w-[150px]"
                            >
                              <span className="text-slate-500">{k}: </span>
                              <span className="text-slate-300">{String(v)}</span>
                            </span>
                          ))}
                          {displayProps.length === 0 && (
                            <span className="text-slate-600 text-[10px]">no properties</span>
                          )}
                        </div>
                      )}
                    </td>

                    {/* Issues */}
                    <td className="px-4 py-2.5">
                      {pf && pf.issues.length > 0 ? (
                        <span className="text-red-300 text-[10px] leading-relaxed">
                          {pf.issues.join(", ")}
                        </span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>

                    {/* Edit/confirm/cancel button */}
                    {onUpdateProperties && (
                      <td
                        className="px-2 py-2.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {isEditing ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => commitEdit(index)}
                              title="Save properties"
                              className="text-green-400 hover:text-green-300 transition-colors"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={cancelEdit}
                              title="Cancel"
                              className="text-slate-500 hover:text-slate-300 transition-colors"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => startEdit(row)}
                            title="Edit properties"
                            className="text-slate-500 hover:text-slate-300 transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                </>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="px-4 py-2 border-t border-slate-800 text-xs text-slate-500">
        Showing {sorted.length} of {allRows.length} features
        {allRows.filter((r) => r.isDrawn).length > 0 && (
          <span className="ml-2 text-amber-400/70">
            · {allRows.filter((r) => r.isDrawn).length} new
          </span>
        )}
        {allRows.filter((r) => r.isDeleted).length > 0 && (
          <span className="ml-2 text-red-400/70">
            · {allRows.filter((r) => r.isDeleted).length} deleted
          </span>
        )}
      </div>
    </div>
  );
}
