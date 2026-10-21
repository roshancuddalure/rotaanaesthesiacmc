import { COMPUTE_VERSION, ComputeError, deviceTest, finiteTime, powerPreference, record, scoreInput, validateResult } from "./compute-protocol";
import type { DeviceTest, PowerPreference, ScoreInput, ScoreResult, ComputeErrorCode } from "./compute-protocol";
export type { DeviceTest, PowerPreference } from "./compute-protocol";
export type ComputeMode = "server" | "auto" | "local_gpu";
export type Workload = "members" | "template" | "optimizer";
export interface ComputeContext { month: string; hash: string; workload?: Workload; configuration?: string; estimatedRows?: number }
export interface EngineProof { server_ms: number; local_ms: number; parity: boolean; at: number; version: number; adapter: string;
  month: string; context_hash: string; signature: string; browser: string; workload?: Workload; kernel_version?: number; configuration?: string;
  stage_timings?:Record<string,string|number>[] }
export interface ComputePreference { enabled: boolean; mode: ComputeMode; power: PowerPreference; test?: DeviceTest; proof?: EngineProof; proofs?: Partial<Record<Workload, EngineProof>> }
const KEY = "duty_rota_compute_device_v1";
const verified = new Set<string>();
let lastFailure: { code: ComputeErrorCode; at: number } | undefined;
const browser = () => navigator.userAgent;
export function preference(): ComputePreference {
  const result: ComputePreference = { enabled: false, mode: "server", power: "high-performance" };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw || raw.length > 12000) return result;
    const p: unknown = JSON.parse(raw);
    if (!record(p)) return result;
    result.enabled = p.enabled === true;
    if (["server", "auto", "local_gpu"].includes(String(p.mode))) result.mode = p.mode as ComputeMode;
    if (powerPreference(p.power)) result.power = p.power;
    if (deviceTest(p.test) && p.test.preference === result.power) result.test = p.test;
    const validProof = (proof: unknown): proof is EngineProof => {
    return record(proof) && proof.version === COMPUTE_VERSION && typeof proof.parity === "boolean" &&
        finiteTime(proof.server_ms) && proof.server_ms > 0 && finiteTime(proof.local_ms) && proof.local_ms > 0 &&
        typeof proof.at === "number" && Number.isFinite(proof.at) && proof.at <= Date.now() && Date.now() - proof.at < 7 * 86400000 &&
        typeof proof.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(proof.month) &&
        typeof proof.context_hash === "string" && proof.context_hash.length <= 128 && typeof proof.adapter === "string" && proof.adapter.length <= 160 &&
        typeof proof.signature === "string" && proof.signature === result.test?.signature && proof.browser === browser();
    };
    if(validProof(p.proof)) result.proof=p.proof;
    if(record(p.proofs)) for(const workload of ["members","template","optimizer"] as Workload[]) {
      const proof=p.proofs[workload];
      if(validProof(proof) && proof.workload===workload && proof.kernel_version===(workload==="members"?2:3) &&
        (proof.configuration===undefined || typeof proof.configuration==="string" && proof.configuration.length<=2000))
        (result.proofs ||= {})[workload]=proof;
    }
  } catch { /* Missing, blocked or corrupt storage always defaults to server. */ }
  return result;
}
export function savePreference(value: ComputePreference) {
  try { localStorage.setItem(KEY, JSON.stringify(value)); }
  catch { throw new ComputeError("unavailable", "Browser settings could not be saved. Allow site storage or use server computation."); }
}
export function resetPreference() { verified.clear(); try { localStorage.removeItem(KEY); } catch { /* Storage may be disabled. */ } }
export function invalidateDevice(reason?: unknown) {
  verified.clear();
  if (reason instanceof ComputeError) lastFailure = { code: reason.code, at: Date.now() };
  const p = preference(); delete p.proof; delete p.proofs; delete p.test;
  try { savePreference(p); } catch { /* In-memory gate still prevents reuse. */ }
}
export function rememberTest(test: DeviceTest) {
  if (!deviceTest(test) || !test.supported || !test.parity) throw new ComputeError("protocol", "Invalid GPU test result.");
  const p = preference();
  if (p.test?.signature !== test.signature) {delete p.proof;delete p.proofs;}
  p.test = test; savePreference(p); verified.add(test.signature);
  lastFailure = undefined;
}
export function selectedEngine(admin: boolean, gpuEnabled: boolean, context?: ComputeContext): "server" | "local_gpu" {
  const p = preference();
  if (!admin || !gpuEnabled || !p.enabled || !p.test?.supported || !p.test.parity || p.test.software || !verified.has(p.test.signature)) return "server";
  const workload=context?.workload || "members";
  if(workload!=="members" && !p.test.kernel_checks?.[workload]) return "server";
  if (p.mode === "local_gpu") return "local_gpu";
  if(context?.estimatedRows!==undefined && context.estimatedRows<256) return "server";
  const proof = p.proofs?.[workload] || (workload==="members"?p.proof:undefined);
  return p.mode === "auto" && proof?.parity && proof.month === context?.month && proof.context_hash === context?.hash
    && (proof.configuration || "") === (context?.configuration || "")
    && proof.local_ms <= proof.server_ms * 0.8 ? "local_gpu" : "server";
}
export async function prepareEngine(admin: boolean, gpuEnabled: boolean, context: ComputeContext, signal?: AbortSignal) {
  const p = preference();
  if (signal?.aborted || !admin || !gpuEnabled || !p.enabled || p.mode === "server") return "server" as const;
  const workload=context.workload || "members";
  if(p.mode==="auto" && (!(p.proofs?.[workload] || (workload==="members"?p.proof:undefined)) ||
      context.estimatedRows!==undefined && context.estimatedRows<256))return "server" as const;
  let worker: ComputeWorker | undefined;
  const abort = () => worker?.close();
  try {
    worker = new ComputeWorker(p.power); signal?.addEventListener("abort", abort, { once: true });
    rememberTest(await worker.call("test")); return selectedEngine(admin, gpuEnabled, context);
  }
  catch (error) { invalidateDevice(error); return "server" as const; }
  finally { signal?.removeEventListener("abort", abort); worker?.close(); }
}

