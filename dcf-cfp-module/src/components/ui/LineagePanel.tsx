import { GitBranch } from "lucide-react";

// Shared lineage panel primitives used by Steps 2–7.
// Step 1 has its own inline version; this file provides the reusable wrappers.

export function LineagePanel({
  approved,
  flowsTo,
  children,
}: {
  approved: boolean;
  flowsTo: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`rounded-lg border p-4 ${
        approved
          ? "border-emerald-700/40 bg-emerald-950/10"
          : "border-zinc-700/60 bg-zinc-900/40"
      }`}
    >
      <div className="mb-3 flex items-center gap-2">
        <GitBranch size={15} className={approved ? "text-emerald-400" : "text-zinc-400"} />
        <span
          className={`text-xs font-semibold uppercase tracking-wide ${
            approved ? "text-emerald-300" : "text-zinc-300"
          }`}
        >
          Data Lineage — What This Step Locks In
        </span>
        <span
          className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium ${
            approved
              ? "bg-emerald-600/20 text-emerald-300"
              : "bg-zinc-700/50 text-zinc-400"
          }`}
        >
          {approved ? `Locked · ${flowsTo}` : "Pending approval"}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">{children}</div>
    </section>
  );
}

export function LineageCard({
  label,
  sublabel,
  approved,
  children,
}: {
  label: string;
  sublabel: string;
  approved: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        approved
          ? "border-emerald-800/30 bg-emerald-950/20"
          : "border-zinc-800 bg-zinc-950/50"
      }`}
    >
      <p className="mb-0.5 text-xs font-medium text-zinc-300">{label}</p>
      <p className="mb-2 text-xs text-zinc-500">{sublabel}</p>
      {children}
    </div>
  );
}
