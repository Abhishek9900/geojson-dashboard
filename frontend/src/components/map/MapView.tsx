"use client";

/**
 * MapView — Interactive map component using MapLibre GL JS.
 *
 * Features:
 *  - Colour-coded rendering (valid/invalid/duplicate/selected)
 *  - Click a feature → select it (fires onSelectFeature)
 *  - selectedIndex change → map flies to that feature's bounds
 *  - Legend click → active filter dims non-matching features to greyscale
 *  - Edit mode:
 *      • Draw new polygons by clicking the map (double-click to close)
 *      • Draw new points with the point tool
 *      • Delete selected feature
 *      • Edit attribute properties via inline modal
 *      • Save / Cancel
 */

import { useEffect, useRef, useCallback, useState } from "react";
import type { FeatureCollection, Feature, Polygon, Point, GeoJsonProperties } from "geojson";
import type { ProcessedFeature } from "@/types";
import { computeFeatureBBox, getFeatureColor } from "@/lib/geojson-utils";
import type { LegendFilter } from "@/lib/geojson-utils";
import {
  Pencil,
  Trash2,
  Check,
  X,
  Pentagon,
  Dot,
  Edit3,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MapViewProps {
  featureCollection: FeatureCollection;
  processedFeatures: ProcessedFeature[];
  selectedIndex: number | null;
  onSelectFeature: (index: number) => void;
  onSave: (fc: FeatureCollection) => void;
}

type DrawTool = "none" | "polygon" | "point";

interface AttributeEdit {
  featureIndex: number;
  properties: Record<string, string>;
}

// Legend items config
const LEGEND_ITEMS: { color: string; label: string; filter: LegendFilter }[] = [
  { color: "#22c55e", label: "Valid", filter: "valid" },
  { color: "#ef4444", label: "Invalid", filter: "invalid" },
  { color: "#8b5cf6", label: "Duplicate", filter: "duplicate" },
  { color: "#f59e0b", label: "Selected", filter: "selected" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MapView({
  featureCollection,
  processedFeatures,
  selectedIndex,
  onSelectFeature,
  onSave,
}: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  const mapLoadedRef = useRef(false);

  // Edit mode state
  const [isEditing, setIsEditing] = useState(false);
  const [editedFC, setEditedFC] = useState<FeatureCollection>(featureCollection);
  const [drawTool, setDrawTool] = useState<DrawTool>("none");
  const [drawPoints, setDrawPoints] = useState<[number, number][]>([]);
  const drawPointsRef = useRef<[number, number][]>([]);

  // Attribute editing modal
  const [attrEdit, setAttrEdit] = useState<AttributeEdit | null>(null);

  // Legend filter — null means show all
  const [legendFilter, setLegendFilter] = useState<LegendFilter>(null);
  const legendFilterRef = useRef<LegendFilter>(null);

  // Keep refs in sync so map event handlers (closures) always read latest values
  const editedFCRef = useRef<FeatureCollection>(featureCollection);
  const isEditingRef = useRef(false);
  const drawToolRef = useRef<DrawTool>("none");

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Build a GeoJSON FeatureCollection with display metadata injected into
   * each feature's properties, taking legendFilter and selectedIndex into account.
   */
  const buildDisplayFC = useCallback(
    (
      fc: FeatureCollection,
      selected: number | null,
      lFilter: LegendFilter
    ) => ({
      ...fc,
      features: fc.features.map((f, idx) => {
        const originalIdx: number | undefined = f.properties?._originalIndex;
        const pf = originalIdx != null ? processedFeatures[originalIdx] : undefined;
        const isDrawn = originalIdx == null; // no _originalIndex → newly drawn
        const isSelected = idx === selected;
        const isValid = pf ? pf.is_valid : true;      // drawn features default valid
        const isDuplicate = pf ? pf.is_duplicate : false;

        // Category for legend filtering — selected does NOT override invalid/duplicate
        // so that an invalid feature stays in "invalid" bucket when selected.
        const category: LegendFilter = isDuplicate
          ? "duplicate"
          : !isValid
          ? "invalid"
          : "valid";

        // If a legend filter is active, dim features not in that category
        // (selected features are always shown)
        const dimmed = lFilter !== null && !isSelected && category !== lFilter;

        // Fill colour is driven by validity/duplicate status only —
        // selection is expressed purely through a thicker, brighter outline.
        const fillColor = dimmed
          ? "#94a3b8"
          : isDrawn
          ? "#f59e0b"                                  // drawn features: amber
          : getFeatureColor(isValid, isDuplicate, false); // never pass isSelected

        return {
          ...f,
          properties: {
            ...(f.properties ?? {}),
            _idx: idx,
            _color: fillColor,
            _opacity: dimmed ? 0.15 : isDuplicate ? 0.4 : 0.6,
            _lineOpacity: dimmed ? 0.2 : 0.9,
            // Selected: thick bright-white outline; drawn: amber; otherwise normal
            _lineWidth: isSelected ? 4 : 1.5,
            _lineColor: isSelected ? "#ffffff" : fillColor,
          },
        };
      }),
    }),
    [processedFeatures]
  );

  /** Push updated data to the MapLibre source (no-op if map not ready). */
  const refreshSource = useCallback(
    (fc: FeatureCollection, selected: number | null, lFilter: LegendFilter) => {
      const map = mapRef.current;
      if (!map || !mapLoadedRef.current) return;
      const source = map.getSource("features");
      if (source) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (source as any).setData(buildDisplayFC(fc, selected, lFilter));
      }
    },
    [buildDisplayFC]
  );

  /**
   * Fly the map to the bounding box of the feature at the given index.
   * Falls back to centering on the centroid if bbox is a single point.
   */
  const flyToFeature = useCallback((index: number, fc: FeatureCollection) => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;
    const feature = fc.features[index];
    if (!feature) return;

    const bbox = computeFeatureBBox(feature as Feature);
    if (!bbox) return;

    const [minLon, minLat, maxLon, maxLat] = bbox;

    // If bbox is effectively a point (e.g. a Point geometry), use flyTo
    if (Math.abs(maxLon - minLon) < 1e-8 && Math.abs(maxLat - minLat) < 1e-8) {
      map.flyTo({ center: [minLon, minLat], zoom: 16, duration: 600 });
    } else {
      map.fitBounds(
        [
          [minLon, minLat],
          [maxLon, maxLat],
        ],
        { padding: 80, duration: 600, maxZoom: 18 }
      );
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Map initialisation — runs once on mount
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    import("maplibre-gl").then(({ default: maplibregl }) => {
      const map = new maplibregl.Map({
        container: mapContainer.current!,
        style: {
          version: 8,
          sources: {
            "osm-tiles": {
              type: "raster",
              tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
              tileSize: 256,
              attribution: "© OpenStreetMap contributors",
            },
          },
          layers: [
            {
              id: "osm-layer",
              type: "raster",
              source: "osm-tiles",
              minzoom: 0,
              maxzoom: 19,
            },
          ],
        },
        center: [0, 20],
        zoom: 2,
      });

      map.on("load", () => {
        mapLoadedRef.current = true;

        // Add the features source
        map.addSource("features", {
          type: "geojson",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data: buildDisplayFC(featureCollection, null, null) as any,
        });

        // Polygon fill
        map.addLayer({
          id: "feature-fill",
          type: "fill",
          source: "features",
          filter: ["==", ["geometry-type"], "Polygon"],
          paint: {
            "fill-color": ["get", "_color"],
            "fill-opacity": ["get", "_opacity"],
          },
        });

        // Polygon + LineString outline
        map.addLayer({
          id: "feature-line",
          type: "line",
          source: "features",
          paint: {
            "line-color": ["get", "_lineColor"],
            "line-width": ["get", "_lineWidth"],
            "line-opacity": ["get", "_lineOpacity"],
          },
        });

        // Point circles
        map.addLayer({
          id: "feature-point",
          type: "circle",
          source: "features",
          filter: ["==", ["geometry-type"], "Point"],
          paint: {
            "circle-radius": 6,
            "circle-color": ["get", "_color"],
            "circle-opacity": ["get", "_opacity"],
            "circle-stroke-color": ["get", "_color"],
            "circle-stroke-width": 1.5,
          },
        });

        // -------------------------------------------------------------------
        // Draw-in-progress preview source
        // -------------------------------------------------------------------
        map.addSource("draw-preview", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        map.addLayer({
          id: "draw-preview-line",
          type: "line",
          source: "draw-preview",
          paint: { "line-color": "#f59e0b", "line-width": 2, "line-dasharray": [2, 2] },
        });
        map.addLayer({
          id: "draw-preview-point",
          type: "circle",
          source: "draw-preview",
          filter: ["==", ["geometry-type"], "Point"],
          paint: { "circle-radius": 4, "circle-color": "#f59e0b" },
        });

        // -------------------------------------------------------------------
        // Click handler — select feature OR add draw vertex
        // -------------------------------------------------------------------
        map.on("click", (e) => {
          const tool = drawToolRef.current;
          if (tool === "point") {
            // Place a point feature immediately
            const lng = e.lngLat.lng;
            const lat = e.lngLat.lat;
            const newFeature: Feature<Point, GeoJsonProperties> = {
              type: "Feature",
              properties: {},
              geometry: { type: "Point", coordinates: [lng, lat] },
            };
            const updated: FeatureCollection = {
              ...editedFCRef.current,
              features: [...editedFCRef.current.features, newFeature],
            };
            editedFCRef.current = updated;
            setEditedFC(updated);
            refreshSource(updated, null, legendFilterRef.current);
            return;
          }

          if (tool === "polygon") {
            // Accumulate polygon vertices; double-click closes (handled below)
            const pts: [number, number][] = [
              ...drawPointsRef.current,
              [e.lngLat.lng, e.lngLat.lat],
            ];
            drawPointsRef.current = pts;
            setDrawPoints(pts);
            updateDrawPreview(map, pts);
            return;
          }

          // Not drawing — try to select a rendered feature
          const hit =
            map.queryRenderedFeatures(e.point, { layers: ["feature-fill"] })[0] ??
            map.queryRenderedFeatures(e.point, { layers: ["feature-line"] })[0] ??
            map.queryRenderedFeatures(e.point, { layers: ["feature-point"] })[0];

          if (hit) {
            const idx = hit.properties?._idx;
            if (idx != null) onSelectFeature(Number(idx));
          } else {
            // Clicked empty map area — deselect
            onSelectFeature(-1);
          }
        });

        // Double-click closes a polygon being drawn
        map.on("dblclick", (e) => {
          if (drawToolRef.current !== "polygon") return;
          e.preventDefault(); // prevent map zoom
          const pts = drawPointsRef.current;
          if (pts.length < 3) return;

          const closed = [...pts, pts[0]] as [number, number][];
          const newFeature: Feature<Polygon, GeoJsonProperties> = {
            type: "Feature",
            properties: {},
            geometry: { type: "Polygon", coordinates: [closed] },
          };
          const updated: FeatureCollection = {
            ...editedFCRef.current,
            features: [...editedFCRef.current.features, newFeature],
          };
          editedFCRef.current = updated;
          setEditedFC(updated);
          drawPointsRef.current = [];
          setDrawPoints([]);
          clearDrawPreview(map);
          refreshSource(updated, null, legendFilterRef.current);
        });

        // Cursor styling
        map.on("mouseenter", "feature-fill", () => {
          if (!drawToolRef.current || drawToolRef.current === "none")
            map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "feature-fill", () => {
          map.getCanvas().style.cursor =
            drawToolRef.current !== "none" ? "crosshair" : "";
        });

        // Initial fit to data
        fitAllFeatures(map, featureCollection);
      });

      mapRef.current = map;
    });

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      mapLoadedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Sync: feature collection / selected / legend filter → map source
  // ---------------------------------------------------------------------------
  useEffect(() => {
    refreshSource(editedFC, selectedIndex, legendFilter);
  }, [editedFC, selectedIndex, legendFilter, refreshSource]);

  // ---------------------------------------------------------------------------
  // Sync: selectedIndex → fly to feature
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (selectedIndex == null || selectedIndex < 0) return;
    // Use editedFC so newly drawn features are also zoomed to
    flyToFeature(selectedIndex, editedFC);
  }, [selectedIndex, flyToFeature, editedFC]);

  // Keep featureCollection prop → editedFC when not in edit mode
  useEffect(() => {
    if (!isEditing) {
      setEditedFC(featureCollection);
      editedFCRef.current = featureCollection;
      refreshSource(featureCollection, selectedIndex, legendFilter);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featureCollection]);

  // Keep refs in sync
  useEffect(() => {
    editedFCRef.current = editedFC;
  }, [editedFC]);
  useEffect(() => {
    isEditingRef.current = isEditing;
  }, [isEditing]);
  useEffect(() => {
    drawToolRef.current = drawTool;
    if (mapRef.current && mapLoadedRef.current) {
      mapRef.current.getCanvas().style.cursor = drawTool !== "none" ? "crosshair" : "";
    }
  }, [drawTool]);
  useEffect(() => {
    legendFilterRef.current = legendFilter;
  }, [legendFilter]);

  // ---------------------------------------------------------------------------
  // Draw helpers
  // ---------------------------------------------------------------------------

  function updateDrawPreview(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map: any,
    pts: [number, number][]
  ) {
    const src = map.getSource("draw-preview");
    if (!src) return;
    if (pts.length === 0) {
      src.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    const lineCoords = pts.length > 1 ? pts : [pts[0], pts[0]];
    src.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: lineCoords },
        },
        ...pts.map(([lng, lat]) => ({
          type: "Feature" as const,
          properties: {},
          geometry: { type: "Point" as const, coordinates: [lng, lat] },
        })),
      ],
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function clearDrawPreview(map: any) {
    const src = map.getSource("draw-preview");
    if (src) src.setData({ type: "FeatureCollection", features: [] });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function fitAllFeatures(map: any, fc: FeatureCollection) {
    // Collect all coordinates
    let minLon = Infinity,
      minLat = Infinity,
      maxLon = -Infinity,
      maxLat = -Infinity;
    let has = false;
    function walk(c: unknown) {
      if (!Array.isArray(c)) return;
      if (typeof c[0] === "number") {
        const [lon, lat] = c as number[];
        minLon = Math.min(minLon, lon);
        minLat = Math.min(minLat, lat);
        maxLon = Math.max(maxLon, lon);
        maxLat = Math.max(maxLat, lat);
        has = true;
      } else c.forEach(walk);
    }
    fc.features.forEach((f) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (f.geometry) walk((f.geometry as any).coordinates ?? []);
    });
    if (!has) return;
    if (Math.abs(maxLon - minLon) < 1e-8 && Math.abs(maxLat - minLat) < 1e-8) {
      map.flyTo({ center: [minLon, minLat], zoom: 14 });
    } else {
      map.fitBounds(
        [
          [minLon, minLat],
          [maxLon, maxLat],
        ],
        { padding: 60, duration: 800, maxZoom: 18 }
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Edit-mode actions
  // ---------------------------------------------------------------------------

function handleDeleteSelected() {
  if (selectedIndex == null || selectedIndex < 0) return;
  const targetFeature = editedFC.features[selectedIndex];
  const targetOriginalIndex = targetFeature?.properties?._originalIndex as number | undefined;

  const updated: FeatureCollection = {
    ...editedFC,
    features: editedFC.features.filter((f, i) =>
      targetOriginalIndex != null
        ? f.properties?._originalIndex !== targetOriginalIndex
        : i !== selectedIndex
    ),
  };
  editedFCRef.current = updated;
  setEditedFC(updated);
  onSelectFeature(-1);
}

  function handleOpenAttrEdit() {
    if (selectedIndex == null || selectedIndex < 0) return;
    const feature = editedFC.features[selectedIndex];
    if (!feature) return;
    const props: Record<string, string> = {};
    Object.entries(feature.properties ?? {}).forEach(([k, v]) => {
      if (!k.startsWith("_")) props[k] = String(v ?? "");
    });
    setAttrEdit({ featureIndex: selectedIndex, properties: props });
  }

  function handleAttrSave() {
    if (!attrEdit) return;
    const updated: FeatureCollection = {
      ...editedFC,
      features: editedFC.features.map((f, i) =>
        i === attrEdit.featureIndex
          ? { ...f, properties: { ...attrEdit.properties } }
          : f
      ),
    };
    editedFCRef.current = updated;
    setEditedFC(updated);
    setAttrEdit(null);
  }

  function handleSaveEdits() {
    // Cancel any in-progress drawing
    drawPointsRef.current = [];
    setDrawPoints([]);
    setDrawTool("none");
    if (mapRef.current && mapLoadedRef.current) {
      clearDrawPreview(mapRef.current);
    }
    onSave(editedFC);
    setIsEditing(false);
  }

  function handleCancelEdits() {
    drawPointsRef.current = [];
    setDrawPoints([]);
    setDrawTool("none");
    if (mapRef.current && mapLoadedRef.current) {
      clearDrawPreview(mapRef.current);
    }
    editedFCRef.current = featureCollection;
    setEditedFC(featureCollection);
    setIsEditing(false);
  }

  function cancelDraw() {
    drawPointsRef.current = [];
    setDrawPoints([]);
    setDrawTool("none");
    if (mapRef.current && mapLoadedRef.current) {
      clearDrawPreview(mapRef.current);
    }
  }

  function handleLegendClick(filter: LegendFilter) {
    setLegendFilter((prev) => (prev === filter ? null : filter));
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const hasSelection = selectedIndex != null && selectedIndex >= 0;

  return (
    <div className="relative w-full h-full">
      {/* Map container */}
      <div ref={mapContainer} className="w-full h-full" />

      {/* ------------------------------------------------------------------ */}
      {/* Top-right toolbar                                                   */}
      {/* ------------------------------------------------------------------ */}
      <div className="absolute top-3 right-3 z-10 flex flex-col gap-2">
        {!isEditing ? (
          <button
            onClick={() => setIsEditing(true)}
            className="flex items-center gap-1.5 text-xs bg-slate-900/90 backdrop-blur border border-slate-600 text-slate-200 px-3 py-1.5 rounded-lg hover:bg-slate-800 transition-colors shadow-lg"
          >
            <Pencil className="w-3.5 h-3.5" />
            Edit
          </button>
        ) : (
          <>
            {/* Draw tools */}
            <div className="flex gap-1.5 bg-slate-900/90 backdrop-blur border border-slate-700 rounded-lg p-1.5 shadow-lg">
              <button
                title="Draw polygon (click vertices, double-click to close)"
                onClick={() => setDrawTool((t) => (t === "polygon" ? "none" : "polygon"))}
                className={[
                  "flex items-center gap-1 text-[11px] px-2 py-1 rounded transition-colors",
                  drawTool === "polygon"
                    ? "bg-amber-500 text-slate-900 font-semibold"
                    : "text-slate-300 hover:bg-slate-700",
                ].join(" ")}
              >
                <Pentagon className="w-3.5 h-3.5" />
                Polygon
              </button>
              <button
                title="Draw point (single click)"
                onClick={() => setDrawTool((t) => (t === "point" ? "none" : "point"))}
                className={[
                  "flex items-center gap-1 text-[11px] px-2 py-1 rounded transition-colors",
                  drawTool === "point"
                    ? "bg-amber-500 text-slate-900 font-semibold"
                    : "text-slate-300 hover:bg-slate-700",
                ].join(" ")}
              >
                <Dot className="w-3.5 h-3.5" />
                Point
              </button>
              {drawTool !== "none" && (
                <button
                  title="Cancel drawing"
                  onClick={cancelDraw}
                  className="flex items-center gap-1 text-[11px] px-2 py-1 rounded text-red-300 hover:bg-slate-700 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Selection actions */}
            {hasSelection && (
              <div className="flex gap-1.5 bg-slate-900/90 backdrop-blur border border-slate-700 rounded-lg p-1.5 shadow-lg">
                <button
                  title="Edit attributes of selected feature"
                  onClick={handleOpenAttrEdit}
                  className="flex items-center gap-1 text-[11px] px-2 py-1 rounded text-blue-300 hover:bg-slate-700 transition-colors"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  Attributes
                </button>
                <button
                  title="Delete selected feature"
                  onClick={handleDeleteSelected}
                  className="flex items-center gap-1 text-[11px] px-2 py-1 rounded text-red-300 hover:bg-slate-700 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete #{selectedIndex}
                </button>
              </div>
            )}

            {/* Save / Cancel */}
            <div className="flex gap-1.5">
              <button
                onClick={handleSaveEdits}
                className="flex items-center gap-1.5 text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-500 transition-colors shadow-lg"
              >
                <Check className="w-3.5 h-3.5" />
                Save
              </button>
              <button
                onClick={handleCancelEdits}
                className="flex items-center gap-1.5 text-xs bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg hover:bg-slate-600 transition-colors shadow-lg"
              >
                <X className="w-3.5 h-3.5" />
                Cancel
              </button>
            </div>
          </>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Draw-in-progress instruction banner                                 */}
      {/* ------------------------------------------------------------------ */}
      {drawTool === "polygon" && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 bg-amber-500/90 text-slate-900 text-xs font-semibold px-4 py-1.5 rounded-full shadow-lg pointer-events-none">
          {drawPoints.length === 0
            ? "Click to start polygon"
            : drawPoints.length < 3
            ? `${drawPoints.length} point${drawPoints.length > 1 ? "s" : ""} — keep clicking`
            : `${drawPoints.length} points — double-click to close`}
        </div>
      )}
      {drawTool === "point" && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 bg-amber-500/90 text-slate-900 text-xs font-semibold px-4 py-1.5 rounded-full shadow-lg pointer-events-none">
          Click map to place point
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Clickable legend                                                     */}
      {/* ------------------------------------------------------------------ */}
      <div className="absolute bottom-3 left-3 z-10 bg-slate-900/90 backdrop-blur border border-slate-700 rounded-lg px-3 py-2 text-[10px] space-y-1.5">
        {legendFilter !== null && (
          <p className="text-[9px] text-slate-400 mb-1 text-center">click to reset</p>
        )}
        {LEGEND_ITEMS.map(({ color, label, filter }) => {
          const isActive = legendFilter === filter;
          const isDimmed = legendFilter !== null && !isActive;
          return (
            <button
              key={label}
              onClick={() => handleLegendClick(filter)}
              className={[
                "flex items-center gap-2 w-full rounded px-1 py-0.5 transition-all",
                isActive ? "ring-1 ring-white/30 bg-white/5" : "",
                isDimmed ? "opacity-40" : "hover:bg-white/5",
              ].join(" ")}
              title={isActive ? "Click to show all" : `Filter to ${label} only`}
            >
              <div
                className="w-3 h-3 rounded-sm flex-shrink-0 transition-all"
                style={{
                  backgroundColor: color,
                  opacity: isDimmed ? 0.4 : 1,
                }}
              />
              <span className={isDimmed ? "text-slate-500" : "text-slate-300"}>{label}</span>
              {isActive && (
                <span className="ml-auto text-[8px] text-white/50">✓</span>
              )}
            </button>
          );
        })}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Attribute edit modal                                                 */}
      {/* ------------------------------------------------------------------ */}
      {attrEdit && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-800 border border-slate-600 rounded-xl shadow-2xl w-80 max-h-[70%] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
              <h3 className="text-sm font-semibold">
                Edit Attributes — Feature #{attrEdit.featureIndex}
              </h3>
              <button
                onClick={() => setAttrEdit(null)}
                className="text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {Object.entries(attrEdit.properties).map(([key, value]) => (
                <div key={key}>
                  <label className="block text-[10px] text-slate-400 mb-1 font-mono">
                    {key}
                  </label>
                  <input
                    type="text"
                    value={value}
                    onChange={(e) =>
                      setAttrEdit((prev) =>
                        prev
                          ? {
                              ...prev,
                              properties: { ...prev.properties, [key]: e.target.value },
                            }
                          : null
                      )
                    }
                    className="w-full bg-slate-900 border border-slate-600 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-green-500 transition-colors"
                  />
                </div>
              ))}

              {/* Add new property */}
              <AddPropertyRow
                onAdd={(key, value) =>
                  setAttrEdit((prev) =>
                    prev
                      ? { ...prev, properties: { ...prev.properties, [key]: value } }
                      : null
                  )
                }
              />
            </div>

            <div className="flex gap-2 px-4 py-3 border-t border-slate-700">
              <button
                onClick={handleAttrSave}
                className="flex-1 bg-green-600 hover:bg-green-500 text-white text-xs font-medium py-1.5 rounded-lg transition-colors"
              >
                Apply
              </button>
              <button
                onClick={() => setAttrEdit(null)}
                className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-medium py-1.5 rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: add a new key/value property row
// ---------------------------------------------------------------------------

function AddPropertyRow({ onAdd }: { onAdd: (key: string, value: string) => void }) {
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");

  function handleAdd() {
    const trimmed = key.trim();
    if (!trimmed) return;
    onAdd(trimmed, value);
    setKey("");
    setValue("");
  }

  return (
    <div className="pt-2 border-t border-slate-700">
      <p className="text-[10px] text-slate-500 mb-1.5">Add property</p>
      <div className="flex gap-1.5">
        <input
          type="text"
          placeholder="key"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          className="flex-1 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-green-500 font-mono"
        />
        <input
          type="text"
          placeholder="value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          className="flex-1 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-green-500"
        />
        <button
          onClick={handleAdd}
          className="bg-slate-700 hover:bg-slate-600 text-white text-xs px-2 rounded transition-colors"
        >
          +
        </button>
      </div>
    </div>
  );
}