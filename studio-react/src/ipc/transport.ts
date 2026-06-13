/**
 * Framework-free port of the Vue renderer's `UtilityConnection`
 * (apps/studio/src/lib/utility/UtilityConnection.ts) — the renderer side of the
 * MessagePort request/reply protocol documented in REACT_IPC_CONTRACT.md §1.3.
 *
 * Wire framing (must match apps/studio/src-commercial/entrypoints/utility.ts):
 *   request : port.postMessage({ id: uuid, name, args: { sId, ...args } })
 *   reply   : { id, type: 'reply', data } | { id, type: 'error', error, stack }
 *   push    : { type: string, input?: any }   (no id)
 *
 * `sId` is injected by the transport, never passed by callers. Requests issued
 * before the port arrives are queued and flushed on setPort (and lazily trigger
 * window.main.requestPorts()), so callers never have to await the handshake.
 */

/** A small UUID v4, matching apps/studio/src/lib/uuid.ts semantics. */
function uuidv4(): string {
  // crypto.randomUUID is available in Electron renderers (Chromium).
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

type Listener = (input: unknown) => void;

/** Verbose per-request logging when VITE_DEBUG_IPC=1 (errors are always logged). */
const DEBUG_IPC =
  typeof import.meta !== "undefined" &&
  (import.meta as { env?: Record<string, string> }).env?.VITE_DEBUG_IPC === "1";

interface QueuedMessage {
  handlerName: string;
  args: Record<string, unknown> | undefined;
  id: string;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

interface ReplyMessage {
  id: string;
  type: "reply" | "error";
  data?: unknown;
  error?: string;
  stack?: string;
}

interface PushMessage {
  type: string;
  input?: unknown;
}

/** Minimal shape of the preload bridge (apps/.../preload.ts `exposeInMainWorld('main', api)`). */
interface MainBridge {
  attachPortListener: () => void;
  requestPorts: () => void;
  fetchUsername?: () => Promise<string>;
  /**
   * Native open-file dialog (preload → main `dialog.showOpenDialogSync`).
   * Returns the selected paths, or undefined when cancelled. Present only in
   * the desktop app, so callers must guard on it.
   */
  showOpenDialogSync?: (args: {
    properties?: string[];
    filters?: { name: string; extensions: string[] }[];
    defaultPath?: string;
    title?: string;
  }) => string[] | undefined;
}

declare global {
  interface Window {
    main?: MainBridge;
  }
}

export interface BackendTransport {
  setPort(port: MessagePort, sId: string): void;
  readonly sId: string | undefined;
  /** Resolves once the port + sId are available (after the handshake). */
  whenReady(): Promise<void>;
  send<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T>;
  addListener(type: string, listener: Listener): string;
  removeListener(id: string): void;
}

export class MessagePortTransport implements BackendTransport {
  private port: MessagePort | undefined;
  private _sId: string | undefined;
  private portsRequested = false;
  private readonly replyHandlers = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (reason: unknown) => void; name: string }
  >();
  private readonly listeners: { type: string; id: string; listener: Listener }[] = [];
  private readonly messageQueue: QueuedMessage[] = [];

  private _ready!: Promise<void>;
  private _resolveReady!: () => void;
  constructor() {
    this._ready = new Promise<void>((resolve) => {
      this._resolveReady = resolve;
    });
  }

  get sId(): string | undefined {
    return this._sId;
  }

  whenReady(): Promise<void> {
    return this._ready;
  }

  setPort(port: MessagePort, sId: string): void {
    this.port = port;
    this._sId = sId;
    this._resolveReady();

    port.onmessage = (msg: MessageEvent) => {
      const data = msg.data as ReplyMessage | PushMessage;
      if (data.type === "error") {
        const { id, error, stack } = data as ReplyMessage;
        const handler = this.replyHandlers.get(id);
        if (handler) {
          this.replyHandlers.delete(id);
          // Always log backend errors with the handler name — the renderer
          // otherwise only sees an opaque message and no operation context.
          console.warn(`[ipc] ${handler.name} failed:`, error);
          const err = new Error(`${handler.name}: ${error ?? "unknown error"}`);
          if (stack) err.stack = stack;
          handler.reject(err);
        }
        return;
      }
      if (data.type === "reply") {
        const { id, data: payload } = data as ReplyMessage;
        const handler = this.replyHandlers.get(id);
        if (handler) {
          this.replyHandlers.delete(id);
          if (DEBUG_IPC) console.debug(`[ipc] ${handler.name} ✓`);
          handler.resolve(payload);
        }
        return;
      }
      // Server push (no reply id): route to registered listeners by type.
      const push = data as PushMessage;
      const match = this.listeners.find((l) => l.type === push.type);
      if (match) match.listener(push.input);
    };

    port.start();

    // Flush anything queued before the port arrived.
    if (this.messageQueue.length > 0) {
      for (const { handlerName, args, id, resolve, reject } of this.messageQueue) {
        const merged = { sId: this._sId, ...(args ?? {}) };
        this.replyHandlers.set(id, { resolve, reject, name: handlerName });
        if (DEBUG_IPC) console.debug(`[ipc] → ${handlerName} (queued)`);
        port.postMessage({ id, name: handlerName, args: merged });
      }
      this.messageQueue.length = 0;
    }
  }

  send<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = uuidv4();
      if (!this.port) {
        this.messageQueue.push({
          handlerName: name,
          args,
          id,
          resolve: resolve as (v: unknown) => void,
          reject,
        });
        if (!this.portsRequested) {
          window.main?.requestPorts();
          this.portsRequested = true;
        }
        return;
      }
      const merged = { sId: this._sId, ...(args ?? {}) };
      this.replyHandlers.set(id, { resolve: resolve as (v: unknown) => void, reject, name });
      if (DEBUG_IPC) console.debug(`[ipc] → ${name}`);
      this.port.postMessage({ id, name, args: merged });
    });
  }

  addListener(type: string, listener: Listener): string {
    const id = uuidv4();
    this.listeners.push({ type, id, listener });
    return id;
  }

  removeListener(id: string): void {
    const idx = this.listeners.findIndex((l) => l.id === id);
    if (idx >= 0) this.listeners.splice(idx, 1);
  }
}

/** The process-wide transport instance the React entry hands the port to. */
export const transport = new MessagePortTransport();
