/**
 * Framework-light activity log.
 *
 * This is intentionally free of any Vue / Vuex dependency so the activity
 * pipeline survives a later framework migration (Vue 3 / React). The shape of
 * an entry mirrors a tool-call log: a timestamped record of an operation, its
 * target, and its outcome. Producers call `activityLog.emit(...)`; consumers
 * (the Vuex module, a future store, tests) subscribe via `activityLog.subscribe`.
 */

export type ActivityCategory =
  | "SQL"
  | "App"
  | "MCP"
  | "User"
  | "System"
  | "Connections";

/** Ordered list of category tabs shown in the Activity panel. */
export const ACTIVITY_CATEGORIES: ActivityCategory[] = [
  "SQL",
  "App",
  "MCP",
  "User",
  "System",
  "Connections",
];

export interface ActivityEntry {
  /** Monotonic id, assigned by the log. */
  id: number;
  /** Epoch milliseconds when the entry was recorded. */
  time: number;
  category: ActivityCategory;
  /** Operation name, e.g. SELECT / INSERT / connect. */
  op?: string;
  /** Connection label (nickname or default database). */
  connection?: string;
  /** Target table(s), comma separated. */
  tables?: string;
  /** The SQL or detail text. */
  sql?: string;
  /** Wall-clock duration of the operation in milliseconds. */
  durationMs?: number;
  /** Row count returned / affected. */
  rows?: number;
}

/** What producers pass in - id and time are filled in by the log. */
export type ActivityInput = Omit<ActivityEntry, "id" | "time"> & {
  time?: number;
};

type Listener = (entry: ActivityEntry) => void;

class ActivityLog {
  private listeners = new Set<Listener>();
  private seq = 0;

  /** Record an entry and notify subscribers. Never throws. */
  emit(input: ActivityInput): ActivityEntry {
    const entry: ActivityEntry = {
      ...input,
      id: ++this.seq,
      time: input.time ?? Date.now(),
    };
    this.listeners.forEach((listener) => {
      try {
        listener(entry);
      } catch (_e) {
        // A misbehaving subscriber must never break the producer.
      }
    });
    return entry;
  }

  /** Subscribe to new entries. Returns an unsubscribe function. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

/** App-wide singleton. */
export const activityLog = new ActivityLog();
