import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { transport } from "./ipc/transport";

/**
 * Port handshake — replicates the Vue renderer's setup
 * (apps/studio/src-commercial/entrypoints/renderer.ts:205-215 and
 * REACT_IPC_CONTRACT.md §1.2 step 4): subscribe to the preload `port` relay,
 * then capture the transferred MessagePort + sId and hand them to the transport
 * so ElectronBackendClient can talk to the backend.
 *
 * Guarded by `window.main` so this is a no-op in a plain browser (`yarn dev`),
 * where the mock backend is used instead.
 */
if (typeof window !== "undefined" && window.main) {
  window.main.attachPortListener();
  window.onmessage = (event: MessageEvent) => {
    if (event.source === window && (event.data as { type?: string })?.type === "port") {
      const [port] = event.ports;
      const { sId } = event.data as { sId: string };
      transport.setPort(port, sId);
    }
  };
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
