import { Module } from "vuex";
import { State as RootState } from "../index";
import {
  ActivityCategory,
  ActivityEntry,
  ACTIVITY_CATEGORIES,
} from "@/lib/activity/ActivityLog";

/** Hard cap on retained entries - oldest are dropped past this. */
const MAX_ENTRIES = 1000;

type SeenMap = Record<ActivityCategory, number>;

function emptySeenMap(): SeenMap {
  return ACTIVITY_CATEGORIES.reduce((acc, category) => {
    acc[category] = 0;
    return acc;
  }, {} as SeenMap);
}

interface State {
  entries: ActivityEntry[];
  /** Currently selected category tab. */
  activeCategory: ActivityCategory;
  /** Highest entry id seen per category, for unseen-count badges. */
  lastSeenId: SeenMap;
}

export const ActivityModule: Module<State, RootState> = {
  namespaced: true,
  state: () => ({
    entries: [],
    activeCategory: "User",
    lastSeenId: emptySeenMap(),
  }),
  getters: {
    allEntries(state): ActivityEntry[] {
      return state.entries;
    },
    entriesByCategory(state) {
      return (category: ActivityCategory): ActivityEntry[] =>
        state.entries.filter((entry) => entry.category === category);
    },
    activeEntries(state): ActivityEntry[] {
      return state.entries.filter(
        (entry) => entry.category === state.activeCategory
      );
    },
    unseenCount(state) {
      return (category: ActivityCategory): number => {
        const seen = state.lastSeenId[category] ?? 0;
        let count = 0;
        for (const entry of state.entries) {
          if (entry.category === category && entry.id > seen) count++;
        }
        return count;
      };
    },
  },
  mutations: {
    push(state, entry: ActivityEntry) {
      state.entries.push(entry);
      const overflow = state.entries.length - MAX_ENTRIES;
      if (overflow > 0) {
        state.entries.splice(0, overflow);
      }
    },
    clear(state, category?: ActivityCategory) {
      if (category) {
        state.entries = state.entries.filter(
          (entry) => entry.category !== category
        );
      } else {
        state.entries = [];
      }
    },
    setActiveCategory(state, category: ActivityCategory) {
      state.activeCategory = category;
    },
    markSeen(state, category: ActivityCategory) {
      let max = state.lastSeenId[category] ?? 0;
      for (const entry of state.entries) {
        if (entry.category === category && entry.id > max) max = entry.id;
      }
      // Replace the map so the getter using it stays reactive.
      state.lastSeenId = { ...state.lastSeenId, [category]: max };
    },
  },
  actions: {
    /**
     * Record an entry emitted by the framework-light ActivityLog. Resolves the
     * connection label from the root store here so producers stay decoupled.
     */
    record(context, entry: ActivityEntry) {
      const connection =
        entry.connection ||
        context.rootState.usedConfig?.name ||
        context.rootState.database ||
        undefined;
      context.commit("push", { ...entry, connection });
      // Keep the active tab's badge from counting things you're looking at.
      if (entry.category === context.state.activeCategory) {
        context.commit("markSeen", entry.category);
      }
    },
    clear(context, category?: ActivityCategory) {
      context.commit("clear", category);
    },
    selectCategory(context, category: ActivityCategory) {
      context.commit("setActiveCategory", category);
      context.commit("markSeen", category);
    },
  },
};
