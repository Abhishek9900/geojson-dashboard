"use client";

/**
 * Drag-and-drop file upload zone for .geojson files.
 */

import { useCallback } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import { Upload, FileJson, Loader2 } from "lucide-react";
import type { UploadStatus } from "@/types";

interface UploadZoneProps {
  onUpload: (file: File) => void;
  status: UploadStatus;
  progress: number;
  error: string | null;
}

export function UploadZone({ onUpload, status, progress, error }: UploadZoneProps) {
  const onDrop = useCallback(
    (acceptedFiles: File[], fileRejections: FileRejection[]) => {
      if (fileRejections.length > 0) {
        return;
      }

      if (acceptedFiles[0]) {
        onUpload(acceptedFiles[0]);
      }
    },
    [onUpload]
  );

  const { getRootProps, getInputProps, isDragActive, fileRejections } = useDropzone({
    onDrop,
    accept: {
      "application/json": [".geojson"],
      "application/geo+json": [".geojson"],
    },
    maxFiles: 1,
    disabled: status === "uploading",
    // Allow large files — max 100 MB
    maxSize: 100 * 1024 * 1024,
  });

  const rejectionMessage = fileRejections[0]?.errors[0]?.message;

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4">
      <div className="w-full max-w-lg">
        {/* Dropzone */}
        <div
          {...getRootProps()}
          className={[
            "relative cursor-pointer rounded-2xl border-2 border-dashed p-12 text-center transition-all",
            isDragActive
              ? "scale-[1.02] border-green-500 bg-green-500/10"
              : "border-slate-600 bg-slate-900 hover:border-slate-500 hover:bg-slate-800/60",
            status === "uploading" ? "pointer-events-none opacity-75" : "",
          ].join(" ")}
        >
          <input {...getInputProps()} />

          <div className="flex flex-col items-center gap-4">
            {status === "uploading" ? (
              <Loader2 className="h-12 w-12 animate-spin text-green-400" />
            ) : isDragActive ? (
              <FileJson className="h-12 w-12 text-green-400" />
            ) : (
              <Upload className="h-12 w-12 text-slate-500" />
            )}

            <div>
              {status === "uploading" ? (
                <>
                  <p className="text-base font-medium text-slate-200">Processing... {progress}%</p>
                  <div className="mx-auto mt-3 h-1.5 w-48 overflow-hidden rounded-full bg-slate-700">
                    <div
                      className="h-full rounded-full bg-green-500 transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </>
              ) : isDragActive ? (
                <p className="text-base font-medium text-green-300">Drop your .geojson file here</p>
              ) : (
                <>
                  <p className="text-base font-medium text-slate-200">
                    Drag & drop a .geojson file
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    or{" "}
                    <span className="text-green-400 underline underline-offset-2">
                      browse to upload
                    </span>
                  </p>
                  <p className="mt-3 text-xs text-slate-600">
                    Only .geojson files accepted · Max 100 MB
                  </p>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Error display */}
        {(error || rejectionMessage) && (
          <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3">
            <p className="text-sm text-red-300">{error ?? rejectionMessage}</p>
          </div>
        )}
      </div>
    </div>
  );
}
