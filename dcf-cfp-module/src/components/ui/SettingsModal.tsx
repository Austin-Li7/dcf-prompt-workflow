"use client";

import { useEffect, useRef, useState } from "react";
import {
  X,
  Settings,
  Cpu,
  KeyRound,
  Check,
  AlertCircle,
  FolderOpen,
  Upload,
  Download,
  Trash2,
  RotateCcw,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { useSettings } from "@/context/SettingsContext";
import { useCFP } from "@/context/CFPContext";
import type { LLMProvider } from "@/types/cfp";
import type { CompanySave } from "@/types/cfp";
import {
  getAllSaves,
  deleteSave,
  clearAllCompanySaves,
  downloadSave,
  parseSaveFile,
} from "@/lib/company-saves";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatIntrinsic(save: CompanySave): string {
  const v = save.snapshot.intrinsicValuePerShare;
  if (v === null || v === undefined) return "—";
  const currency = save.cfpState.profile.currency ?? "USD";
  return `${currency} ${v.toFixed(2)}`;
}

// ── Sub-component: one save row ───────────────────────────────────────────────

function SaveRow({
  save,
  onLoad,
  onDownload,
  onDelete,
}: {
  save: CompanySave;
  onLoad: (s: CompanySave) => void;
  onDownload: (s: CompanySave) => void;
  onDelete: (saveId: string) => void;
}) {
  const decisionColor: Record<string, string> = {
    BUY: "text-emerald-400",
    WATCH: "text-amber-400",
    AVOID: "text-red-400",
    INSUFFICIENT_DATA: "text-zinc-500",
  };
  const action = save.snapshot.decisionAction ?? "INSUFFICIENT_DATA";

  return (
    <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5">
      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-semibold text-zinc-100">{save.companyName}</span>
          <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
            v{save.version}
          </span>
          <span className={`shrink-0 text-xs font-medium ${decisionColor[action] ?? "text-zinc-500"}`}>
            {action === "BUY" ? "BUY" : action === "AVOID" ? "AVOID" : action === "WATCH" ? "WATCH" : "—"}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-500">
          <span>{save.ticker}</span>
          <span>·</span>
          <span>{formatDate(save.savedAt)}</span>
          <span>·</span>
          <span>Intrinsic: {formatIntrinsic(save)}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1">
        {/* Load */}
        <button
          onClick={() => onLoad(save)}
          title="Restore this analysis"
          className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-blue-400 hover:bg-blue-900/30 hover:text-blue-300"
        >
          <RotateCcw size={12} />
          Load
        </button>
        {/* Download */}
        <button
          onClick={() => onDownload(save)}
          title="Download as JSON"
          className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
        >
          <Download size={13} />
        </button>
        {/* Delete */}
        <button
          onClick={() => onDelete(save.saveId)}
          title="Delete this save"
          className="rounded p-1.5 text-zinc-500 hover:bg-red-900/30 hover:text-red-400"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { settings, updateSettings } = useSettings();
  const { dispatch } = useCFP();

  // ── Company-saves state ──────────────────────────────────────────────────
  const [saves, setSaves] = useState<CompanySave[]>([]);
  const [savesOpen, setSavesOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [clearConfirm, setClearConfirm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load saves from IndexedDB whenever the section is expanded
  useEffect(() => {
    if (!open || !savesOpen) return;
    getAllSaves().then(setSaves).catch(() => setSaves([]));
  }, [open, savesOpen]);

  // Reset transient state when modal closes
  useEffect(() => {
    if (!open) {
      setLoadError(null);
      setClearConfirm(false);
    }
  }, [open]);

  if (!open) return null;

  const hasClaudeKey = settings.claudeApiKey.trim().length > 0;
  const hasGeminiKey = settings.geminiApiKey.trim().length > 0;

  // ── Handlers ─────────────────────────────────────────────────────────────

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so same file can be re-selected
    if (!file) return;
    setLoadError(null);
    try {
      const save = await parseSaveFile(file);
      dispatch({ type: "RESTORE_STATE", payload: save.cfpState });
      onClose();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load file.");
    }
  }

  async function handleLoadSave(save: CompanySave) {
    dispatch({ type: "RESTORE_STATE", payload: save.cfpState });
    onClose();
  }

  async function handleDeleteSave(saveId: string) {
    await deleteSave(saveId);
    setSaves((prev) => prev.filter((s) => s.saveId !== saveId));
  }

  async function handleClearAll() {
    if (!clearConfirm) {
      setClearConfirm(true);
      return;
    }
    await clearAllCompanySaves();
    setSaves([]);
    setClearConfirm(false);
  }

  // Group saves by ticker for display (each group sorted newest-first already)
  const grouped: Record<string, CompanySave[]> = {};
  for (const save of saves) {
    (grouped[save.ticker] = grouped[save.ticker] ?? []).push(save);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="relative mx-4 w-full max-w-lg rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
        >
          <X size={18} />
        </button>

        {/* Header */}
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600/20">
            <Settings size={20} className="text-blue-400" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-zinc-100">Settings</h3>
            <p className="text-xs text-zinc-500">Configure your AI engine and API keys</p>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="max-h-[70vh] overflow-y-auto pr-1">
          <div className="space-y-5">
            {/* Provider selector */}
            <div>
              <label className="mb-1.5 flex items-center gap-2 text-sm font-medium text-zinc-300">
                <Cpu size={14} /> Active AI Engine
              </label>
              <select
                value={settings.llmProvider}
                onChange={(e) => updateSettings({ llmProvider: e.target.value as LLMProvider })}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm text-zinc-100 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              >
                <option value="claude">Claude Sonnet 4 (Anthropic)</option>
                <option value="gemini">Gemini 2.5 Pro (Google)</option>
              </select>
            </div>

            {/* Anthropic key */}
            <div>
              <label className="mb-1.5 flex items-center gap-2 text-sm font-medium text-zinc-300">
                <KeyRound size={14} />
                Anthropic API Key
                <span className={`ml-auto flex items-center gap-1 text-xs ${hasClaudeKey ? "text-emerald-400" : "text-zinc-600"}`}>
                  {hasClaudeKey ? <><Check size={10} /> Configured</> : <><AlertCircle size={10} /> Not set</>}
                </span>
              </label>
              <input
                type="password"
                autoComplete="off"
                placeholder="sk-ant-..."
                value={settings.claudeApiKey}
                onChange={(e) => updateSettings({ claudeApiKey: e.target.value })}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Gemini key */}
            <div>
              <label className="mb-1.5 flex items-center gap-2 text-sm font-medium text-zinc-300">
                <KeyRound size={14} />
                Google Gemini API Key
                <span className={`ml-auto flex items-center gap-1 text-xs ${hasGeminiKey ? "text-emerald-400" : "text-zinc-600"}`}>
                  {hasGeminiKey ? <><Check size={10} /> Configured</> : <><AlertCircle size={10} /> Not set</>}
                </span>
              </label>
              <input
                type="password"
                autoComplete="off"
                placeholder="AI..."
                value={settings.geminiApiKey}
                onChange={(e) => updateSettings({ geminiApiKey: e.target.value })}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Helper text */}
            <p className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-500">
              Keys are stored securely in your browser&apos;s local storage and are never saved to a database.
              Server-side <code className="rounded bg-zinc-800 px-1">.env</code> keys are used as a fallback
              if no browser key is set.
            </p>

            {/* ── Company Analyses ───────────────────────────────────────────── */}
            <div className="rounded-xl border border-zinc-700 bg-zinc-800/50">
              {/* Collapsible header */}
              <button
                type="button"
                onClick={() => setSavesOpen((v) => !v)}
                className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left hover:bg-zinc-700/40"
              >
                <FolderOpen size={15} className="shrink-0 text-blue-400" />
                <span className="flex-1 text-sm font-medium text-zinc-200">Company Analyses</span>
                {saves.length > 0 && (
                  <span className="rounded-full bg-blue-600/20 px-2 py-0.5 text-[11px] text-blue-300">
                    {saves.length}
                  </span>
                )}
                {savesOpen ? (
                  <ChevronDown size={14} className="text-zinc-500" />
                ) : (
                  <ChevronRight size={14} className="text-zinc-500" />
                )}
              </button>

              {savesOpen && (
                <div className="space-y-3 border-t border-zinc-700 px-4 pb-4 pt-3">
                  {/* Upload JSON */}
                  <div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".json"
                      className="hidden"
                      onChange={handleFileUpload}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-600 bg-zinc-900 px-4 py-2.5 text-sm text-zinc-400 transition-colors hover:border-blue-500 hover:bg-blue-950/20 hover:text-blue-300"
                    >
                      <Upload size={14} />
                      Load analysis from JSON file
                    </button>
                    {loadError && (
                      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-red-400">
                        <AlertCircle size={11} />
                        {loadError}
                      </p>
                    )}
                  </div>

                  {/* Saves list */}
                  {saves.length === 0 ? (
                    <p className="py-2 text-center text-xs text-zinc-600">
                      No saved analyses yet. Complete a valuation to create one.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {Object.entries(grouped).map(([ticker, tickerSaves]) => (
                        <div key={ticker}>
                          {Object.keys(grouped).length > 1 && (
                            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                              {ticker}
                            </p>
                          )}
                          {tickerSaves.map((save) => (
                            <SaveRow
                              key={save.saveId}
                              save={save}
                              onLoad={handleLoadSave}
                              onDownload={downloadSave}
                              onDelete={handleDeleteSave}
                            />
                          ))}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Clear all */}
                  {saves.length > 0 && (
                    <button
                      type="button"
                      onClick={handleClearAll}
                      className={`flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                        clearConfirm
                          ? "bg-red-700 text-white hover:bg-red-600"
                          : "bg-zinc-900 text-zinc-500 hover:bg-red-900/20 hover:text-red-400"
                      }`}
                    >
                      <Trash2 size={11} />
                      {clearConfirm ? "Tap again to confirm — this cannot be undone" : "Clear all saved analyses"}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Save & Close */}
            <button
              onClick={onClose}
              className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-500"
            >
              Save &amp; Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
