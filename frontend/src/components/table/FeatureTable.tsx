"use client";

/**
 * FeatureTable — paginated, searchable, sortable feature list.
 *
 * All data derivation (filter → search → sort → paginate) is handled by
 * memoised Redux selectors; this component only reads the final page of rows
 * and dispatches table UI actions.
 *
 * Props are intentionally minimal: the table drives its own state via the
 * Redux `table` slice, so the parent page.tsx does not need to manage filter,
 * search, sort, or page state at all.
 */

import { useState } from "react";
import {
  CheckCircle,
  XCircle,
  Copy,
  ChevronDown,
  ChevronUp,
  Pencil,
  Check,
  X,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";

import { useAppDispatch, useAppSelector } from "@/store";
import {
  selectFilter,
  selectSearchQuery,
  selectSortKey,
  selectSortDir,
  selectCurrentPage,
  selectPageSize,
  selectPagedRows,
  selectTotalFilteredCount,
  selectTotalPages,
  selectFilterCounts,
  selectSelectedIndex,
  selectFeatureCollection,
} from "@/store/selectors";
import {
  filterChanged,
  searchQueryChanged,
  sortChanged,
  pageChanged,
  pageSizeChanged,
} from "@/store/tableSlice";
import type { FeatureFilter } from "@/types";
import type { SortKey } from "@/store/tableSlice";
import type { TableRow } from "@/store/selectors";

const FILTER_LABELS: Record<FeatureFilter, string> = {
  all: "All",
  valid: "Valid",
  invalid: "Issues",
  duplicate: "Duplicates",
};

const PAGE_SIZE_OPTIONS = [25, 50, 100, 250];

interface FeatureTableProps {
  onSelectFeature: (index: number) => void;
  onUpdateProperties?: (index: number, props: Record<string, string>) => void;
}

export function FeatureTable({ onSelectFeature, onUpdateProperties }: FeatureTableProps) {
  const dispatch = useAppDispatch();

  // Table UI state from Redux.
  const filter = useAppSelector(selectFilter);
  const searchQuery = useAppSelector(selectSearchQuery);
  const sortKey = useAppSelector(selectSortKey);
  const sortDir = useAppSelector(selectSortDir);
  const currentPage = useAppSelector(selectCurrentPage);
  const pageSize = useAppSelector(selectPageSize);

  // Derived data from memoised selectors.
  const pagedRows = useAppSelector(selectPagedRows);
  const totalFiltered = useAppSelector(selectTotalFilteredCount);
  const totalPages = useAppSelector(selectTotalPages);
  const filterCounts = useAppSelector(selectFilterCounts);
  const selectedIndex = useAppSelector(selectSelectedIndex);
  const featureCollection = useAppSelector(selectFeatureCollection);

  // Inline property editing — local only; committed to Redux on save.
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editProps, setEditProps] = useState<Record<string, string>>({});
  const [newPropKey, setNewPropKey] = useState("");
  const [newPropValue, setNewPropValue] = useState("");

  // ---- sort ----

  function handleSortClick(key: SortKey) {
    if (sortKey === key) {
      dispatch(sortChanged({ key, dir: sortDir === "asc" ? "desc" : "asc" }));
    } else {
      dispatch(sortChanged({ key, dir: "asc" }));
    }
  }

  function SortIcon({ column }: { column: SortKey }) {
    if (sortKey !== column) return null;
    return sortDir === "asc" ? (
      <ChevronUp className="h-3 w-3" />
    ) : (
      <ChevronDown className="h-3 w-3" />
    );
  }

  // ---- inline editing ----

  function startEdit(row: TableRow) {
    const rawProps =
      featureCollection?.features[row.index]?.properties ?? row.pf?.feature.properties ?? {};
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

  // ---- pagination helpers ----

  const pageStart = totalFiltered === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const pageEnd = Math.min(currentPage * pageSize, totalFiltered);

  return (
    <div className="overflow-hidden rounded-xl border border-slate-700 bg-slate-900">
      {/* ---------------------------------------------------------------- */}
      {/* Toolbar: filter tabs + search + page size                        */}
      {/* ---------------------------------------------------------------- */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700 px-4 py-3">
        <h2 className="shrink-0 text-sm font-semibold">Feature Table</h2>

        {/* Filter tabs */}
        <div className="flex flex-wrap gap-1">
          {(Object.keys(FILTER_LABELS) as FeatureFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => dispatch(filterChanged(f))}
              className={[
                "rounded-lg px-3 py-1 text-xs font-medium transition-colors",
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

        {/* Search */}
        <div className="relative max-w-[320px] min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search properties, type, index…"
            value={searchQuery}
            onChange={(e) => dispatch(searchQueryChanged(e.target.value))}
            className="w-full rounded-lg border border-slate-700 bg-slate-800 py-1.5 pr-3 pl-8 text-xs text-slate-200 transition-colors placeholder:text-slate-600 focus:border-green-500 focus:outline-none"
          />
          {searchQuery && (
            <button
              onClick={() => dispatch(searchQueryChanged(""))}
              className="absolute top-1/2 right-2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Page size selector */}
        <select
          value={pageSize}
          onChange={(e) => dispatch(pageSizeChanged(Number(e.target.value)))}
          className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-300 transition-colors focus:border-green-500 focus:outline-none"
          aria-label="Rows per page"
        >
          {PAGE_SIZE_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n} / page
            </option>
          ))}
        </select>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Scrollable table                                                  */}
      {/* ---------------------------------------------------------------- */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-700 text-slate-400">
              {(
                [
                  { key: "index" as SortKey, label: "#" },
                  { key: "type" as SortKey, label: "Geometry" },
                  { key: "valid" as SortKey, label: "Valid" },
                  { key: "duplicate" as SortKey, label: "Duplicate" },
                  { key: "area" as SortKey, label: "Area (approx)" },
                ] as const
              ).map(({ key, label }) => (
                <th
                  key={key}
                  className="cursor-pointer px-4 py-2 text-left transition-colors select-none hover:text-slate-200"
                  onClick={() => handleSortClick(key)}
                >
                  <span className="inline-flex items-center gap-1">
                    {label}
                    <SortIcon column={key} />
                  </span>
                </th>
              ))}
              <th className="px-4 py-2 text-left">Properties</th>
              <th className="px-4 py-2 text-left">Issues</th>
              {onUpdateProperties && <th className="w-10 px-4 py-2 text-left" />}
            </tr>
          </thead>
          <tbody>
            {pagedRows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                  {searchQuery
                    ? `No features match "${searchQuery}".`
                    : "No features match this filter."}
                </td>
              </tr>
            )}
            {pagedRows.map((row) => {
              const { index, pf, isDrawn } = row;
              const isSelected = index === selectedIndex;
              const isEditing = editingIndex === index;

              const rawProps = row.isDeleted
                ? (pf?.feature.properties ?? {})
                : (featureCollection?.features[index]?.properties ?? pf?.feature.properties ?? {});
              const displayProps = Object.entries(rawProps).filter(([k]) => !k.startsWith("_"));

              return (
                <tr
                  key={index}
                  onClick={() => !isEditing && onSelectFeature(index)}
                  className={[
                    "cursor-pointer border-b border-slate-800 transition-colors",
                    isSelected
                      ? "border-amber-500/20 bg-amber-500/10"
                      : row.isDeleted
                        ? "border-red-500/10 bg-red-500/5"
                        : row.isEdited
                          ? "border-blue-500/10 bg-blue-500/5"
                          : "hover:bg-slate-800/60",
                    row.isDeleted ? "opacity-60" : "",
                    pf?.is_duplicate ? "opacity-75" : "",
                  ].join(" ")}
                >
                  {/* # */}
                  <td className="px-4 py-2.5 font-mono text-slate-400">
                    <span className="flex items-center gap-1.5">
                      {index}
                      {isDrawn && (
                        <span className="rounded border border-amber-500/30 bg-amber-500/20 px-1 py-px text-[9px] font-semibold text-amber-300">
                          NEW
                        </span>
                      )}
                      {row.isDeleted && (
                        <span className="rounded border border-red-500/30 bg-red-500/20 px-1 py-px text-[9px] font-semibold text-red-300">
                          DELETED
                        </span>
                      )}
                      {row.isEdited && (
                        <span className="rounded border border-blue-500/30 bg-blue-500/20 px-1 py-px text-[9px] font-semibold text-blue-300">
                          EDITED
                        </span>
                      )}
                    </span>
                  </td>

                  {/* Geometry type */}
                  <td className="px-4 py-2.5 font-mono text-slate-300">{row.geomType}</td>

                  {/* Valid */}
                  <td className="px-4 py-2.5">
                    {isDrawn ? (
                      <span className="text-[10px] text-slate-500">pending</span>
                    ) : pf?.is_valid ? (
                      <CheckCircle className="h-4 w-4 text-green-400" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-400" />
                    )}
                  </td>

                  {/* Duplicate */}
                  <td className="px-4 py-2.5">
                    {pf?.is_duplicate ? (
                      <span className="inline-flex items-center gap-1 text-purple-300">
                        <Copy className="h-3 w-3" />
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
                  <td className="max-w-[300px] px-4 py-2.5">
                    {isEditing ? (
                      <div className="space-y-1.5" onClick={(e) => e.stopPropagation()}>
                        {Object.entries(editProps).map(([k, v]) => (
                          <div key={k} className="flex items-center gap-1">
                            <span className="w-20 shrink-0 truncate font-mono text-[10px] text-slate-500">
                              {k}:
                            </span>
                            <input
                              type="text"
                              value={v}
                              onChange={(e) =>
                                setEditProps((p) => ({
                                  ...p,
                                  [k]: e.target.value,
                                }))
                              }
                              className="min-w-0 flex-1 rounded border border-slate-600 bg-slate-900 px-1.5 py-0.5 text-[11px] text-slate-200 focus:border-green-500 focus:outline-none"
                            />
                            <button
                              onClick={() =>
                                setEditProps((p) => {
                                  const n = { ...p };
                                  delete n[k];
                                  return n;
                                })
                              }
                              className="text-red-400 transition-colors hover:text-red-300"
                              title="Remove property"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                        {/* Add new property */}
                        <div className="flex items-center gap-1 border-t border-slate-700 pt-1">
                          <input
                            type="text"
                            placeholder="key"
                            value={newPropKey}
                            onChange={(e) => setNewPropKey(e.target.value)}
                            className="w-16 rounded border border-slate-600 bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] text-slate-300 focus:border-green-500 focus:outline-none"
                          />
                          <input
                            type="text"
                            placeholder="value"
                            value={newPropValue}
                            onChange={(e) => setNewPropValue(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && addNewProp()}
                            className="min-w-0 flex-1 rounded border border-slate-600 bg-slate-900 px-1.5 py-0.5 text-[10px] text-slate-300 focus:border-green-500 focus:outline-none"
                          />
                          <button
                            onClick={addNewProp}
                            className="px-1 text-xs text-green-400 hover:text-green-300"
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
                            className="max-w-[150px] truncate rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[10px]"
                          >
                            <span className="text-slate-500">{k}: </span>
                            <span className="text-slate-300">{String(v)}</span>
                          </span>
                        ))}
                        {displayProps.length === 0 && (
                          <span className="text-[10px] text-slate-600">no properties</span>
                        )}
                        {displayProps.length > 4 && (
                          <span className="text-[10px] text-slate-500">
                            +{displayProps.length - 4} more
                          </span>
                        )}
                      </div>
                    )}
                  </td>

                  {/* Issues */}
                  <td className="px-4 py-2.5">
                    {pf && pf.issues.length > 0 ? (
                      <span className="text-[10px] leading-relaxed text-red-300">
                        {pf.issues.join(", ")}
                      </span>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>

                  {/* Edit / confirm / cancel */}
                  {onUpdateProperties && (
                    <td className="px-2 py-2.5" onClick={(e) => e.stopPropagation()}>
                      {isEditing ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => commitEdit(index)}
                            title="Save properties"
                            className="text-green-400 transition-colors hover:text-green-300"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={cancelEdit}
                            title="Cancel"
                            className="text-slate-500 transition-colors hover:text-slate-300"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => startEdit(row)}
                          title="Edit properties"
                          className="text-slate-500 transition-colors hover:text-slate-300"
                          disabled={row.isDeleted}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Footer: row count + pagination controls                          */}
      {/* ---------------------------------------------------------------- */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-800 px-4 py-2.5">
        {/* Row count */}
        <p className="text-xs text-slate-500">
          {totalFiltered === 0 ? (
            "No results"
          ) : (
            <>
              Showing{" "}
              <span className="text-slate-300">
                {pageStart}–{pageEnd}
              </span>{" "}
              of <span className="text-slate-300">{totalFiltered}</span> features
              {searchQuery && (
                <span className="ml-1 text-green-400/70">matching &ldquo;{searchQuery}&rdquo;</span>
              )}
            </>
          )}
        </p>

        {/* Pagination controls */}
        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <PaginationButton
              onClick={() => dispatch(pageChanged(1))}
              disabled={currentPage === 1}
              title="First page"
            >
              <ChevronsLeft className="h-3.5 w-3.5" />
            </PaginationButton>
            <PaginationButton
              onClick={() => dispatch(pageChanged(currentPage - 1))}
              disabled={currentPage === 1}
              title="Previous page"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </PaginationButton>

            {/* Page number pills */}
            {getPagePills(currentPage, totalPages).map((pill, i) =>
              pill === "…" ? (
                <span key={`ellipsis-${i}`} className="px-1 text-xs text-slate-600 select-none">
                  …
                </span>
              ) : (
                <button
                  key={pill}
                  onClick={() => dispatch(pageChanged(pill as number))}
                  className={[
                    "h-7 min-w-[28px] rounded px-1.5 text-xs font-medium transition-colors",
                    currentPage === pill
                      ? "bg-green-600 text-white"
                      : "bg-slate-800 text-slate-400 hover:text-slate-200",
                  ].join(" ")}
                >
                  {pill}
                </button>
              )
            )}

            <PaginationButton
              onClick={() => dispatch(pageChanged(currentPage + 1))}
              disabled={currentPage === totalPages}
              title="Next page"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </PaginationButton>
            <PaginationButton
              onClick={() => dispatch(pageChanged(totalPages))}
              disabled={currentPage === totalPages}
              title="Last page"
            >
              <ChevronsRight className="h-3.5 w-3.5" />
            </PaginationButton>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PaginationButton({
  children,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex h-7 w-7 items-center justify-center rounded bg-slate-800 text-slate-400 transition-colors hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-30"
    >
      {children}
    </button>
  );
}

/**
 * Compute the list of page pills to show in the pagination bar.
 * Always shows first, last, current, and two neighbours; inserts "…" gaps.
 */
function getPagePills(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages = new Set<number>();
  pages.add(1);
  pages.add(total);
  for (let i = Math.max(2, current - 2); i <= Math.min(total - 1, current + 2); i++) {
    pages.add(i);
  }

  const sorted = Array.from(pages).sort((a, b) => a - b);
  const result: (number | "…")[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) result.push("…");
    result.push(sorted[i]);
  }
  return result;
}
