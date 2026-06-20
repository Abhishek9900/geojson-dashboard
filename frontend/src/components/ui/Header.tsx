"use client";

/**
 * Dashboard header with logo, current filename, and action buttons.
 */

import { Download, RotateCcw, MapPin, Save } from "lucide-react";

interface HeaderProps {
  filename: string | null;
  onReset: () => void;
  onDownload?: () => void;
  onSave?: () => void;
  hasUnsavedChanges: boolean;
  isSaving: boolean;
}

export function Header({
  filename,
  onReset,
  onDownload,
  onSave,
  hasUnsavedChanges,
  isSaving,
}: HeaderProps) {
  return (
    <header className="sticky top-0 z-50 border-b border-slate-700 bg-slate-900/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between gap-4 px-4 md:px-6">
        {/* Brand */}
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-green-500">
            <MapPin className="h-4 w-4 text-white" />
          </div>
          <span className="text-sm font-semibold tracking-tight">GeoJSON Farm Dashboard</span>
          {filename && (
            <span className="hidden max-w-[220px] items-center gap-1 truncate rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-xs text-slate-400 sm:inline-flex">
              {filename}
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {onSave && hasUnsavedChanges && (
            <button
              onClick={onSave}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-500"
              disabled={isSaving}
            >
              <Save className="h-3.5 w-3.5" />
              Save
            </button>
          )}
          {onDownload && (
            <button
              onClick={onDownload}
              className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-green-500"
            >
              <Download className="h-3.5 w-3.5" />
              Download
            </button>
          )}
          {filename && (
            <button
              onClick={onReset}
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-slate-700"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              New File
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
