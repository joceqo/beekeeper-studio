import { useEffect } from "react";

/**
 * Global keybinding system, modeled on SlashTable's `DEFAULT_KEYMAP`
 * (id -> [{ shortcut:{key,mod,shift,alt,ctrl}, when? }]). Bindings are
 * multi-binding (a command can have several shortcuts) and `when`-guarded by a
 * small set of named contexts (notably `!inputFocus`, which suppresses a
 * binding while typing in an input/textarea/contenteditable/Monaco editor).
 *
 * `mod` means the platform command modifier — ⌘ on macOS, Ctrl elsewhere.
 */

export interface Shortcut {
  /** Physical key, compared case-insensitively against KeyboardEvent.key. */
  key: string;
  /** Platform command modifier (⌘ on mac, Ctrl elsewhere). */
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
  /** Literal Ctrl (separate from `mod`), rarely needed on mac. */
  ctrl?: boolean;
}

/** Named guards a binding can require. Negate with a leading `!`. */
export type WhenContext = "inputFocus" | "tableTab";

export interface Binding {
  shortcut: Shortcut;
  /** Guard expression, e.g. "!inputFocus" or "tableTab". */
  when?: string;
}

export const IS_MAC =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * DEFAULT_KEYMAP — command id -> bindings. Mirrors the SlashTable keymap from
 * SLASHTABLE_ANALYSIS.md ("Behavioral logic" / DEFAULT_KEYMAP). Only the
 * commands wired to real behavior in this fork are included; grid-internal nav
 * (arrows/Tab/copy) is handled by the data grid itself.
 */
export const DEFAULT_KEYMAP: Record<string, Binding[]> = {
  "core.palette": [
    { shortcut: { key: "k", mod: true } },
    { shortcut: { key: "p", mod: true } },
    { shortcut: { key: "/" }, when: "!inputFocus" },
  ],
  "core.db-switcher": [{ shortcut: { key: "d", mod: true } }],
  "core.new-sql-tab": [{ shortcut: { key: "t", mod: true } }],
  "core.new-explorer-tab": [{ shortcut: { key: "e", mod: true, shift: true } }],
  "core.close-tab": [{ shortcut: { key: "w", mod: true } }],
  "core.next-tab": [{ shortcut: { key: "]", mod: true, shift: true } }],
  "core.prev-tab": [{ shortcut: { key: "[", mod: true, shift: true } }],
  "core.open-settings": [{ shortcut: { key: ",", mod: true } }],
  "core.toggle-sidebar": [{ shortcut: { key: "/", mod: true } }],
  "core.toggle-context-sidebar": [{ shortcut: { key: "/", mod: true, shift: true } }],
  "core.toggle-log-panel": [{ shortcut: { key: "j", mod: true } }],
  "core.schema-graph": [{ shortcut: { key: "g", mod: true, shift: true } }],
  "core.reconnect": [{ shortcut: { key: "r", shift: true }, when: "!inputFocus" }],
  "core.focus-explorer-search": [
    { shortcut: { key: "t", shift: true }, when: "!inputFocus" },
  ],
  "core.zoom-in": [
    { shortcut: { key: "=", mod: true } },
    { shortcut: { key: "+", mod: true } },
  ],
  "core.zoom-out": [{ shortcut: { key: "-", mod: true } }],
  "core.zoom-reset": [{ shortcut: { key: "0", mod: true } }],
  "table.add-filter": [{ shortcut: { key: "f" }, when: "!inputFocus && tableTab" }],
};

/** Human-readable rendering of a shortcut for the palette/Kbd hints. */
export function formatShortcut(s: Shortcut): string {
  const parts: string[] = [];
  if (s.ctrl) parts.push(IS_MAC ? "⌃" : "Ctrl");
  if (s.mod) parts.push(IS_MAC ? "⌘" : "Ctrl");
  if (s.alt) parts.push(IS_MAC ? "⌥" : "Alt");
  if (s.shift) parts.push(IS_MAC ? "⇧" : "Shift");
  const k = s.key;
  const label =
    k === " "
      ? "Space"
      : k.length === 1
        ? k.toUpperCase()
        : k.replace(/^Arrow/, "");
  parts.push(label);
  // On mac the modifier glyphs are concatenated; elsewhere join with +.
  return IS_MAC ? parts.join("") : parts.join("+");
}

/** First binding's shortcut for a command, for display. */
export function primaryShortcut(commandId: string): string | undefined {
  const b = DEFAULT_KEYMAP[commandId]?.[0];
  return b ? formatShortcut(b.shortcut) : undefined;
}

/** True when focus is in an editable surface (input/textarea/CE/Monaco). */
export function isInputFocused(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  // Monaco renders a focused .monaco-editor with a hidden textarea; either the
  // textarea (caught above) or the editor container being focused counts.
  if (el.closest(".monaco-editor")) return true;
  return false;
}

interface MatchContext {
  inputFocus: boolean;
  tableTab: boolean;
}

/** Evaluate a `when` guard like "!inputFocus && tableTab" against context. */
function evalWhen(when: string | undefined, ctx: MatchContext): boolean {
  if (!when) return true;
  return when.split("&&").every((clause) => {
    const c = clause.trim();
    if (!c) return true;
    const negate = c.startsWith("!");
    const name = (negate ? c.slice(1) : c).trim() as keyof MatchContext;
    const val = !!ctx[name];
    return negate ? !val : val;
  });
}

/** True when a keyboard event matches the shortcut for the current platform. */
function matchesShortcut(e: KeyboardEvent, s: Shortcut): boolean {
  if (e.key.toLowerCase() !== s.key.toLowerCase()) return false;
  const modPressed = IS_MAC ? e.metaKey : e.ctrlKey;
  if (!!s.mod !== modPressed) return false;
  if (!!s.shift !== e.shiftKey) return false;
  if (!!s.alt !== e.altKey) return false;
  // Literal ctrl: only enforce when requested; otherwise (on mac) ignore so a
  // ⌘ shortcut isn't blocked by an unrelated ctrl state. `mod` already covers
  // ctrl on non-mac, so only check standalone ctrl when explicitly set.
  if (s.ctrl && !e.ctrlKey) return false;
  return true;
}

export interface KeybindingsOptions {
  /** Resolve a command id to its handler. Missing ids are ignored. */
  run: (commandId: string) => void;
  /** Provide live `when` context (e.g. whether the active tab is a table tab). */
  getContext: () => Pick<MatchContext, "tableTab">;
}

/**
 * Mount-once global keydown listener that matches DEFAULT_KEYMAP and dispatches
 * the matched command via `run`. A single window listener (capture phase) keeps
 * ordering predictable and lets us preventDefault before the browser acts on
 * e.g. ⌘T / ⌘W / ⌘-. Mount this once (App.tsx).
 */
export function useGlobalKeybindings(opts: KeybindingsOptions): void {
  const { run, getContext } = opts;
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.repeat) return;
      const ctx: MatchContext = {
        inputFocus: isInputFocused(),
        tableTab: getContext().tableTab,
      };
      for (const [commandId, bindings] of Object.entries(DEFAULT_KEYMAP)) {
        for (const b of bindings) {
          if (!matchesShortcut(e, b.shortcut)) continue;
          if (!evalWhen(b.when, ctx)) continue;
          e.preventDefault();
          e.stopPropagation();
          run(commandId);
          return;
        }
      }
    }
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [run, getContext]);
}
