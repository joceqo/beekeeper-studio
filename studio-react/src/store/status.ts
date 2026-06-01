import { create } from "zustand";

export interface StatusSummary {
  elapsedMs: number;
  loaded: number;
  total: number;
}

interface StatusState extends StatusSummary {
  set: (s: StatusSummary) => void;
}

export const useStatusStore = create<StatusState>((set) => ({
  elapsedMs: 1860,
  loaded: 100,
  total: 299,
  set: (s) => set(s),
}));
