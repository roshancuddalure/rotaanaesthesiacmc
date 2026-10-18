/** Numeric-only worker. No member names, IDs, account data or authentication tokens. */
export {};
type GPUDeviceHandle = any;
const scope = globalThis as unknown as { postMessage: (value: unknown) => void;
  onmessage: (event: MessageEvent) => void; navigator: Navigator & { gpu?: any } };
let device: GPUDeviceHandle;
let pipeline: any;
let adapterLabel = "";
let software = false;

async function initialize() {
  if (device) return;
  if (!scope.navigator.gpu) throw new Error("WebGPU is unavailable in this browser. Server computation remains available.");
  const adapter = await scope.navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new Error("No usable GPU adapter. Check browser hardware acceleration or use the server.");
  const info = adapter.info || {};
  software = Boolean(info.isFallbackAdapter ?? adapter.isFallbackAdapter)
    || /swiftshader|software|llvmpipe/i.test(`${info.description || ""} ${info.device || ""}`);
  adapterLabel = info.description || info.device || info.vendor || "Browser GPU adapter";
  device = await adapter.requestDevice();
  device.lost.then(() => { device = undefined; pipeline = undefined; });
  const module = device.createShaderModule({ code: `
    @group(0) @binding(0) var<storage, read> inputs: array<i32>;
    @group(0) @binding(1) var<storage, read_write> scores: array<i32>;
    @compute @workgroup_size(64)
    fn main(@builtin(global_invocation_id) id: vec3<u32>) {
      if (id.x >= arrayLength(&scores)) { return; }
      var score: i32 = 0;
      for (var j: u32 = 0; j < 9; j = j + 1) { score = score + inputs[id.x * 9 + j]; }
      scores[id.x] = score;
    }` });
  pipeline = await device.createComputePipelineAsync({ layout: "auto", compute: { module, entryPoint: "main" } });
}

function cpuScores(rows: number[][]): number[] {
  if (!rows.length || rows.length > 100000) throw new Error("Scoring batch size is out of range.");
  return rows.map(row => {
    if (row.length !== 9 || row.some(n => !Number.isSafeInteger(n) || n < 0 || n > 2147483647))
      throw new Error("Invalid score inputs. Use server computation.");
    const sum = row.reduce((a, b) => a + b, 0);
    if (sum > 2147483647) throw new Error("Score exceeds the exact GPU integer range.");
    return sum;
  });
}

async function gpuScores(rows: number[][]): Promise<number[]> {
  await initialize();
  const active = device;
  const data = new Int32Array(rows.flat());
  if (data.byteLength > active.limits.maxStorageBufferBindingSize
      || Math.ceil(rows.length / 64) > active.limits.maxComputeWorkgroupsPerDimension)
    throw new Error("This batch exceeds the GPU device limits. Use the server.");
  const input = active.createBuffer({ size: data.byteLength, usage: 128 | 8 });
  const output = active.createBuffer({ size: rows.length * 4, usage: 128 | 4 });
  const read = active.createBuffer({ size: rows.length * 4, usage: 1 | 8 });
  try {
    active.queue.writeBuffer(input, 0, data);
    const bindGroup = active.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: input } }, { binding: 1, resource: { buffer: output } }] });
    const encoder = active.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(rows.length / 64)); pass.end();
    encoder.copyBufferToBuffer(output, 0, read, 0, rows.length * 4);
    active.queue.submit([encoder.finish()]);
    await read.mapAsync(1);
    return Array.from(new Int32Array(read.getMappedRange().slice(0)));
  } finally { input.destroy(); output.destroy(); read.destroy(); }
}

scope.onmessage = async ({ data }) => {
  try {
    if (data.type === "test") {
      const rows = Array.from({ length: 512 }, (_, i) => Array.from({ length: 9 }, (_, j) => (i + j) % 997));
      const expected = cpuScores(rows);
      const started = performance.now();
      const actual = await gpuScores(rows);
      if (actual.some((n, i) => n !== expected[i])) throw new Error("GPU and CPU score parity failed.");
      scope.postMessage({ id: data.id, result: { supported: true, software, adapter: adapterLabel,
        test_ms: performance.now() - started, rows: rows.length, parity: true } });
    } else {
      const expected = cpuScores(data.rows);
      const started = performance.now();
      const scores = await gpuScores(data.rows);
      if (scores.some((n, i) => n !== expected[i])) throw new Error("GPU and CPU score parity failed.");
      let winner = 0;
      for (let i = 1; i < scores.length; i++)
        if (scores[i] < scores[winner] || (scores[i] === scores[winner] && data.ties[i] < data.ties[winner])) winner = i;
      scope.postMessage({ id: data.id, result: { winner, scores, gpu_ms: performance.now() - started } });
    }
  } catch (error) { scope.postMessage({ id: data.id, error: error instanceof Error ? error.message : "GPU computation failed" }); }
};
