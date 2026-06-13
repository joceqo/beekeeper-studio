import { useEffect, useState } from "react";
import {
  Database,
  Link2,
  Save,
  Plug,
  Eye,
  BookOpen,
  Pencil,
  FlaskConical,
  AlertTriangle,
  CheckCircle2,
  EyeOff,
} from "lucide-react";
import { Button, Input, Tabs, SegmentedControl, Switch, notify, cn } from "@/ui";
import { backend, type ConnectionConfig } from "@/ipc";
import { useSidebarStore } from "@/store/sidebar";
import { useTabsStore } from "@/store/tabs";

type Engine = "postgres" | "mysql" | "sqlite";

/** Engine tab → the backend's canonical client key (findClient in the db registry). */
const ENGINE_TO_CLIENT: Record<Engine, string> = {
  postgres: "postgresql",
  mysql: "mysql",
  sqlite: "sqlite",
};
type AiAccess = "Hidden" | "Read" | "Write";
type SshMode = "agent" | "userpass" | "keyfile";

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

const AI_TO_MCP: Record<AiAccess, "none" | "read" | "write"> = {
  Hidden: "none",
  Read: "read",
  Write: "write",
};

const SSH_MODES: { id: SshMode; label: string }[] = [
  { id: "agent", label: "Agent" },
  { id: "userpass", label: "Password" },
  { id: "keyfile", label: "Key file" },
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

/** Password field with a reveal (eye) toggle — see what you typed before connecting. */
function PasswordField({
  label,
  className,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  className?: string;
  value: string;
  placeholder?: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <label className={cn("flex flex-col gap-1", className)}>
      <span className="text-sm font-medium text-text-secondary">{label}</span>
      <div className="relative">
        <Input
          type={show ? "text" : "password"}
          className="pr-8"
          value={value}
          placeholder={placeholder}
          onChange={onChange}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setShow((s) => !s)}
          aria-label={show ? "Hide password" : "Show password"}
          title={show ? "Hide" : "Show"}
          className="absolute inset-y-0 right-0 flex w-8 items-center justify-center text-text-muted hover:text-text-primary"
        >
          {show ? <EyeOff size={13} /> : <Eye size={13} />}
        </button>
      </div>
    </label>
  );
}

function engineFromType(t?: string): Engine {
  if (t === "mysql" || t === "mariadb") return "mysql";
  if (t === "sqlite") return "sqlite";
  return "postgres";
}
function aiFromMcp(a?: string): AiAccess {
  return a === "none" ? "Hidden" : a === "write" ? "Write" : "Read";
}

