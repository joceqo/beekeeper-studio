/**
 * Robust clipboard copy.
 *
 * The packaged app serves the renderer over the custom `app-react://` scheme,
 * which is NOT a secure context, so `navigator.clipboard` is `undefined` there
 * (it only exists in secure contexts). Prefer Electron's clipboard module via
 * the preload bridge (`window.main.writeTextToClipboard`), which works
 * regardless of secure context or user gesture — the same path the Vue app
 * uses. Fall back to `navigator.clipboard`, then to a hidden-textarea +
 * `document.execCommand("copy")` for the browser/dev contexts.
 *
 * Returns whether the copy succeeded so callers can show accurate feedback.
 */
export async function copyText(text: string): Promise<boolean> {
  const bridge = (window as unknown as {
    main?: { writeTextToClipboard?: (t: string) => void };
  }).main;
  if (bridge?.writeTextToClipboard) {
    try {
      bridge.writeTextToClipboard(text);
      return true;
    } catch {
      /* fall through */
    }
  }
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* fall through to the execCommand path */
    }
  }
  return execCommandCopy(text);
}

function execCommandCopy(text: string): boolean {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}
