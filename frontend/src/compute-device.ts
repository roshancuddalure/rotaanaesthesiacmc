export type ComputeMode = "server" | "auto" | "local_gpu";
export interface DeviceTest { supported: boolean; software: boolean; adapter: string; test_ms: number; parity: boolean }
export interface EngineProof { server_ms: number; local_ms: number; parity: boolean; at: number; version: 1; adapter: string;
  month: string; context_hash: string }
export interface ComputePreference { enabled: boolean; mode: ComputeMode; test?: DeviceTest; proof?: EngineProof }
const KEY = "duty_rota_compute_device_v1";

export function preference(): ComputePreference {
  try { return { enabled: false, mode: "server", ...JSON.parse(localStorage.getItem(KEY) || "{}") }; }
  catch { return { enabled: false, mode: "server" }; }
}
export function savePreference(value: ComputePreference) { localStorage.setItem(KEY, JSON.stringify(value)); }
export function resetPreference() { localStorage.removeItem(KEY); }
export function selectedEngine(admin: boolean, gpuEnabled: boolean, context?: { month: string; hash: string }): "server" | "local_gpu" {
  const p = preference();
  if (!admin || !gpuEnabled || !p.enabled || !p.test?.supported || p.test.software) return "server";
  if (p.mode === "local_gpu") return "local_gpu";
  const proof = p.proof;
  return p.mode === "auto" && proof?.parity && proof.version === 1
    && proof.month === context?.month && proof.context_hash === context?.hash
    && proof.adapter === p.test.adapter && Date.now() - proof.at < 7 * 86400000
    && proof.local_ms <= proof.server_ms * 0.8 ? "local_gpu" : "server";
}

export class ComputeWorker {
  private worker = new Worker(new URL("./compute-worker.ts", import.meta.url), { type: "module" });
  private id = 0;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (reason: Error) => void; timer: number }>();
  constructor() {
    this.worker.onmessage = ({ data }) => {
      const request = this.pending.get(data.id);
      if (!request) return;
      clearTimeout(request.timer); this.pending.delete(data.id);
      if (data.error) request.reject(new Error(data.error)); else request.resolve(data.result);
    };
    this.worker.onerror = () => this.close();
  }
  call(type: "test" | "score", payload: object = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      const timer = window.setTimeout(() => {
        this.pending.delete(id); reject(new Error("GPU timed out. Continue on the server.")); this.close();
      }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, type, ...payload });
    });
  }
  close() {
    this.worker.terminate();
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error("Local computation stopped")); }
    this.pending.clear();
  }
}
