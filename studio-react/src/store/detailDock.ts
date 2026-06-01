import { create } from "zustand";

/**
 * Visibility + width of the right-hand detail dock. Persisted to localStorage so
 * the user's preference survives reloads (mirrors how the theme store persists).
 */

const OPEN_KEY = "studio-react.detailDock.open";
const WIDTH_KEY = "studio-react.detailDock.width";

const MIN = 240;
const MAX = 560;

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) !== "false";
  } catch {
    return true;
  }
}

function readWidth(): number {
  try {
    const raw = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(raw) && raw >= MIN && raw <= MAX ? raw : 320;
  } catch {
    return 320;
  }
}

interface DetailDockState {
  open: boolean;
  width: number;
  toggle: () => void;
  setOpen: (open: boolean) => void;
  setWidth: (w: number) => void;
}

export const useDetailDockStore = create<DetailDockState>((set) => ({
  open: readOpen(),
  width: readWidth(),
  toggle: () =>
    set((s) => {
      const open = !s.open;
      try {
        localStorage.setItem(OPEN_KEY, String(open));
      } catch {
        /* ignore */
      }
      return { open };
    }),
  setOpen: (open) => {
    try {
      localStorage.setItem(OPEN_KEY, String(open));
    } catch {
      /* ignore */
    }
    set({ open });
  },
  setWidth: (w) => {
    const width = Math.max(MIN, Math.min(MAX, w));
    try {
      localStorage.setItem(WIDTH_KEY, String(width));
    } catch {
      /* ignore */
    }
    set({ width });
  },
}));
