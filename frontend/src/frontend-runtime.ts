/** Frontend-only recovery. Never stores form contents or replays a request. */
export function createSafeStorage(resolve: () => Pick<Storage, "getItem" | "setItem" | "removeItem">) {
  const memory = new Map<string, string>();
  const failedWrites = new Set<string>();
  return {
    getItem(key: string): string | null {
      if (failedWrites.has(key)) return memory.get(key) ?? null;
      try {
        const value = resolve().getItem(key);
        if (value === null) memory.delete(key); else memory.set(key, value);
        return value;
      } catch { return memory.get(key) ?? null; }
    },
    setItem(key: string, value: string): void {
      memory.set(key, String(value));
      try { resolve().setItem(key, String(value)); failedWrites.delete(key); }
      catch { failedWrites.add(key); }
    },
    removeItem(key: string): void {
      memory.delete(key);
      try { resolve().removeItem(key); failedWrites.delete(key); }
      catch { failedWrites.add(key); }
    },
  };
}

export const safeLocalStorage = createSafeStorage(() => window.localStorage);
export const safeSessionStorage = createSafeStorage(() => window.sessionStorage);

export function isValidWorkingMonth(value: unknown): value is string {
  return typeof value === "string" && /^[0-9]{4}-(0[1-9]|1[0-2])$/.test(value) && value.slice(0, 4) !== "0000";
}

/** Only safe build metadata is exposed, never exception details, URLs or application data. */
export function frontendBuildIdentity(): string {
  const raw = typeof __FRONTEND_BUILD_ID__ === "string" ? __FRONTEND_BUILD_ID__ : "development";
  return /^[A-Za-z0-9._-]{1,64}$/.test(raw) ? raw : "unavailable";
}

let installed = false;
let hasEdited = false;

export function markFrontendReady(): void {
  document.getElementById("frontend-startup")?.remove();
  document.documentElement.dataset.frontendReady = "true";
  window.dispatchEvent(new Event("duty-rota:frontend-ready"));
}

export function installFrontendRuntime(): void {
  if (installed) return;
  installed = true;
  document.addEventListener("input", (event) => {
    if ((event.target as Element | null)?.closest("input, textarea, select, [contenteditable]")) hasEdited = true;
  }, true);
  window.addEventListener("vite:preloadError", (event) => {
    // Leave the original failure available to its caller: the dialog must not stay busy.
    // No preventDefault and no automatic reload, so an uncertain mutation is never replayed.
    if (document.getElementById("frontend-update-recovery")) return;
    const panel = document.createElement("aside");
    panel.id = "frontend-update-recovery";
    panel.className = "frontend-recovery";
    panel.setAttribute("role", "alert");
    const message = document.createElement("p");
    message.textContent = "This part of the app could not load. Your current screen remains available. Save or copy any unsaved work before reloading.";
    const reload = document.createElement("button");
    reload.type = "button";
    reload.textContent = "Reload app";
    reload.addEventListener("click", () => {
      if (hasEdited && !window.confirm("Reloading can discard unsaved changes. Have you saved or copied your work?")) return;
      reload.disabled = true;
      window.location.reload();
    });
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.textContent = "Keep working";
    dismiss.addEventListener("click", () => panel.remove());
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "Support details";
    const build = document.createElement("p");
    build.textContent = `Frontend build: ${frontendBuildIdentity()}`;
    details.append(summary, build);
    panel.append(message, reload, dismiss, details);
    document.body.append(panel);
    void event;
  });
}

declare const __FRONTEND_BUILD_ID__: string;
