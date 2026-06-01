import { useEffect, useRef, useState } from "react";
import Editor, { useMonaco } from "@monaco-editor/react";
import { Play, Loader2, ListTree } from "lucide-react";
import { backend, type QueryResult } from "@/ipc";
import { DataGrid } from "@/components/grid/DataGrid";
import { useTabsStore } from "@/store/tabs";
import { useThemeStore } from "@/store/theme";
import { useActivityStore } from "@/store/activity";
import { Button, IconButton, Tooltip, notify } from "@/ui";

interface Props {
  tabId: string;
  sql: string;
}

export function QueryEditor({ tabId, sql }: Props) {
  const monaco = useMonaco();
  const theme = useThemeStore((s) => s.theme);
  const updateSql = useTabsStore((s) => s.updateSql);
  const pushActivity = useActivityStore((s) => s.push);

  const [result, setResult] = useState<QueryResult | null>(null);
  const [running, setRunning] = useState(false);
  const [resultsHeight, setResultsHeight] = useState(280);
  const sqlRef = useRef(sql);
  sqlRef.current = sql;

  // Define SlashTable-flavored Monaco themes once.
  useEffect(() => {
    if (!monaco) return;
    const token = (n: string) =>
      getComputedStyle(document.documentElement)
        .getPropertyValue(n)
        .trim()
        .replace("#", "");
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

  const run = async () => {
    setRunning(true);
    try {
      const r = await backend.executeQuery("mlc-local", sqlRef.current);
      setResult(r);
      notify.success(`${r.rowCount} rows · ${(r.elapsedMs / 1000).toFixed(2)}s`);
      pushActivity({
        category: "SQL",
        op: r.operation,
        connection: "mlc local",
        tables: r.tables.join(", "),
        sql: sqlRef.current.replace(/\s+/g, " ").trim(),
        durationMs: r.elapsedMs,
        rows: r.rowCount,
      });
    } catch (e) {
      notify.error(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-bg-secondary px-2">
        <Button onClick={run} disabled={running} size="sm">
          {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
          Run
        </Button>
        <Tooltip content="Format">
          <IconButton aria-label="Format SQL">
            <ListTree size={13} />
          </IconButton>
        </Tooltip>
        <span className="ml-auto text-xs text-text-muted">
          {result ? `${result.rowCount} rows · ${(result.elapsedMs / 1000).toFixed(2)}s` : "ready"}
        </span>
      </div>

      <div className="min-h-0 flex-1">
        <Editor
          language="sql"
          theme={theme === "dark" ? "slashtable-dark" : "slashtable-light"}
          value={sql}
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
      </div>

      <div
        className="flex h-1.5 shrink-0 cursor-row-resize items-center justify-center border-y border-border bg-bg-secondary"
        onMouseDown={(e) => {
          const startY = e.clientY;
          const startH = resultsHeight;
          const move = (ev: MouseEvent) =>
            setResultsHeight(Math.max(120, Math.min(560, startH + (startY - ev.clientY))));
          const up = () => {
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
          };
          window.addEventListener("mousemove", move);
          window.addEventListener("mouseup", up);
        }}
      >
        <div className="h-0.5 w-8 rounded-full bg-border" />
      </div>

      <div className="shrink-0" style={{ height: resultsHeight }}>
        {result ? (
          <DataGrid tabId={tabId} columns={result.columns} rows={result.rows} />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-text-muted">
            Run a query to see results
          </div>
        )}
      </div>
    </div>
  );
}
