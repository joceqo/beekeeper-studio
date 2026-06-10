import { useCallback, useEffect, useRef, useState } from "react";
import Editor, { useMonaco, type OnMount } from "@monaco-editor/react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import {
  Play,
  Loader2,
  ChevronDown,
  Menu as MenuIcon,
  AlignLeft,
  Eraser,
  Rows2,
  Columns2,
} from "lucide-react";
import { backend, type QueryResult } from "@/ipc";
import { DataGrid } from "@/components/grid/DataGrid";
import { useTabsStore } from "@/store/tabs";
import { useSidebarStore } from "@/store/sidebar";
import { useThemeStore } from "@/store/theme";
import { useActivityStore } from "@/store/activity";
import { formatSql } from "@/lib/formatSql";
import { cn, Button, IconButton, Tooltip, Menu, notify } from "@/ui";

interface Props {
  tabId: string;
  sql: string;
}

type RunMode = "full" | "selection";
type Layout = "bottom" | "right";

export function QueryEditor({ tabId, sql }: Props) {
  const monaco = useMonaco();
  const theme = useThemeStore((s) => s.theme);
  const updateSql = useTabsStore((s) => s.updateSql);
  const pushActivity = useActivityStore((s) => s.push);
  // Run against the sidebar's active connection (resolved to a live id). No
  // hardcoded connection id, so the query editor works in mock AND MCP.
  const activeConnectionId = useSidebarStore((s) => s.activeConnectionId);

  const [result, setResult] = useState<QueryResult | null>(null);
  const [running, setRunning] = useState(false);
  const [layout, setLayout] = useState<Layout>("bottom");
  const sqlRef = useRef(sql);
  sqlRef.current = sql;
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);

  // Define SlashTable-flavored Monaco themes once.
  useEffect(() => {
    if (!monaco) return;
    const token = (n: string) =>
      getComputedStyle(document.documentElement).getPropertyValue(n).trim().replace("#", "");
    monaco.editor.defineTheme("slashtable-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "keyword.sql", foreground: token("--color-accent") },
        { token: "string.sql", foreground: token("--color-success") },
        { token: "comment", foreground: token("--color-text-muted") },
      ],
      colors: {
        "editor.background": "#" + token("--color-bg-primary"),
        "editor.foreground": "#" + token("--color-text-primary"),
        "editorLineNumber.foreground": "#" + token("--color-text-muted"),
        "editorCursor.foreground": "#" + token("--color-accent"),
        "editor.selectionBackground": "#" + token("--color-accent-subtle"),
      },
    });
    monaco.editor.defineTheme("slashtable-light", {
      base: "vs",
      inherit: true,
      rules: [
        { token: "keyword.sql", foreground: token("--color-accent") },
        { token: "string.sql", foreground: token("--color-success") },
        { token: "comment", foreground: token("--color-text-muted") },
      ],
      colors: {
        "editor.background": "#" + token("--color-bg-primary"),
        "editor.foreground": "#" + token("--color-text-primary"),
        "editorCursor.foreground": "#" + token("--color-accent"),
      },
    });
  }, [monaco]);

  useEffect(() => {
    monaco?.editor.setTheme(theme === "dark" ? "slashtable-dark" : "slashtable-light");
  }, [monaco, theme]);

  const run = useCallback(
    async (mode: RunMode = "full") => {
      if (!activeConnectionId) {
        notify.error("No connection selected. Pick a connection in the sidebar.");
        return;
      }
      // Run the selection if asked and there is one, else the whole buffer.
      let text = sqlRef.current;
      if (mode === "selection") {
        const ed = editorRef.current;
        const sel = ed?.getSelection();
        const picked = sel && !sel.isEmpty() ? ed?.getModel()?.getValueInRange(sel) : "";
        if (picked && picked.trim()) text = picked;
        else {
          notify.error("No text selected.");
          return;
        }
      }
      setRunning(true);
      try {
        const liveId = await backend.connect(activeConnectionId);
        const r = await backend.executeQuery(liveId, text);
        setResult(r);
        notify.success(`${r.rowCount} rows · ${(r.elapsedMs / 1000).toFixed(2)}s`);
        pushActivity({
          category: "SQL",
          op: r.operation,
          connection: activeConnectionId.replace(/[-:]/g, " "),
          tables: r.tables.join(", "),
          sql: text.replace(/\s+/g, " ").trim(),
          durationMs: r.elapsedMs,
          rows: r.rowCount,
        });
      } catch (e) {
        notify.error(e instanceof Error ? e.message : String(e));
      } finally {
        setRunning(false);
      }
    },
    [activeConnectionId, pushActivity]
  );

  // Keep a ref so the Monaco command closures always call the latest `run`.
  const runRef = useRef(run);
  runRef.current = run;

  const handleMount = useCallback<OnMount>((editor, monacoInstance) => {
    editorRef.current = editor;
    const KM = monacoInstance.KeyMod;
    const KC = monacoInstance.KeyCode;
    // ⌘↵ / ⌃↵ → run all; ⌘⇧↵ → run selection (matches SlashTable).
    editor.addCommand(KM.CtrlCmd | KC.Enter, () => void runRef.current("full"));
    editor.addCommand(KM.WinCtrl | KC.Enter, () => void runRef.current("full"));
    editor.addCommand(KM.CtrlCmd | KM.Shift | KC.Enter, () => void runRef.current("selection"));
  }, []);

  const onFormat = useCallback(() => {
    const formatted = formatSql(sqlRef.current);
    if (formatted !== sqlRef.current) updateSql(tabId, formatted);
  }, [tabId, updateSql]);

  const resultsPane = result ? (
    <DataGrid tabId={tabId} columns={result.columns} rows={result.rows} />
  ) : (
    <div className="flex h-full items-center justify-center text-md text-text-muted">
      Run a query to see results
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border bg-bg-secondary px-2">
        <Menu
          trigger={
            <IconButton aria-label="Editor actions">
              <MenuIcon size={13} />
            </IconButton>
          }
          items={[
            { label: "Format SQL", icon: <AlignLeft size={14} />, onSelect: onFormat },
            { type: "separator" },
            {
              label: "Clear results",
              icon: <Eraser size={14} />,
              disabled: !result,
              onSelect: () => setResult(null),
            },
            {
              label: "Clear editor",
              icon: <Eraser size={14} />,
              onSelect: () => updateSql(tabId, ""),
            },
          ]}
        />
        <Tooltip content={layout === "bottom" ? "Results on the side" : "Results at the bottom"}>
          <IconButton
            aria-label="Toggle results layout"
            onClick={() => setLayout((l) => (l === "bottom" ? "right" : "bottom"))}
          >
            {layout === "bottom" ? <Columns2 size={13} /> : <Rows2 size={13} />}
          </IconButton>
        </Tooltip>

        <span className="ml-2 text-xs text-text-muted">
          {result ? `${result.rowCount} rows · ${(result.elapsedMs / 1000).toFixed(2)}s` : "ready"}
        </span>

        {/* Split Run button: primary action + a dropdown of run modes. */}
        <div className="ml-auto flex items-stretch">
          <Button
            onClick={() => run("full")}
            disabled={running}
            size="sm"
            className="gap-1.5 rounded-r-none"
          >
            {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
            Run
            <span className="font-mono text-[10px] opacity-80">⌘↵</span>
          </Button>
          <Menu
            align="end"
            trigger={
              <IconButton
                aria-label="Run options"
                disabled={running}
                className="h-6 rounded-l-none border-l border-bg-primary/30 bg-accent px-1 text-text-on-accent hover:bg-accent-hover"
              >
                <ChevronDown size={13} />
              </IconButton>
            }
            items={[
              { label: "Run", kbd: "⌘↵", icon: <Play size={14} />, onSelect: () => run("full") },
              {
                label: "Run selection",
                kbd: "⌘⇧↵",
                onSelect: () => run("selection"),
              },
              { type: "separator" },
              { label: "Format SQL", icon: <AlignLeft size={14} />, onSelect: onFormat },
            ]}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <PanelGroup direction={layout === "bottom" ? "vertical" : "horizontal"}>
          <Panel minSize={20} order={1}>
            <Editor
              language="sql"
              theme={theme === "dark" ? "slashtable-dark" : "slashtable-light"}
              value={sql}
              onMount={handleMount}
              onChange={(v) => updateSql(tabId, v ?? "")}
              options={{
                fontFamily: '"JetBrains Mono Variable", monospace',
                fontSize: 13,
                minimap: { enabled: false },
                lineNumbersMinChars: 3,
                scrollBeyondLastLine: false,
                padding: { top: 10 },
                renderLineHighlight: "line",
                automaticLayout: true,
              }}
            />
          </Panel>
          <PanelResizeHandle
            className={cn(
              "bg-border transition-colors hover:bg-accent data-[resize-handle-state=drag]:bg-accent",
              layout === "bottom" ? "h-[3px]" : "w-[3px]"
            )}
          />
          <Panel minSize={15} defaultSize={35} order={2}>
            {resultsPane}
          </Panel>
        </PanelGroup>
      </div>
    </div>
  );
}
