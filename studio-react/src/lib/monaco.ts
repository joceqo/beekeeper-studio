/**
 * Wire @monaco-editor/react to a LOCALLY bundled Monaco instead of the default
 * jsdelivr CDN, so the editor works offline in the packaged Electron app.
 *
 * Import this module once, early (main.tsx), before any <Editor> mounts.
 */
import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";
// Vite turns these into bundled web workers (no CDN, no network).
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";

// SQL highlighting/editing only needs the base editor worker; JSON worker is
// included for the json/code cell popout editors. Other language workers are
// intentionally omitted to keep the bundle smaller.
self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === "json") return new JsonWorker();
    return new EditorWorker();
  },
};

loader.config({ monaco });

export {};
