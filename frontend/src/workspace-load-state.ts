import { esc } from "./ui";

/** Protect live drafts and pending submissions without persisting private form data. */
export function protectWorkspaceDraft(dialog: HTMLDialogElement, needsProtection: () => boolean) {
  const unload = (event: BeforeUnloadEvent) => {
    if (!dialog.open || !dialog.isConnected || !needsProtection()) return;
    event.preventDefault();
    event.returnValue = "";
  };
  const cleanup = () => {
    window.removeEventListener("beforeunload", unload);
    dialog.removeEventListener("close", cleanup);
    observer.disconnect();
  };
  // Workspace dialogs are direct body children; account changes may remove them
  // without dispatching close. Avoid observing every mutation inside the form.
  const observer = new MutationObserver(() => {
    if (!dialog.isConnected) cleanup();
  });
  observer.observe(document.body, { childList: true });
  window.addEventListener("beforeunload", unload);
  dialog.addEventListener("close", cleanup, { once: true });
  return cleanup;
}

export function workspaceLoading(dialog: HTMLDialogElement, title: string, close: () => void) {
  const ownedFocus = dialog.contains(document.activeElement);
  dialog.innerHTML = `<header class="mw-header"><h2>${esc(title)}</h2><button type="button" data-load-close>Close</button></header><div class="mw-content" aria-busy="true"><p role="status">Loading…</p><div class="workspace-load-skeleton" aria-hidden="true">${Array.from({ length: 4 }, () => '<div class="workspace-load-skeleton__field"><span class="skeleton workspace-load-skeleton__label"></span><span class="skeleton workspace-load-skeleton__control"></span></div>').join("")}</div></div>`;
  dialog.querySelector<HTMLButtonElement>("[data-load-close]")!.onclick = close;
  return () => {
    if (ownedFocus && dialog.open && (document.activeElement === document.body || document.activeElement === dialog)) {
      (dialog.querySelector<HTMLElement>('input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')
        ?? dialog.querySelector<HTMLElement>('[data-close], [data-load-close]'))?.focus({ preventScroll: true });
    }
  };
}

/** An explicit read retry; callers own the request and dialog-lifetime checks. */
export function workspaceLoadFailure(dialog: HTMLDialogElement, title: string, error: unknown, retry: () => void, close: () => void) {
  if (!dialog.open) return;
  dialog.innerHTML = `<header class="mw-header"><h2>${esc(title)}</h2><button type="button" data-load-close>Close</button></header><div class="mw-content"><p role="alert">${esc(error instanceof Error ? error.message : "This information could not load.")}</p><p>Try loading again when the connection is available.</p><button type="button" data-load-retry>Try again</button></div>`;
  dialog.querySelector<HTMLButtonElement>("[data-load-close]")!.onclick = close;
  const action = dialog.querySelector<HTMLButtonElement>("[data-load-retry]")!;
  action.onclick = () => { action.disabled = true; retry(); };
  if (document.activeElement === document.body || dialog.contains(document.activeElement)) action.focus({ preventScroll: true });
}

export function savedReadbackFailure(dialog: HTMLDialogElement, error: unknown, retry: () => void, close: () => void) {
  const detail = error instanceof Error ? error.message : "The latest details could not load.";
  workspaceLoadFailure(dialog, "Change saved; refresh unavailable", new Error(`Your change was saved. Refresh the latest details before making another change. This retry only reads data and will not submit the saved change again. ${detail}`), retry, close);
}

/** Freeze the submitted surface until its result; preserve previously disabled controls. */
export function lockWorkspaceControls(dialog: HTMLDialogElement) {
  const states = [...dialog.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>('input, select, textarea, button')]
    .map(control => [control, control.disabled] as const);
  states.forEach(([control]) => { control.disabled = true; });
  return () => states.forEach(([control, disabled]) => { if (control.isConnected) control.disabled = disabled; });
}