export class ComputeWorker {
  private worker: Worker;
  private id = 0;
  private closed = false;
  private pending?: { id: number; type: "test" | "score"; input?: ScoreInput;
    resolve: (value: DeviceTest | ScoreResult) => void; reject: (reason: Error) => void; timer: number };
  constructor(private readonly power: PowerPreference = preference().power) {
    try { this.worker = new Worker(new URL("./compute-worker.ts", import.meta.url), { type: "module" }); }
    catch { throw new ComputeError("unavailable", "GPU worker could not start. Use server computation."); }
    this.worker.onmessage = ({ data }: MessageEvent<unknown>) => {
      const pending = this.pending;
      if (this.closed || !pending) return;
      if (!record(data) || data.id !== pending.id) { this.close(new ComputeError("protocol", "Unexpected GPU worker response.")); return; }
      clearTimeout(pending.timer); this.pending = undefined;
      try {
        if (data.error) {
          const codes: ComputeErrorCode[] = ["insecure", "unavailable", "no-adapter", "software", "invalid-input", "limits", "device-lost", "gpu-error", "parity", "busy", "protocol"];
          const code = record(data.error) && codes.includes(data.error.code as ComputeErrorCode) ? data.error.code as ComputeErrorCode : "protocol";
          throw new ComputeError(code, record(data.error) && typeof data.error.message === "string" ? data.error.message.slice(0, 300) : "GPU execution failed.");
        }
        pending.resolve(validateResult(pending.type, data.result, pending.input));
      } catch (error) { invalidateDevice(error); pending.reject(error instanceof Error ? error : new ComputeError("protocol", "Invalid GPU response.")); this.close(); }
    };
    this.worker.onerror = event => { event.preventDefault(); this.close(new ComputeError("gpu-error", "GPU worker crashed. Continue on the server.")); };
    this.worker.onmessageerror = () => this.close(new ComputeError("protocol", "GPU worker response could not be decoded."));
  }
  call(type: "test", payload?: object): Promise<DeviceTest>;
  call(type: "score", payload: object): Promise<ScoreResult>;
  call(type: "test" | "score", payload: object = {}): Promise<DeviceTest | ScoreResult> {
    return new Promise((resolve, reject) => {
      if (this.closed) { reject(new ComputeError("closed", "Local computation stopped. Retest or continue on the server.")); return; }
      if (this.pending) { reject(new ComputeError("busy", "A GPU operation is already running.")); return; }
      if (type !== "test" && type !== "score") { reject(new ComputeError("protocol", "Unknown GPU operation.")); return; }
      let input: ScoreInput | undefined;
      try { if (type === "score") input = scoreInput(payload); } catch (error) { reject(error); return; }
      const id = ++this.id;
      const timer = window.setTimeout(() => this.close(new ComputeError("timeout", "GPU timed out. Continue on the server.")), 15000);
      this.pending = { id, type, input, resolve, reject, timer };
      try { this.worker.postMessage({ id, type, preference: this.power, ...input }); }
      catch { this.close(new ComputeError("protocol", "GPU request could not be transferred. Continue on the server.")); }
    });
  }
  close(reason = new ComputeError("closed", "Local computation stopped")) {
    if (this.closed) return;
    this.closed = true; this.worker.terminate();
    if (reason.code !== "closed") invalidateDevice(reason);
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(reason); this.pending = undefined; }
  }
}

