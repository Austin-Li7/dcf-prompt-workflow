"use client";

import type { BusinessType } from "@/types/wacc";

interface ModeConfig {
  label: string;
  description: string;
  borderColor: string;
  bgColor: string;
  textColor: string;
  dotColor: string;
}

const MODE_CONFIG: Record<BusinessType, ModeConfig> = {
  single: {
    label: "Single Business",
    description: "One beta → Hamada re-lever → WACC",
    borderColor: "border-blue-700/40",
    bgColor: "bg-blue-950/20",
    textColor: "text-blue-300",
    dotColor: "bg-blue-400",
  },
  conglomerate: {
    label: "Conglomerate",
    description: "Value-weighted blended beta → WACC",
    borderColor: "border-purple-700/40",
    bgColor: "bg-purple-950/20",
    textColor: "text-purple-300",
    dotColor: "bg-purple-400",
  },
  financial: {
    label: "Financial / Bank",
    description: "Ke-only · no D/E re-levering · equity DCF",
    borderColor: "border-amber-700/40",
    bgColor: "bg-amber-950/20",
    textColor: "text-amber-300",
    dotColor: "bg-amber-400",
  },
  hybrid: {
    label: "Hybrid · Sum-of-Parts",
    description: "Bank segments → Ke  ·  Industrial segments → WACC",
    borderColor: "border-teal-700/40",
    bgColor: "bg-teal-950/20",
    textColor: "text-teal-300",
    dotColor: "bg-teal-400",
  },
};

interface StepModeIndicatorProps {
  businessType: BusinessType;
  /** Optional extra context string (e.g. company name or segment count). */
  context?: string;
}

export default function StepModeIndicator({ businessType, context }: StepModeIndicatorProps) {
  const cfg = MODE_CONFIG[businessType];

  return (
    <div className={`flex items-center gap-3 rounded-lg border px-4 py-2.5 ${cfg.borderColor} ${cfg.bgColor}`}>
      <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${cfg.dotColor}`} />
      <div className="min-w-0 flex-1">
        <span className={`text-xs font-semibold uppercase tracking-wider ${cfg.textColor}`}>
          {cfg.label}
        </span>
        <span className="mx-2 text-zinc-600">·</span>
        <span className="text-xs text-zinc-500">{cfg.description}</span>
        {context && (
          <span className="ml-2 text-xs text-zinc-600">— {context}</span>
        )}
      </div>
    </div>
  );
}
