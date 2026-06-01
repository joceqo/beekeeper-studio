import { useState } from "react";
import { Database, Link2, Save, Plug, Eye, BookOpen, Pencil } from "lucide-react";
import { Button, Input, Tabs, SegmentedControl, notify } from "@/ui";

type Engine = "postgres" | "mysql" | "sqlite";
type AiAccess = "Hidden" | "Read" | "Write";

const ENGINES: { id: Engine; label: string; defaultPort: string }[] = [
  { id: "postgres", label: "Postgres", defaultPort: "5432" },
  { id: "mysql", label: "MySQL", defaultPort: "3306" },
  { id: "sqlite", label: "SQLite", defaultPort: "" },
];

const AI_OPTIONS: { id: AiAccess; icon: typeof Eye; hint: string }[] = [
  { id: "Hidden", icon: Eye, hint: "Not exposed to the agent" },
  { id: "Read", icon: BookOpen, hint: "SELECT-only via MCP" },
  { id: "Write", icon: Pencil, hint: "Full read/write via MCP" },
];

function Field({
  label,
  className,
  ...props
}: { label: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "size">) {
  return (
    <label className={className ? `flex flex-col gap-1 ${className}` : "flex flex-col gap-1"}>
      <span className="text-sm font-medium text-text-secondary">{label}</span>
      <Input {...props} />
    </label>
  );
}

export function ConnectionScreen() {
  const [engine, setEngine] = useState<Engine>("postgres");
  const [ai, setAi] = useState<AiAccess>("Read");
  const port = ENGINES.find((e) => e.id === engine)?.defaultPort ?? "";

  return (
    <div className="flex h-full items-start justify-center overflow-auto bg-bg-primary p-8">
      <div className="w-full max-w-2xl">
        <div className="mb-6 flex items-center gap-2">
          <Database size={18} className="text-accent" />
          <h1 className="text-xl font-semibold text-text-primary">Edit Connection</h1>
        </div>

        <Tabs
          value={engine}
          onValueChange={(v) => setEngine(v as Engine)}
          items={ENGINES.map((e) => ({ value: e.id, label: e.label }))}
          className="mb-5"
        />

        {/* URL field */}
        <label className="mb-5 flex flex-col gap-1">
          <span className="flex items-center gap-1.5 text-sm font-medium text-text-secondary">
            <Link2 size={12} /> Connection URL
          </span>
          <Input
            className="font-mono"
            placeholder={
              engine === "sqlite"
                ? "/path/to/database.sqlite"
                : `${engine}://user:password@host:${port}/database`
            }
          />
        </label>

        {engine !== "sqlite" ? (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Name" placeholder="mlc remote" className="col-span-2" />
            <Field label="Host" placeholder="db.example.com" />
            <Field label="Port" defaultValue={port} />
            <Field label="Database" placeholder="app_production" />
            <Field label="User" placeholder="postgres" />
            <Field label="Password" type="password" placeholder="••••••••" className="col-span-2" />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            <Field label="Name" placeholder="local sqlite" />
            <Field label="Database file" placeholder="/Users/me/data/app.sqlite" />
          </div>
        )}

        {/* AI access segmented control */}
        <div className="mt-6">
          <span className="mb-2 block text-sm font-medium text-text-secondary">
            AI access
          </span>
          <SegmentedControl
            aria-label="AI access"
            value={ai}
            onValueChange={(v) => setAi(v as AiAccess)}
            items={AI_OPTIONS.map((o) => {
              const Icon = o.icon;
              return {
                value: o.id,
                title: o.hint,
                icon: <Icon size={13} />,
                label: o.id,
              };
            })}
          />
          <p className="mt-1.5 text-xs text-text-muted">
            {AI_OPTIONS.find((o) => o.id === ai)?.hint}
          </p>
        </div>

        {/* actions */}
        <div className="mt-8 flex items-center gap-2 border-t border-border pt-5">
          <Button onClick={() => notify.success("Mock screen — no backend wired")}>
            <Plug size={13} /> Connect
          </Button>
          <Button
            variant="subtle"
            onClick={() => notify("Connection saved (mock)")}
          >
            <Save size={13} /> Save
          </Button>
          <span className="ml-auto text-xs text-text-muted">Mock screen — no backend wired</span>
        </div>
      </div>
    </div>
  );
}
