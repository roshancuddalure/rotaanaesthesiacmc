export interface DataChange { path: string; at: number; }
const EVENT = "duty-rota:data-change";
const REVISION_KEY = "duty_rota_data_revision";

export function notifyDataChange(path: string, method = "GET"): void {
  if (typeof window === "undefined" || ["GET", "HEAD"].includes(method.toUpperCase()) ||
      path.startsWith("/api/v1/auth/") ||
      path.startsWith("/api/v1/rota-intelligence/") ||
      (path.startsWith("/api/v1/rota-compute/") && !path.endsWith("/apply")) || /\/(?:preview|inspect|import-preview)(?:\?|$)/.test(path)) return;
  const change: DataChange = { path, at: Date.now() };
  window.dispatchEvent(new CustomEvent(EVENT, { detail: change }));
  try { localStorage.setItem(REVISION_KEY, JSON.stringify({ ...change, nonce: Math.random() })); }
  catch { /* In-memory synchronization remains available when storage is restricted. */ }
}

export function onDataChange(handler: (change: DataChange) => void): () => void {
  const local = (event: Event) => handler((event as CustomEvent<DataChange>).detail);
  const external = (event: StorageEvent) => {
    if (event.key !== REVISION_KEY || !event.newValue) return;
    try {
      const value = JSON.parse(event.newValue);
      if (typeof value.path === "string" && typeof value.at === "number") handler(value);
    } catch { /* Ignore malformed storage notifications. */ }
  };
  window.addEventListener(EVENT, local);
  window.addEventListener("storage", external);
  return () => { window.removeEventListener(EVENT, local); window.removeEventListener("storage", external); };
}
