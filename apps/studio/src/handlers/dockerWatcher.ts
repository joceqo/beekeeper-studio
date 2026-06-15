import rawLog from "@bksLogger";
import { spawn, ChildProcessWithoutNullStreams } from "child_process";

const log = rawLog.scope("DockerWatcher");

/**
 * Event-driven Docker DB detection. Instead of polling `docker ps`, this tails
 * the `docker events` stream and fires a debounced callback whenever a container
 * starts/stops/dies — so containers spun up after the app is open surface in the
 * sidebar near-instantly (see Sidebar.tsx onDockerChange).
 *
 * Robustness: when Docker is down or not installed, `docker events` exits/errors;
 * the watcher retries the spawn on a slow timer, so it auto-attaches once Docker
 * (re)starts. All failures degrade quietly — no Docker simply means no events.
 */

const RECONNECT_MS = 10_000;
const DEBOUNCE_MS = 250;

let child: ChildProcessWithoutNullStreams | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let debounceTimer: NodeJS.Timeout | null = null;
let stopped = false;
let onChange: (() => void) | null = null;

function fireChange(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    try {
      onChange?.();
    } catch (e) {
      log.debug("docker onChange callback threw:", (e as Error).message);
    }
  }, DEBOUNCE_MS);
}

function scheduleReconnect(): void {
  if (stopped || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    spawnStream();
  }, RECONNECT_MS);
}

function spawnStream(): void {
  if (stopped || child) return;
  let proc: ChildProcessWithoutNullStreams;
  try {
    proc = spawn(
      "docker",
      [
        "events",
        "--format",
        "{{json .}}",
        "--filter",
        "type=container",
        "--filter",
        "event=start",
        "--filter",
        "event=die",
        "--filter",
        "event=stop",
        "--filter",
        "event=destroy",
      ],
      { windowsHide: true }
    );
  } catch (e) {
    // Synchronous spawn failure (rare) — retry slowly.
    log.debug("docker events spawn failed:", (e as Error).message);
    scheduleReconnect();
    return;
  }
  child = proc;

  // Each line on stdout is one container lifecycle event → coalesce into a
  // single refresh so a burst (e.g. docker compose up) fires once.
  proc.stdout.on("data", () => fireChange());

  proc.on("error", (e) => {
    // ENOENT (docker not installed) or transient — degrade and retry.
    log.debug("docker events error:", e.message);
    if (child === proc) child = null;
    scheduleReconnect();
  });

  proc.on("exit", (code) => {
    // Daemon down / Docker quit. Retry so we reattach when it comes back up.
    log.debug("docker events exited with code:", code);
    if (child === proc) child = null;
    scheduleReconnect();
  });
}

/** Start the watcher. `notify` is debounced and called on every relevant event. */
export function startDockerWatcher(notify: () => void): void {
  onChange = notify;
  stopped = false;
  spawnStream();
}

/** Stop the watcher and release the child process (idempotent). */
export function stopDockerWatcher(): void {
  stopped = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (child) {
    child.kill();
    child = null;
  }
}
