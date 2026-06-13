import { useEffect, useState } from "react";
import {
  FolderOpen,
  Save,
  Eye,
  Pencil,
  FlaskConical,
  AlertTriangle,
  CheckCircle2,
  EyeOff,
  X,
  Check,
} from "lucide-react";
import {
  Button,
  Input,
  SegmentedControl,
  Switch,
  Popover,
  IconButton,
  notify,
  cn,
} from "@/ui";
import { BaseDialog } from "@/ui/Dialog";
import { backend, type ConnectionConfig } from "@/ipc";
import { useSidebarStore } from "@/store/sidebar";
import { useTabsStore } from "@/store/tabs";
import { LABEL_COLORS, paintForLabelColor } from "@/lib/labelColors";
import { EngineIcon } from "./EngineIcon";

type Engine = "postgres" | "mysql" | "sqlite";

/** Engine → the backend's canonical client key (findClient in the db registry). */
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
  { id: "Hidden", icon: EyeOff, hint: "Not exposed to AI agents." },
  { id: "Read", icon: Eye, hint: "AI agents can browse schema and read data." },
  { id: "Write", icon: Pencil, hint: "AI agents can read and modify data." },
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

function engineFromType(t?: string): Engine {
  if (t === "mysql" || t === "mariadb") return "mysql";
  if (t === "sqlite") return "sqlite";
  return "postgres";
}
function aiFromMcp(a?: string): AiAccess {
  return a === "none" ? "Hidden" : a === "write" ? "Write" : "Read";
}

function Field({
  label,
  className,
  ...props
}: { label: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "size">) {
  return (
    <label className={cn("flex flex-col gap-1", className)}>
      <span className="text-sm font-medium text-text-secondary">{label}</span>
      <Input {...props} />
    </label>
  );
}

/** Password field with a reveal (eye) toggle. */
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
          className="absolute inset-y-0 right-0 flex w-8 items-center justify-center text-text-muted hover:text-text-primary"
        >
          {show ? <EyeOff size={13} /> : <Eye size={13} />}
        </button>
      </div>
    </label>
  );
}

/** Color "paint" picker — swatches mapped to the backend `labelColor` name. */
function PaintPicker({ value, onChange }: { value: string; onChange: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const current = paintForLabelColor(value);
  return (
    <div className="flex flex-col items-start gap-1">
      <span className="text-sm font-medium text-text-secondary">Paint</span>
      <Popover
        open={open}
        onOpenChange={setOpen}
        align="end"
        trigger={
          <button
            type="button"
            aria-label="Connection paint color"
            className="flex h-7 w-7 items-center justify-center rounded-full border border-border hover:border-text-muted"
            style={current ? { backgroundColor: current, borderColor: current } : undefined}
          >
            {!current && <span className="h-4 w-4 rounded-full border border-dashed border-text-muted" />}
          </button>
        }
      >
        <div className="grid grid-cols-4 gap-1.5">
          {LABEL_COLORS.map((c) => {
            const selected = c.name === value;
            return (
              <button
                key={c.name}
                type="button"
                title={c.name}
                onClick={() => {
                  onChange(c.name);
                  setOpen(false);
                }}
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full border transition-colors",
                  selected ? "border-text-primary" : "border-border hover:border-text-muted"
                )}
                style={c.hex ? { backgroundColor: c.hex, borderColor: c.hex } : undefined}
              >
                {!c.hex && <span className="h-4 w-4 rounded-full border border-dashed border-text-muted" />}
                {selected && c.hex && <Check size={13} className="text-white" />}
              </button>
            );
          })}
        </div>
      </Popover>
    </div>
  );
}

/**
 * The connection editor form. Mounted fresh per open (keyed by the modal mode)
 * so state resets cleanly between new / edit / duplicate.
 */
