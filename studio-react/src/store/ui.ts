import { create } from "zustand";

/**
 * Cross-cutting transient UI state driven by the command palette + keybindings:
 * which overlays are open, the persisted vim-mode stub, and small "signal"
 * counters that let a command ask a mounted component to do something it owns
 * (focus the sidebar search, open the active table's filter bar) without the
 * command needing a ref to that component.
 */

const VIM_KEY = "studio-react.vimMode";

function readVim(): boolean {
  try {
    return localStorage.getItem(VIM_KEY) === "true";
  } catch {
    return false;
  }
}

interface UiState {
  paletteOpen: boolean;
  dbSwitcherOpen: boolean;
  settingsOpen: boolean;
  vimMode: boolean;

  /** Bumped to ask the sidebar to focus its search input. */
  focusSearchSignal: number;
  /** Bumped to ask the active table view to open its filter bar. */
  openFilterSignal: number;
  /** Optional target for a filter-open request, used to focus a newly-created condition. */
  openFilterRequest?: { signal: number; tabId?: string; nodeId?: string };

  setPaletteOpen: (open: boolean) => void;
  togglePalette: () => void;
  setDbSwitcherOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setVimMode: (v: boolean) => void;

  requestFocusSearch: () => void;
  requestOpenFilter: (request?: { tabId?: string; nodeId?: string }) => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  paletteOpen: false,
  dbSwitcherOpen: false,
  settingsOpen: false,
  vimMode: readVim(),

  focusSearchSignal: 0,
  openFilterSignal: 0,
  openFilterRequest: undefined,

  setPaletteOpen: (open) => set({ paletteOpen: open }),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),
  setDbSwitcherOpen: (open) => set({ dbSwitcherOpen: open }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setVimMode: (v) => {
    try {
      localStorage.setItem(VIM_KEY, String(v));
    } catch {
      /* ignore */
    }
    set({ vimMode: v });
  },

  requestFocusSearch: () => set({ focusSearchSignal: get().focusSearchSignal + 1 }),
  requestOpenFilter: (request) => {
    const signal = get().openFilterSignal + 1;
    set({
      openFilterSignal: signal,
      openFilterRequest: { signal, ...request },
    });
  },
}));
