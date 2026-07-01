"use client";
/**
 * Persistent storage for company analyses (Module 1 + Module 2).
 *
 * Storage:
 *   IndexedDB  →  "dcf-company-saves-v1" / store "saves"
 *     keyPath  : saveId (UUID)
 *     index    : "byTicker" on ticker field
 *
 * Versioning:
 *   Every save for a given ticker gets an incrementing version number.
 *   All historical versions are retained — none are ever auto-deleted.
 */

import type { CFPState, CompanySave, ValuationSnapshot } from "@/types/cfp";
import { downloadJsonFile } from "@/lib/download-json";

// =============================================================================
// Constants
// =============================================================================

const DB_NAME    = "dcf-company-saves-v1";
const DB_VERSION = 1;
const STORE      = "saves";

// =============================================================================
// DB open / upgrade
// =============================================================================

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "saveId" });
        store.createIndex("byTicker",   "ticker",   { unique: false });
        store.createIndex("bySavedAt",  "savedAt",  { unique: false });
      }
    };

    req.onsuccess  = () => resolve(req.result);
    req.onerror    = () => reject(req.error);
  });
}

// =============================================================================
// Helpers
// =============================================================================

function uuid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments that don't support randomUUID
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Next sequential version for a given ticker. */
async function nextVersion(db: IDBDatabase, ticker: string): Promise<number> {
  const existing = await getSavesByTicker(db, ticker);
  if (existing.length === 0) return 1;
  return Math.max(...existing.map((s) => s.version)) + 1;
}

function getAllFromStore(db: IDBDatabase): Promise<CompanySave[]> {
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const req   = store.getAll();
    req.onsuccess = () => resolve(req.result as CompanySave[]);
    req.onerror   = () => reject(req.error);
  });
}

function getSavesByTicker(db: IDBDatabase, ticker: string): Promise<CompanySave[]> {
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE, "readonly");
    const index = tx.objectStore(STORE).index("byTicker");
    const req   = index.getAll(IDBKeyRange.only(ticker));
    req.onsuccess = () => resolve(req.result as CompanySave[]);
    req.onerror   = () => reject(req.error);
  });
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Persist a new versioned save for the current session.
 * Returns the completed CompanySave record (including the assigned version).
 */
export async function saveCompanyAnalysis(
  cfpState: CFPState,
  snapshot: ValuationSnapshot,
): Promise<CompanySave> {
  const db      = await openDb();
  const ticker  = (cfpState.profile.ticker || "UNKNOWN").toUpperCase();
  const version = await nextVersion(db, ticker);

  const save: CompanySave = {
    saveId:      uuid(),
    companyName: cfpState.profile.companyName || ticker,
    ticker,
    savedAt:     new Date().toISOString(),
    version,
    cfpState,
    snapshot,
  };

  await new Promise<void>((resolve, reject) => {
    const tx  = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).put(save);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });

  return save;
}

/**
 * Return ALL saves sorted newest-first.
 * Grouped display (by company) is left to the UI layer.
 */
export async function getAllSaves(): Promise<CompanySave[]> {
  const db   = await openDb();
  const all  = await getAllFromStore(db);
  return all.sort(
    (a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime(),
  );
}

/** Delete a single save by its UUID. */
export async function deleteSave(saveId: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx  = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).delete(saveId);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

/** Wipe every save — used from Settings "Clear all". */
export async function clearAllCompanySaves(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx  = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).clear();
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

// =============================================================================
// JSON export / import helpers (no IndexedDB needed)
// =============================================================================

/** Generate a human-readable download filename for a save. */
export function saveFilename(save: CompanySave): string {
  const d    = new Date(save.savedAt);
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, "0");
  const dd   = String(d.getDate()).padStart(2, "0");
  const slug = save.ticker.toLowerCase().replace(/[^a-z0-9]/g, "-");
  return `${slug}-v${save.version}-${yyyy}-${mm}-${dd}.json`;
}

/** Trigger a browser download of the save as JSON. */
export function downloadSave(save: CompanySave): void {
  const json = JSON.stringify(save, null, 2);
  downloadJsonFile(saveFilename(save), json);
}

/** Build a compact JSON summary for review/sharing without the full workflow state. */
export function buildSaveSummary(save: CompanySave): Record<string, unknown> {
  const profile = save.cfpState.profile;
  return {
    saveId: save.saveId,
    companyName: save.companyName,
    ticker: save.ticker,
    savedAt: save.savedAt,
    version: save.version,
    companyProfile: {
      companyName: profile.companyName,
      ticker: profile.ticker,
      sector: profile.sector,
      industry: profile.industry,
      currency: profile.currency,
      lastUpdated: profile.lastUpdated,
    },
    valuationSnapshot: save.snapshot,
    completedState: {
      currentStep: save.cfpState.currentStep,
      step1Approved: Boolean(save.cfpState.profile.step1Review?.approved),
      historyYears: save.cfpState.history.confirmedYears,
      step3Approved: save.cfpState.competition.approved,
      synergiesApproved: save.cfpState.synergies.synergiesApproved,
      capitalApproved: save.cfpState.synergies.capitalApproved,
      forecastApproved: save.cfpState.forecast.approved,
      waccSaved: save.cfpState.wacc.saved,
    },
    keyAssumptions: {
      fcfMargin: save.snapshot.fcfMargin,
      terminalGrowth: save.snapshot.terminalGrowth,
      wacc: save.snapshot.wacc,
      valuationMode: save.snapshot.valuationMode,
      bankFcfMargin: save.snapshot.bankFcfMargin,
      industrialFcfMargin: save.snapshot.industrialFcfMargin,
      bankKe: save.snapshot.bankKe,
      industrialWacc: save.snapshot.industrialWacc,
    },
    marketData: save.cfpState.wacc.fetchedData
      ? {
          marketCap: save.cfpState.wacc.fetchedData.marketCap,
          currentPrice: save.cfpState.wacc.fetchedData.currentPrice,
          sharesOutstanding: save.cfpState.wacc.fetchedData.sharesOutstanding,
          totalCash: save.cfpState.wacc.fetchedData.totalCash,
          totalDebt: save.cfpState.wacc.fetchedData.totalDebt,
          riskFreeRate: save.cfpState.wacc.fetchedData.riskFreeRate,
          damodaranBeta: save.cfpState.wacc.fetchedData.damodaranBeta,
          damodaranIndustry: save.cfpState.wacc.fetchedData.damodaranIndustry,
        }
      : null,
  };
}

export function saveSummaryFilename(save: CompanySave): string {
  return saveFilename(save).replace(/\.json$/, "-summary.json");
}

/**
 * Parse a JSON file blob uploaded by the user.
 * Returns the CompanySave if the file looks valid, throws otherwise.
 */
export async function parseSaveFile(file: File): Promise<CompanySave> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("The file is not valid JSON.");
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("saveId"    in parsed) ||
    !("cfpState"  in parsed) ||
    !("snapshot"  in parsed) ||
    !("ticker"    in parsed)
  ) {
    throw new Error(
      "This file does not look like a DCF analysis export. " +
      "Make sure you upload a file downloaded from this tool.",
    );
  }

  return parsed as CompanySave;
}