/** One fresh-worker retry per proposal, then server fallback. Never retries malformed or mismatched scores. */
export class RecoveringCompute {
  private worker?: ComputeWorker;
  private recovered = false;
  private closed = false;
  constructor(private readonly report: (message: string) => void = () => {}) {}
  async score(input: ScoreInput): Promise<ScoreResult> {
    for (;;) {
      if (this.closed) throw new ComputeError("closed", "Local computation stopped.");
      try {
        if (!this.worker) {
          this.worker = new ComputeWorker();
          const previous = preference().test?.signature;
          const test = await this.worker.call("test");
          if (test.software) throw new ComputeError("software", "Browser selected a fallback adapter. Continuing on server.");
          if("kernel" in input && input.kernel==="lexicographic" && !test.kernel_checks?.template)
            throw new ComputeError("unavailable","Ordered ranking self-test failed. Continuing on the server.");
          rememberTest(test);
          if (previous && previous !== test.signature) throw new ComputeError("protocol", "Browser-selected GPU changed. Retest and compare engines again.");
        }
        const result = await this.worker.call("score", input);
        if (result.signature !== preference().test?.signature) throw new ComputeError("protocol", "GPU changed during scoring. Continue on the server.");
        return result;
      } catch (error) {
        this.worker?.close(); this.worker = undefined; invalidateDevice(error);
        if (!this.closed && !this.recovered && error instanceof ComputeError && ["device-lost", "gpu-error"].includes(error.code)) {
          this.recovered = true; this.report("GPU interrupted. Retrying once with a fresh device…"); continue;
        }
        throw error;
      }
    }
  }
  close() { this.closed = true; this.worker?.close(); this.worker = undefined; }
}

export async function scoreFrame(input:ScoreInput & {batches?:ScoreInput[]},score:(input:ScoreInput)=>Promise<ScoreResult>) {
  if(!input.batches)return score(input);
  if(!Array.isArray(input.batches) || input.batches.length<1 || input.batches.length>32)throw new ComputeError("protocol","Invalid numeric batch envelope.");
  const results:ScoreResult[]=[];
  const began=performance.now();
  for(const frame of input.batches){
    if(performance.now()-began>20000)throw new ComputeError("timeout","Numeric batch exceeded its time budget. Continue on the server.");
    results.push(await score(frame));
  }
  if(results.some(result=>result.signature!==results[0].signature))throw new ComputeError("device-lost","GPU changed inside a numeric batch.");
  const timings={initialization_ms:0,encode_upload_ms:0,dispatch_readback_ms:0,verification_ms:0};
  for(const result of results) for(const key of Object.keys(timings) as (keyof typeof timings)[])timings[key]+=result.timings?.[key] || 0;
  return {...results[0],selections:results.map(result=>result.winner),gpu_ms:results.reduce((total,result)=>total+result.gpu_ms,0),timings};
}

export function diagnostics() {
  const p = preference();
  return { version: COMPUTE_VERSION, secure_context: isSecureContext, webgpu_available: !!navigator.gpu,
    requested_preference: p.power, browser_selected_gpu: p.test || null,
    last_failure: lastFailure || null,
    benchmark: p.proof ? { server_ms: p.proof.server_ms, local_ms: p.proof.local_ms, parity: p.proof.parity, at: p.proof.at } : null,
    note: "Browser-visible adapter information may be incomplete. This is not an installed GPU inventory." };
}
