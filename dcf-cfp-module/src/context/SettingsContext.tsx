"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import type { SettingsState, LLMProvider } from "@/types/cfp";

// =============================================================================
// Defaults & localStorage key
// =============================================================================
const STORAGE_KEY = "dcf-cfp-settings";

const defaultSettings: SettingsState = {
  llmProvider: "claude",
  claudeApiKey: "",
  geminiApiKey: "",
};

// =============================================================================
// Context value
// =============================================================================
interface SettingsContextValue {
  settings: SettingsState;
  updateSettings: (partial: Partial<SettingsState>) => void;
  /** The API key for the currently selected provider. */
  activeApiKey: string;
}

const SettingsContext = createContext<SettingsContextValue | undefined>(undefined);

// =============================================================================
// Provider
// =============================================================================
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<SettingsState>(defaultSettings);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage on mount (SSR-safe)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<SettingsState>;
        setSettings((prev) => ({ ...prev, ...parsed }));
      }
    } catch {
      // localStorage unavailable or corrupt — keep defaults
    }
    setHydrated(true);
  }, []);

  // Persist to localStorage on every change (after initial hydration)
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // localStorage full or unavailable
    }
  }, [settings, hydrated]);

  const updateSettings = useCallback((partial: Partial<SettingsState>) => {
    setSettings((prev) => ({ ...prev, ...partial }));
  }, []);

  const activeApiKey =
    settings.llmProvider === "claude"
      ? settings.claudeApiKey
      : settings.geminiApiKey;

  return (
    <SettingsContext.Provider value={{ settings, updateSettings, activeApiKey }}>
      {children}
    </SettingsContext.Provider>
  );
}

// =============================================================================
// Hook
// =============================================================================
export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error("useSettings must be used within a <SettingsProvider>");
  }
  return ctx;
}