export function ConnectionScreen({
  editConnectionId,
  duplicateConnectionId,
}: {
  editConnectionId?: string;
  duplicateConnectionId?: string;
}) {
  const isEdit = !!editConnectionId;
  // Edit loads in place; duplicate seeds a NEW connection from an existing one's fields.
  const sourceId = editConnectionId ?? duplicateConnectionId;
  const isDuplicate = !editConnectionId && !!duplicateConnectionId;
  const [engine, setEngine] = useState<Engine>("postgres");
  const [ai, setAi] = useState<AiAccess>("Read");
  const defaultPort = ENGINES.find((e) => e.id === engine)?.defaultPort ?? "";

  // The loaded config when editing — preserves id + untouched backend fields.
  const [baseConfig, setBaseConfig] = useState<ConnectionConfig | null>(null);

  // Basic fields.
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [database, setDatabase] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  // SSH tunnel.
  const [sshEnabled, setSshEnabled] = useState(false);
  const [sshHost, setSshHost] = useState("");
  const [sshPort, setSshPort] = useState("22");
  const [sshUsername, setSshUsername] = useState("");
  const [sshMode, setSshMode] = useState<SshMode>("agent");
  const [sshPassword, setSshPassword] = useState("");
  const [sshKeyfile, setSshKeyfile] = useState("~/.ssh/id_rsa");
  const [sshKeyfilePassword, setSshKeyfilePassword] = useState("");

  const [busy, setBusy] = useState<null | "test" | "save" | "connect">(null);
  // Last connection attempt result, shown inline under the actions.
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);

  const setActiveConnection = useSidebarStore((s) => s.setActiveConnection);
  const refreshConnections = useSidebarStore((s) => s.refreshConnections);
  const openTable = useTabsStore((s) => s.openTable);

  const isSqlite = engine === "sqlite";

  // Prefill from the saved connection when editing or duplicating.
  useEffect(() => {
    if (!sourceId) return;
    let cancelled = false;
    backend
      .getConnectionConfig(sourceId)
      .then((cfg) => {
        if (cancelled || !cfg) return;
        // When duplicating, drop the id so saving creates a new connection.
        setBaseConfig(isDuplicate ? { ...cfg, id: undefined } : cfg);
        setEngine(engineFromType(cfg.connectionType));
        setAi(aiFromMcp(cfg.mcpAccess));
        setName(isDuplicate ? `${cfg.name ?? "Connection"} (Copy)` : (cfg.name ?? ""));
        setUrl((cfg.url as string) ?? "");
        setHost(cfg.host ?? "");
        setPort(cfg.port != null ? String(cfg.port) : "");
        setDatabase(cfg.defaultDatabase ?? "");
        setUsername(cfg.username ?? "");
        setPassword(cfg.password ?? "");
        setSshEnabled(!!cfg.sshEnabled);
        setSshHost(cfg.sshHost ?? "");
        setSshPort(cfg.sshPort != null ? String(cfg.sshPort) : "22");
        setSshUsername(cfg.sshUsername ?? "");
        setSshMode((cfg.sshMode as SshMode) ?? "agent");
        setSshPassword(cfg.sshPassword ?? "");
        setSshKeyfile(cfg.sshKeyfile ?? "~/.ssh/id_rsa");
        setSshKeyfilePassword(cfg.sshKeyfilePassword ?? "");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sourceId, isDuplicate]);

  /** Assemble a full backend config: start from the edited/default base, overlay the form. */
  async function buildConfig(): Promise<ConnectionConfig> {
    let base: ConnectionConfig = baseConfig ?? {};
    if (!baseConfig) {
      try {
        base = await backend.newConnection();
      } catch {
        /* mock/mcp backends may not provide defaults — fall back to the form only */
      }
    }
    return {
      ...base,
      name: name || null,
      connectionType: ENGINE_TO_CLIENT[engine],
      url: url || null,
      host: isSqlite ? null : host || null,
      port: isSqlite ? null : port ? Number(port) : defaultPort ? Number(defaultPort) : null,
      defaultDatabase: database || null,
      username: isSqlite ? null : username || null,
      password: isSqlite ? null : password || null,
      mcpAccess: AI_TO_MCP[ai],
      sshEnabled: !isSqlite && sshEnabled,
      sshHost: !isSqlite && sshEnabled ? sshHost || null : null,
      sshPort: !isSqlite && sshEnabled ? (sshPort ? Number(sshPort) : 22) : null,
      sshUsername: !isSqlite && sshEnabled ? sshUsername || null : null,
      sshMode: !isSqlite && sshEnabled ? sshMode : null,
      sshPassword:
        !isSqlite && sshEnabled && sshMode === "userpass" ? sshPassword || null : null,
      sshKeyfile: !isSqlite && sshEnabled && sshMode === "keyfile" ? sshKeyfile || null : null,
      sshKeyfilePassword:
        !isSqlite && sshEnabled && sshMode === "keyfile" ? sshKeyfilePassword || null : null,
    };
  }

  const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

  async function onTest() {
    setBusy("test");
    setStatus(null);
    try {
      await backend.testConnection(await buildConfig());
      setStatus({ ok: true, message: "Connection successful" });
      notify.success("Connection successful");
    } catch (e) {
      setStatus({ ok: false, message: errMsg(e) });
      notify.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function onSave() {
    setBusy("save");
    setStatus(null);
    try {
      const saved = await backend.saveConnection(await buildConfig());
      refreshConnections();
      setStatus({ ok: true, message: `Saved ${saved.name}` });
      notify.success(`Saved ${saved.name}`);
    } catch (e) {
      setStatus({ ok: false, message: errMsg(e) });
      notify.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function onConnect() {
    setBusy("connect");
    setStatus(null);
    try {
      const saved = await backend.saveConnection(await buildConfig());
      refreshConnections();
      // Open the connection (conn/create builds the SSH tunnel) + select it in the
      // sidebar, then land on the first table so the main area shows the live DB.
      setActiveConnection(saved.id);
      const liveId = await backend.connect(saved.id);
      const tables = await backend.listTables(liveId);
      const first = tables.find((t) => t.type === "table") ?? tables[0];
      if (first) openTable(saved.id, first.schema, first.name);
      setStatus({ ok: true, message: `Connected to ${saved.name}` });
      notify.success(`Connected to ${saved.name}`);
    } catch (e) {
      setStatus({ ok: false, message: errMsg(e) });
      notify.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex h-full items-start justify-center overflow-auto bg-bg-primary p-8">
      <div className="w-full max-w-2xl">
        <div className="mb-6 flex items-center gap-2">
          <Database size={18} className="text-accent" />
          <h1 className="text-xl font-semibold text-text-primary">
            {isEdit ? "Edit Connection" : "New Connection"}
          </h1>
        </div>

        <Tabs
          value={engine}
          onValueChange={(v) => {
            setEngine(v as Engine);
            // Reset the port hint to the engine default when empty.
            if (!port) setPort("");
          }}
          items={ENGINES.map((e) => ({ value: e.id, label: e.label }))}
          className="mb-5"
        />

        {/* URL hint (manual fields below are the source of truth) */}
        <label className="mb-5 flex flex-col gap-1">
          <span className="flex items-center gap-1.5 text-sm font-medium text-text-secondary">
            <Link2 size={12} /> Connection URL
          </span>
          <Input
            className="font-mono"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={
              isSqlite
                ? "/path/to/database.sqlite"
                : `${engine}://user:password@host:${defaultPort}/database`
            }
          />
        </label>

        {!isSqlite ? (
          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Name"
              placeholder="mlc remote"
              className="col-span-2"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Field
              label="Host"
              placeholder="db.example.com"
              value={host}
              onChange={(e) => setHost(e.target.value)}
            />
            <Field
              label="Port"
              placeholder={defaultPort}
              value={port}
              onChange={(e) => setPort(e.target.value)}
            />
            <Field
              label="Database"
              placeholder="app_production"
              value={database}
              onChange={(e) => setDatabase(e.target.value)}
            />
            <Field
              label="User"
              placeholder="postgres"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <PasswordField
              label="Password"
              placeholder="••••••••"
              className="col-span-2"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            <Field
              label="Name"
              placeholder="local sqlite"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Field
              label="Database file"
              placeholder="/Users/me/data/app.sqlite"
              value={database}
              onChange={(e) => setDatabase(e.target.value)}
            />
          </div>
        )}

        {/* SSH tunnel */}
        {!isSqlite && (
          <div className="mt-6 rounded-md border border-border p-4">
            <label className="flex items-center justify-between">
              <span className="text-sm font-medium text-text-secondary">SSH Tunnel</span>
              <Switch
                aria-label="Enable SSH tunnel"
                checked={sshEnabled}
                onCheckedChange={setSshEnabled}
              />
            </label>

            {sshEnabled && (
              <div className="mt-4 grid grid-cols-2 gap-4">
                <Field
                  label="SSH Host"
                  placeholder="ssh.example.com"
                  value={sshHost}
                  onChange={(e) => setSshHost(e.target.value)}
                />
                <Field
                  label="SSH Port"
                  placeholder="22"
                  value={sshPort}
                  onChange={(e) => setSshPort(e.target.value)}
                />
                <Field
                  label="SSH User"
                  placeholder="deploy"
                  className="col-span-2"
                  value={sshUsername}
                  onChange={(e) => setSshUsername(e.target.value)}
                />
                <div className="col-span-2">
                  <span className="mb-2 block text-sm font-medium text-text-secondary">
                    Authentication
                  </span>
                  <SegmentedControl
                    aria-label="SSH authentication"
                    value={sshMode}
                    onValueChange={(v) => setSshMode(v as SshMode)}
                    items={SSH_MODES.map((m) => ({ value: m.id, label: m.label }))}
                  />
                </div>

                {sshMode === "userpass" && (
                  <PasswordField
                    label="SSH Password"
                    placeholder="••••••••"
                    className="col-span-2"
                    value={sshPassword}
                    onChange={(e) => setSshPassword(e.target.value)}
                  />
                )}
                {sshMode === "keyfile" && (
                  <>
                    <Field
                      label="Private key file"
                      placeholder="~/.ssh/id_rsa"
                      className="col-span-2"
                      value={sshKeyfile}
                      onChange={(e) => setSshKeyfile(e.target.value)}
                    />
                    <PasswordField
                      label="Key passphrase (optional)"
                      placeholder="••••••••"
                      className="col-span-2"
                      value={sshKeyfilePassword}
                      onChange={(e) => setSshKeyfilePassword(e.target.value)}
                    />
                  </>
                )}
                {sshMode === "agent" && (
                  <p className="col-span-2 text-xs text-text-muted">
                    Uses the running SSH agent for authentication.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* AI access segmented control */}
        <div className="mt-6">
          <span className="mb-2 block text-sm font-medium text-text-secondary">AI access</span>
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
          <Button onClick={onConnect} disabled={busy != null}>
            <Plug size={13} /> {busy === "connect" ? "Connecting…" : "Connect"}
          </Button>
          <Button variant="subtle" onClick={onSave} disabled={busy != null}>
            <Save size={13} /> {busy === "save" ? "Saving…" : "Save"}
          </Button>
          <Button variant="ghost" onClick={onTest} disabled={busy != null}>
            <FlaskConical size={13} /> {busy === "test" ? "Testing…" : "Test"}
          </Button>
        </div>

        {/* last connection attempt */}
        {status && (
          <div
            className={cn(
              "mt-3 flex items-start gap-1.5 text-xs",
              status.ok ? "text-success" : "text-danger"
            )}
          >
            {status.ok ? (
              <CheckCircle2 size={13} className="mt-px shrink-0" />
            ) : (
              <AlertTriangle size={13} className="mt-px shrink-0" />
            )}
            <span className="break-words">{status.message}</span>
          </div>
        )}
      </div>
    </div>
  );
}
