import { request } from "./services/api";
import type { MappingType } from "./services/api";

type ReferenceRow = {
  id?: string; key?: string; code?: string; label?: string; name?: string;
  active?: boolean; active_status?: string;
};
type State = { phase: "idle" | "loading" | "ready" | "error"; rows: ReferenceRow[]; lookup?: Map<string, ReferenceRow> };
export type MappingTargetDetail = {
  label: string | null;
  state: "unresolved" | "loading" | "active" | "inactive" | "missing" | "unavailable";
  message: string;
};
const endpoints: Record<MappingType, string> = {
  duty_label: "/api/v1/normalization/catalog/duty_type",
  posting_label: "/api/v1/normalization/catalog/posting_type",
  unit_label: "/api/v1/normalization/units",
};

/** Optional read-only reference details. Main mapping reads and saves remain independent. */
export function createMappingReferenceDetails(isCurrent: () => boolean, changed: () => void) {
  let disposed = false, sequence = 0;
  const pending = new Map<AbortController, ReturnType<typeof setTimeout>>();
  const states: Record<MappingType, State> = {
    duty_label: { phase: "idle", rows: [] },
    posting_label: { phase: "idle", rows: [] },
    unit_label: { phase: "idle", rows: [] },
  };
  const alive = (ticket: number) => !disposed && sequence === ticket && isCurrent();
  const notify = () => {
    if (disposed || !isCurrent()) return;
    try { changed(); }
    catch { console.warn("Mapping reference details could not be displayed."); }
  };
  const cancelPending = () => {
    for (const [controller, timer] of pending) { clearTimeout(timer); controller.abort(); }
    pending.clear();
  };
  const load = async () => {
    if (disposed || !isCurrent()) return;
    const ticket = ++sequence;
    cancelPending();
    for (const kind of Object.keys(endpoints) as MappingType[]) states[kind] = { phase: "loading", rows: [] };
    notify();
    await Promise.all((Object.entries(endpoints) as [MappingType, string][]).map(async ([kind, path]) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      pending.set(controller, timer);
      try {
        const rows = await request<unknown>(path, { signal: controller.signal });
        if (!alive(ticket)) return;
        if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== "object" || Array.isArray(row)
          || ![row.id, row.key, row.code].some(value => typeof value === "string" && value.length > 0))) throw Error("Reference details unavailable");
        const lookup = new Map<string, ReferenceRow>();
        for (const row of rows as ReferenceRow[]) for (const value of [row.id, row.key, row.code]) {
          if (typeof value === "string" && !lookup.has(value)) lookup.set(value, row);
        }
        states[kind] = { phase: "ready", rows: rows as ReferenceRow[], lookup };
      } catch {
        if (!alive(ticket)) return;
        states[kind] = { phase: "error", rows: [] };
      } finally {
        clearTimeout(timer); pending.delete(controller);
      }
      if (alive(ticket)) notify();
    }));
  };
  const describe = (kind: MappingType, key: string | null): MappingTargetDetail => {
    if (!key) return { label: null, state: "unresolved", message: "No target selected" };
    const state = states[kind];
    if (!state || state.phase === "idle" || state.phase === "error") return { label: null, state: "unavailable", message: "Target activity unavailable" };
    if (state.phase === "loading") return { label: null, state: "loading", message: "Reading target details" };
    // Match only identities actually returned by the API; do not normalize saved keys here.
    const row = state.lookup?.get(key);
    if (!row) return { label: null, state: "missing", message: "Target not found in returned references" };
    const label = typeof row.label === "string" ? row.label : typeof row.name === "string" ? row.name : null;
    if (kind === "unit_label") {
      if (row.active_status === "archived") return { label, state: "inactive", message: "Archived unit target" };
      if (row.active_status === "active") return { label, state: "active", message: "Active unit target" };
    } else {
      if (row.active === false) return { label, state: "inactive", message: "Inactive reference target" };
      if (row.active === true) return { label, state: "active", message: "Active reference target" };
    }
    return { label, state: "unavailable", message: "Target activity was not provided" };
  };
  return {
    load, describe,
    hasError: () => Object.values(states).some(state => state.phase === "error"),
    isLoading: () => Object.values(states).some(state => state.phase === "loading"),
    dispose() { disposed = true; sequence++; cancelPending(); },
  };
}