function ConnectionForm({
  editConnectionId,
  duplicateConnectionId,
  onDone,
}: {
  editConnectionId?: string;
  duplicateConnectionId?: string;
  onDone: () => void;
}) {
  const isEdit = !!editConnectionId;
  const sourceId = editConnectionId ?? duplicateConnectionId;
  const isDuplicate = !editConnectionId && !!duplicateConnectionId;

  const [engine, setEngine] = useState<Engine>("postgres");
  const [ai, setAi] = useState<AiAccess>("Read");
  const [paint, setPaint] = useState("default");
  const defaultPort = ENGINES.find((e) => e.id === engine)?.defaultPort ?? "";

  const [baseConfig, setBaseConfig] = useState<ConnectionConfig | null>(null);

  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [database, setDatabase] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const [sshEnabled, setSshEnabled] = useState(false);
  const [sshHost, setSshHost] = useState("");
  const [sshPort, setSshPort] = useState("22");
  const [sshUsername, setSshUsername] = useState("");
  const [sshMode, setSshMode] = useState<SshMode>("agent");
  const [sshPassword, setSshPassword] = useState("");
  const [sshKeyfile, setSshKeyfile] = useState("~/.ssh/id_rsa");
  const [sshKeyfilePassword, setSshKeyfilePassword] = useState("");

  const [busy, setBusy] = useState<null | "test" | "save">(null);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);

  const refreshConnections = useSidebarStore((s) => s.refreshConnections);

  const isSqlite = engine === "sqlite";

  // Prefill from the saved connection when editing or duplicating.
  useEffect(() => {
    if (!sourceId) return;
    let cancelled = false;
    backend
      .getConnectionConfig(sourceId)
      .then((cfg) => {
        if (cancelled || !cfg) return;
        setBaseConfig(isDuplicate ? { ...cfg, id: undefined } : cfg);
        setEngine(engineFromType(cfg.connectionType));
        setAi(aiFromMcp(cfg.mcpAccess));
        setPaint(typeof cfg.labelColor === "string" ? cfg.labelColor : "default");
        setName(isDuplicate ? `${cfg.name ?? "Connection"} (Copy)` : (cfg.name ?? ""));
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
      labelColor: paint,
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

  function browseSqliteFile() {
    const picker = window.main?.showOpenDialogSync;
    if (!picker) {
      notify.error("File picker is only available in the desktop app.");
      return;
    }
    const files = picker({
      title: "Select SQLite database file",
      properties: ["openFile"],
      filters: [
        { name: "SQLite", extensions: ["db", "sqlite", "sqlite3", "db3"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (files && files.length > 0) setDatabase(files[0]);
  }

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
      notify.success(`Saved ${saved.name}`);
      onDone();
    } catch (e) {
      setStatus({ ok: false, message: errMsg(e) });
      notify.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col">
      {/* header */}
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-text-primary">
          {isEdit ? "Edit Connection" : "New Connection"}
        </h1>
        <BaseDialog.Close render={<IconButton aria-label="Close" />}>
          <X size={14} />
        </BaseDialog.Close>
      </div>

      <div className="flex gap-5">
        {/* engine rail */}
        <div className="flex w-36 shrink-0 flex-col gap-1">
          {ENGINES.map((e) => {
            const selected = e.id === engine;
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => setEngine(e.id)}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-md transition-colors",
                  selected
                    ? "bg-bg-hover text-text-primary"
                    : "text-text-secondary hover:bg-bg-hover/60"
                )}
              >
                <EngineIcon
                  engine={e.id}
                  size={15}
                  className={cn("shrink-0", selected ? "text-accent" : "text-text-muted")}
                />
                {e.label}
              </button>
            );
          })}
        </div>

        {/* content */}
        <div className="min-w-0 flex-1 space-y-5">
          {/* name + paint */}
          <div className="flex items-end gap-3">
            <label className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-sm font-medium text-text-secondary">
                Name <span className="font-normal text-text-muted">optional</span>
              </span>
              <Input
                value={name}
                placeholder={isSqlite ? "local sqlite" : "mlc remote"}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <PaintPicker value={paint} onChange={setPaint} />
          </div>

          {/* engine-specific fields */}
          {isSqlite ? (
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-text-secondary">Database file</span>
              <div className="flex gap-2">
                <Input
                  className="flex-1 font-mono"
                  value={database}
                  placeholder="/path/to/database.db"
                  onChange={(e) => setDatabase(e.target.value)}
                />
                <Button variant="subtle" onClick={browseSqliteFile}>
                  <FolderOpen size={13} /> Browse
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
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
          )}

          {/* SSH tunnel */}
          {!isSqlite && (
            <div className="rounded-md border border-border p-4">
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

          {/* AI access */}
          <div>
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

          {/* last connection attempt */}
          {status && (
            <div
              className={cn(
                "flex items-start gap-1.5 text-xs",
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

      {/* footer */}
      <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
        <Button variant="ghost" onClick={onTest} disabled={busy != null}>
          <FlaskConical size={13} /> {busy === "test" ? "Testing…" : "Test connection"}
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onDone} disabled={busy != null}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={busy != null}>
            <Save size={13} /> {busy === "save" ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** SlashTable-style connection editor modal, driven by the tabs store. */
export function ConnectionModal() {
  const modal = useTabsStore((s) => s.connectionModal);
  const close = useTabsStore((s) => s.closeConnectionModal);

  return (
    <BaseDialog.Root open={modal.open} onOpenChange={(o) => !o && close()}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[1px] transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <BaseDialog.Popup className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-full max-w-3xl -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-lg border border-border bg-bg-secondary p-5 text-md text-text-primary shadow-xl shadow-black/40 outline-none transition-all data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
          {modal.open && (
            <ConnectionForm
              key={`${modal.editConnectionId ?? ""}:${modal.duplicateConnectionId ?? ""}`}
              editConnectionId={modal.editConnectionId}
              duplicateConnectionId={modal.duplicateConnectionId}
              onDone={close}
            />
          )}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
