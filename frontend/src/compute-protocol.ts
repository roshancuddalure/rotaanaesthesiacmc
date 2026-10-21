/** Numeric-only protocol. Hardware metadata is local diagnostics, never an identity or authority. */
export const COMPUTE_VERSION = 2;
export const MAX_ROWS = 100000;
export type PowerPreference = "default" | "high-performance" | "low-power";
export type ComputeErrorCode = "insecure" | "unavailable" | "no-adapter" | "software" | "invalid-input" |
  "limits" | "device-lost" | "gpu-error" | "parity" | "timeout" | "closed" | "busy" | "protocol";
export class ComputeError extends Error {
  constructor(public readonly code: ComputeErrorCode, message: string) { super(message); this.name = "ComputeError"; }
}
export interface ScoreInput { rows: number[][]; ties: number[] }
export interface RankInput extends ScoreInput { kernel: "lexicographic"; version: 3 }
export type NumericInput = ScoreInput | RankInput;
export interface DeviceTest {
  supported: boolean; software: boolean; adapter: string; vendor: string; architecture: string;
  description: string; device: string; test_ms: number; parity: boolean; signature: string;
  preference: PowerPreference; version: number;
  kernel_checks?: {members: boolean; template: boolean; optimizer: boolean};
}
export interface ScoreResult { winner: number; scores: number[]; gpu_ms: number; signature: string;
  timings?:{initialization_ms:number;encode_upload_ms:number;dispatch_readback_ms:number;verification_ms:number} }
export type WorkerRequest = { id: number; preference: PowerPreference } &
  ({ type: "test" } | ({ type: "score" } & NumericInput));
export const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export const finiteTime = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 86400000;
export const powerPreference = (v: unknown): v is PowerPreference => typeof v === "string" && ["default", "high-performance", "low-power"].includes(v);
export function scoreInput(value: unknown): ScoreInput {
  if (record(value) && value.kernel === "lexicographic") return rankInput(value);
  if(record(value) && value.kernel!==undefined)throw new ComputeError("invalid-input","Unknown numeric kernel. Continue on the server.");
  if (!record(value) || !Array.isArray(value.rows) || !value.rows.length || value.rows.length > MAX_ROWS ||
      !Array.isArray(value.ties) || value.ties.length !== value.rows.length)
    throw new ComputeError("invalid-input", "Invalid scoring batch or tie order. Continue on the server.");
  const rows = value.rows as unknown[];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== 9) throw new ComputeError("invalid-input", "Each scoring row must contain nine integers.");
    let sum = 0;
    for (const n of row) {
      if (!Number.isSafeInteger(n) || n < 0 || n > 2147483647) throw new ComputeError("invalid-input", "Scoring inputs must be non-negative 32-bit integers.");
      sum += n;
    }
    if (sum > 2147483647) throw new ComputeError("invalid-input", "Score exceeds the exact GPU integer range.");
  }
  if (Array.from(value.ties).some(n => !Number.isSafeInteger(n) || n < 0 || n > 2147483647) || new Set(value.ties).size !== rows.length)
    throw new ComputeError("invalid-input", "Tie order must contain distinct non-negative integers.");
  return { rows: value.rows as number[][], ties: value.ties as number[] };
}
export function cpuScores(input: ScoreInput) { return input.rows.map(row => row.reduce((sum, n) => sum + n, 0)); }
export function rankInput(value: unknown): RankInput {
  if (!record(value) || value.version !== 3 || !Array.isArray(value.rows) || !value.rows.length || value.rows.length > 4096 ||
      !Array.isArray(value.ties) || value.ties.length !== value.rows.length) throw new ComputeError("invalid-input", "Invalid lexicographic ranking batch.");
  const width = Array.isArray(value.rows[0]) ? value.rows[0].length : 0;
  if (width < 1 || width > 32) throw new ComputeError("invalid-input", "Ranking requires between one and 32 ordered objectives.");
  for (const row of value.rows) {
    if (!Array.isArray(row) || row.length !== width || Array.from(row).some(n => !Number.isInteger(n) || n < -2147483648 || n > 2147483647))
      throw new ComputeError("invalid-input", "Ranking values must be signed 32-bit integers.");
  }
  if (Array.from(value.ties).some(n => !Number.isInteger(n) || n < 0 || n > 2147483647) || new Set(value.ties).size !== value.rows.length)
    throw new ComputeError("invalid-input", "Ranking requires distinct integer tie values.");
  return { kernel: "lexicographic", version: 3, rows: value.rows, ties: value.ties };
}
export function cpuRanks(input: ScoreInput) {
  const order = input.rows.map((_,i) => i).sort((a,b) => {
    for(let col=0;col<input.rows[a].length;col++) { const d=input.rows[a][col]-input.rows[b][col]; if(d) return d; }
    return input.ties[a]-input.ties[b];
  });
  const result = Array(order.length).fill(0); order.forEach((index,rank)=>result[index]=rank); return result as number[];
}
export const numericScores = (input: ScoreInput) => "kernel" in input && input.kernel === "lexicographic" ? cpuRanks(input) : cpuScores(input);
export function winnerFor(scores: number[], ties: number[]) {
  let winner = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i] < scores[winner] || (scores[i] === scores[winner] && ties[i] < ties[winner])) winner = i;
  return winner;
}
export function deviceTest(value: unknown): value is DeviceTest {
  return record(value) && value.version === COMPUTE_VERSION && typeof value.supported === "boolean" &&
    typeof value.software === "boolean" && typeof value.parity === "boolean" && finiteTime(value.test_ms) && powerPreference(value.preference) &&
    (value.kernel_checks===undefined || record(value.kernel_checks) && ["members","template","optimizer"].every(k=>typeof (value.kernel_checks as Record<string,unknown>)[k]==="boolean")) &&
    ["adapter", "vendor", "architecture", "description", "device", "signature"].every(k => typeof value[k] === "string" && (value[k] as string).length <= 2048);
}
export function validateResult(type: "test" | "score", value: unknown, input?: ScoreInput): DeviceTest | ScoreResult {
  if (type === "test" && deviceTest(value) && value.supported && value.parity) return value;
  if (type === "score" && record(value) && input && Array.isArray(value.scores) && value.scores.length === input.rows.length &&
      finiteTime(value.gpu_ms) && typeof value.signature === "string" && value.signature.length <= 2048 && Number.isSafeInteger(value.winner)) {
    const expected = numericScores(input);
    if (Array.from(value.scores).every((n, i) => n === expected[i]) && value.winner === winnerFor(expected, input.ties)) return value as unknown as ScoreResult;
    throw new ComputeError("parity", "GPU results disagreed with exact CPU scoring. Continue on the server.");
  }
  throw new ComputeError("protocol", "Invalid response from the GPU worker. Continue on the server.");
}
