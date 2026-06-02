import { create } from "zustand";

/**
 * Global UI zoom (SlashTable `uiScale`). Applied to the document root as a
 * `zoom` factor so the whole shell scales uniformly; persisted to localStorage.
 * Steps are 10% in/out, clamped to a sane range, with a reset to 100%.
 */

const STORAGE_KEY = "studio-react.uiScale";
const MIN = 0.5;
const MAX = 2.0;
const STEP = 0.1;

function clamp(v: number): number {
  return Math.min(MAX, Math.max(MIN, Math.round(v * 100) / 100));
}

function apply(scale: number) {
  // `zoom` scales layout + fonts together and is supported in Chromium (the
  // Electron renderer this targets), so the panels/grid reflow correctly.
  (document.documentElement.style as CSSStyleDeclaration & { zoom?: string }).zoom =
    String(scale);
  try {
    localStorage.setItem(STORAGE_KEY, String(scale));
  } catch {
    /* ignore */
  }
}

function readInitial(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? clamp(n) : 1;
  } catch {
    return 1;
  }
}

const initial = readInitial();
apply(initial);

interface UiScaleState {
  scale: number;
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
  set: (v: number) => void;
}

export const useUiScaleStore = create<UiScaleState>((set, get) => ({
  scale: initial,
  zoomIn: () => {
    const next = clamp(get().scale + STEP);
    apply(next);
    set({ scale: next });
  },
  zoomOut: () => {
    const next = clamp(get().scale - STEP);
    apply(next);
    set({ scale: next });
  },
  reset: () => {
    apply(1);
    set({ scale: 1 });
  },
  set: (v) => {
    const next = clamp(v);
    apply(next);
    set({ scale: next });
  },
}));
