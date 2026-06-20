"use client";

/**
 * Summary metric cards shown after file upload.
 */

import { CheckCircle, XCircle, Copy, Layers } from "lucide-react";
import type { AnalysisSummary } from "@/types";

interface SummaryCardsProps {
  summary: AnalysisSummary;
}

export function SummaryCards({ summary }: SummaryCardsProps) {
  const cards = [
    {
      label: "Total Features",
      value: summary.total_features,
      icon: Layers,
      color: "text-blue-400",
      bg: "bg-blue-500/10 border-blue-500/20",
    },
    {
      label: "Valid",
      value: summary.valid_features,
      icon: CheckCircle,
      color: "text-green-400",
      bg: "bg-green-500/10 border-green-500/20",
    },
    {
      label: "Issues",
      value: summary.invalid_features,
      icon: XCircle,
      color: "text-red-400",
      bg: "bg-red-500/10 border-red-500/20",
    },
    {
      label: "Duplicate Groups",
      value: summary.duplicate_groups,
      icon: Copy,
      color: "text-purple-400",
      bg: "bg-purple-500/10 border-purple-500/20",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {cards.map(({ label, value, icon: Icon, color, bg }) => (
        <div key={label} className={`flex items-center gap-3 rounded-xl border p-4 ${bg}`}>
          <Icon className={`h-5 w-5 flex-shrink-0 ${color}`} />
          <div>
            <p className="text-2xl leading-none font-bold">{value}</p>
            <p className="mt-1 text-xs text-slate-400">{label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
