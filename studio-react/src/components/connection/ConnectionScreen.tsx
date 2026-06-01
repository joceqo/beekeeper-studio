import { useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { Database, Link2, Save, Plug, Eye, BookOpen, Pencil } from "lucide-react";
import { cn } from "@/lib/cn";

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
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium text-text-secondary">{label}</span>
      <input
        {...props}
        className="rounded-sm border border-border bg-bg-primary px-2.5 py-1.5 text-md text-text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent/40 placeholder:text-text-muted"
      />
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

        <Tabs.Root value={engine} onValueChange={(v) => setEngine(v as Engine)}>
          <Tabs.List className="mb-5 flex gap-1 border-b border-border">
            {ENGINES.map((e) => (
              <Tabs.Trigger
                key={e.id}
                value={e.id}
                className={cn(
                  "relative -mb-px px-3 py-2 text-md text-text-secondary outline-none",
                  "data-[state=active]:text-text-primary"
                )}
              >
                {e.label}
                <span className="absolute inset-x-0 bottom-0 hidden h-0.5 bg-accent data-[state=active]:block" />
                {engine === e.id && (
                  <span className="absolute inset-x-0 bottom-0 h-0.5 bg-accent" />
                )}
              </Tabs.Trigger>
            ))}
          </Tabs.List>

          {/* URL field */}
          <label className="mb-5 flex flex-col gap-1">
            <span className="flex items-center gap-1.5 text-sm font-medium text-text-secondary">
              <Link2 size={12} /> Connection URL
            </span>
            <input
              placeholder={
                engine === "sqlite"
                  ? "/path/to/database.sqlite"
                  : `${engine}://user:password@host:${port}/database`
              }
              className="rounded-sm border border-border bg-bg-primary px-2.5 py-1.5 font-mono text-md text-text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent/40 placeholder:text-text-muted"
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
            <div className="inline-flex rounded-md border border-border bg-bg-secondary p-0.5">
              {AI_OPTIONS.map((o) => {
                const Icon = o.icon;
                const isActive = ai === o.id;
                return (
                  <button
                    key={o.id}
                    onClick={() => setAi(o.id)}
                    title={o.hint}
                    className={cn(
                      "flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-sm font-medium",
                      isActive
                        ? "bg-accent text-text-on-accent"
                        : "text-text-secondary hover:text-text-primary"
                    )}
                  >
                    <Icon size={13} />
                    {o.id}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-xs text-text-muted">
              {AI_OPTIONS.find((o) => o.id === ai)?.hint}
            </p>
          </div>

          {/* actions */}
          <div className="mt-8 flex items-center gap-2 border-t border-border pt-5">
            <button className="flex items-center gap-1.5 rounded-sm bg-accent px-3 py-1.5 text-md font-medium text-text-on-accent hover:bg-accent-hover">
              <Plug size={13} /> Connect
            </button>
            <button className="flex items-center gap-1.5 rounded-sm border border-border bg-bg-secondary px-3 py-1.5 text-md text-text-primary hover:bg-bg-hover">
              <Save size={13} /> Save
            </button>
            <span className="ml-auto text-xs text-text-muted">Mock screen — no backend wired</span>
          </div>
        </Tabs.Root>
      </div>
    </div>
  );
}
