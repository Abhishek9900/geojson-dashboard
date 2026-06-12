"use client";

/**
 * Dashboard header with logo, current filename, and action buttons.
 */

import { Download, RotateCcw, MapPin, Save } from "lucide-react";

interface HeaderProps {
  filename: string | null;
  onReset: () => void;
  onDownload?: () => void;
  onAnalyse?: () => void;
  hasPending: boolean;
  isSaving: boolean;
}

export function Header({ filename, onReset, onDownload, onAnalyse, hasPending, isSaving }: HeaderProps) {
  return (
    <header className="border-b border-slate-700 bg-slate-900/80 backdrop-blur sticky top-0 z-50">
      <div className="max-w-[1600px] mx-auto px-4 md:px-6 h-14 flex items-center justify-between gap-4">
        {/* Brand */}
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-green-500 flex items-center justify-center flex-shrink-0">
            <MapPin className="w-4 h-4 text-white" />
          </div>
          <span className="font-semibold text-sm tracking-tight">
            GeoJSON Farm Dashboard
          </span>
          {filename && (
            <span className="hidden sm:inline-flex items-center gap-1 text-xs text-slate-400 bg-slate-800 border border-slate-700 px-2 py-0.5 rounded-full truncate max-w-[220px]">
              {filename}
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {onAnalyse && hasPending && (
            <button
              onClick={onAnalyse}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors"
              disabled={isSaving}
            >
              <Save className="w-3.5 h-3.5" />
              Save
            </button>
          )}
          {onDownload && (
            <button
              onClick={onDownload}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-500 text-white transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Download
            </button>
          )}
          {filename && (
            <button
              onClick={onReset}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              New File
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
