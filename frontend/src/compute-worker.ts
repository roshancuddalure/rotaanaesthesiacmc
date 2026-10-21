/** No network access, user shaders, member names, IDs or authentication tokens. */
import { COMPUTE_VERSION, ComputeError, numericScores, powerPreference, record, scoreInput, winnerFor } from "./compute-protocol";
import type { DeviceTest, PowerPreference, ScoreInput, WorkerRequest } from "./compute-protocol";
const scope = globalThis as unknown as {
  isSecureContext: boolean; navigator: Navigator; postMessage: (value: unknown) => void;
  onmessage: (event: MessageEvent<unknown>) => void;
};
type Resources = { device: GPUDevice; pipeline: GPUComputePipeline; rankPipeline?: GPUComputePipeline; details: Omit<DeviceTest, "test_ms" | "parity">; fault?: ComputeError };
let resources: Resources | undefined;
let initialization: Promise<Resources> | undefined;
let busy = false;
const clean = (value: string | undefined) => (value || "").replace(/[\x00-\x1f\x7f]/g, "").slice(0, 160);

async function initialize(preference: PowerPreference): Promise<Resources> {
  if(resources?.fault) throw resources.fault;
  if (resources && !resources.fault && resources.details.preference === preference) return resources;
  if (initialization) return initialization;
  initialization = (async () => {
    resources?.device.destroy(); resources = undefined;
    if (!scope.isSecureContext) throw new ComputeError("insecure", "WebGPU requires HTTPS or localhost. Server computation remains available.");
    if (!scope.navigator.gpu) throw new ComputeError("unavailable", "WebGPU is unavailable. Check browser graphics acceleration or use the server.");
    const adapter = await scope.navigator.gpu.requestAdapter(preference === "default" ? {} : { powerPreference: preference });
    if (!adapter) throw new ComputeError("no-adapter", "The browser returned no GPU adapter. Check browser GPU diagnostics or use the server.");
    const info = adapter.info;
    const vendor = clean(info?.vendor), architecture = clean(info?.architecture), description = clean(info?.description), physicalDevice = clean(info?.device);
    const software = Boolean(info?.isFallbackAdapter) || /swiftshader|software|llvmpipe/i.test(`${description} ${physicalDevice}`);
    const device = await adapter.requestDevice();
    const limits = device.limits;
    const signature = JSON.stringify([COMPUTE_VERSION, preference, vendor, architecture, description, physicalDevice, software,
      limits.maxBufferSize, limits.maxStorageBufferBindingSize, limits.maxComputeWorkgroupsPerDimension]);
    const details = { supported: true, software, adapter: description || physicalDevice || vendor || "Information unavailable",
      vendor, architecture, description, device: physicalDevice, signature, preference, version: COMPUTE_VERSION };
    let created: Resources | undefined;
    device.lost.then(() => { if (created) created.fault = new ComputeError("device-lost", "GPU device was lost. Retest or continue on the server."); });
    device.addEventListener("uncapturederror", () => { if (created) created.fault = new ComputeError("gpu-error", "The GPU reported an execution error. Continue on the server."); });
    device.pushErrorScope("validation");
    try {
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
      const pipeline = await device.createComputePipelineAsync({ layout: "auto", compute: { module, entryPoint: "main" } });
      const error = await device.popErrorScope();
      if (error) throw new ComputeError("gpu-error", "GPU scoring pipeline could not be validated.");
      created = { device, pipeline, details }; resources = created;
      return created;
    } catch (error) { device.destroy(); throw error; }
  })();
  try { return await initialization; } finally { initialization = undefined; }
}

async function gpuScores(input: ScoreInput, preference: PowerPreference) {
  const began=performance.now();
  const active = await initialize(preference);
  const initialized=performance.now();
  const { device } = active;
  const rank = "kernel" in input && input.kernel === "lexicographic";
  const width = input.rows[0].length;
  if (active.fault) throw active.fault;
  const byteLength = (rank ? 2 + input.rows.length * (width + 1) : input.rows.length * 9) * 4, outputBytes = input.rows.length * 4;
  if (byteLength > device.limits.maxStorageBufferBindingSize || byteLength > device.limits.maxBufferSize ||
      outputBytes > device.limits.maxStorageBufferBindingSize || outputBytes > device.limits.maxBufferSize ||
      Math.ceil(input.rows.length / 64) > device.limits.maxComputeWorkgroupsPerDimension || device.limits.maxComputeInvocationsPerWorkgroup < 64 ||
      device.limits.maxComputeWorkgroupSizeX < 64)
    throw new ComputeError("limits", "Scoring batch exceeds this GPU's limits. Continue on the server.");
  const buffers: GPUBuffer[] = [];
  let mapped: GPUBuffer | undefined;
  device.pushErrorScope("out-of-memory"); device.pushErrorScope("internal"); device.pushErrorScope("validation");
  let scores: number[] = [], failure: unknown;
  let submitted=initialized,readback=initialized;
  try {
    let pipeline = active.pipeline;
    if (rank && !active.rankPipeline) {
      const module = device.createShaderModule({code:`
        @group(0) @binding(0) var<storage, read> inputs: array<i32>;
        @group(0) @binding(1) var<storage, read_write> scores: array<i32>;
        @compute @workgroup_size(64)
        fn main(@builtin(global_invocation_id) id: vec3<u32>) {
          let count=u32(inputs[0]); let width=u32(inputs[1]); let row=id.x;
          if(row>=count) {return;}
          let start=2u+row*(width+1u); var rank=0i;
          for(var other=0u;other<count;other=other+1u) {
            let candidate=2u+other*(width+1u); var lower=false; var same=true;
            for(var col=0u;col<width;col=col+1u) {
              let a=inputs[candidate+col]; let b=inputs[start+col];
              if(a<b) {lower=true;same=false;break;} if(a>b) {same=false;break;}
            }
            if(lower || (same && inputs[candidate+width]<inputs[start+width])) {rank=rank+1i;}
          }
          scores[row]=rank;
        }`});
      active.rankPipeline = await device.createComputePipelineAsync({layout:"auto",compute:{module,entryPoint:"main"}});
    }
    if(rank) pipeline=active.rankPipeline!;
    const data = new Int32Array(byteLength / 4);
    if(rank) {data[0]=input.rows.length;data[1]=width;input.rows.forEach((row,i)=>{
      const start=2+i*(width+1);data.set(row,start);data[start+width]=input.ties[i];
    });} else input.rows.forEach((row, i) => data.set(row, i * 9));
    const buffer = (size: number, usage: GPUBufferUsageFlags) => {
      const b = device.createBuffer({ size, usage }); buffers.push(b); return b;
    };
    const source = buffer(byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    const output = buffer(outputBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
    const read = buffer(outputBytes, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
    device.queue.writeBuffer(source, 0, data);
    const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: source } }, { binding: 1, resource: { buffer: output } }] });
    const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass();
    pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.dispatchWorkgroups(Math.ceil(input.rows.length / 64)); pass.end();
    encoder.copyBufferToBuffer(output, 0, read, 0, outputBytes); device.queue.submit([encoder.finish()]);submitted=performance.now();
    await read.mapAsync(GPUMapMode.READ); mapped = read;
    scores = Array.from(new Int32Array(read.getMappedRange().slice(0)));
    readback=performance.now();
    if (active.fault) throw active.fault;
  } catch (error) { failure = error; }
  finally {
    mapped?.unmap(); for (const buffer of buffers) buffer.destroy();
    for (let i = 0; i < 3; i++) {
      try { if (await device.popErrorScope()) failure ||= new ComputeError("gpu-error", "GPU allocation or execution failed. Continue on the server."); }
      catch (error) { failure ||= error; }
    }
  }
  if (failure) throw active.fault || failure;
  const verificationStarted=performance.now();
  const expected = numericScores(input);
  if (scores.length !== expected.length || scores.some((n, i) => n !== expected[i])) throw new ComputeError("parity", "GPU and CPU score parity failed.");
  return { scores, active, timings:{initialization_ms:initialized-began,encode_upload_ms:submitted-initialized,
    dispatch_readback_ms:readback-submitted,verification_ms:performance.now()-verificationStarted} };
}

scope.onmessage = async ({ data }) => {
  const id = record(data) && Number.isSafeInteger(data.id) && Number(data.id) > 0 ? Number(data.id) : 0;
  try {
    if (!id || !record(data) || !["test", "score"].includes(String(data.type)) || !powerPreference(data.preference))
      throw new ComputeError("protocol", "Invalid GPU worker request.");
    if (busy) throw new ComputeError("busy", "GPU worker is busy. Continue on the server.");
    busy = true;
  } catch (error) { scope.postMessage({ id, error: { code: error instanceof ComputeError ? error.code : "protocol", message: "Invalid or overlapping GPU request." } }); return; }
  try {
    const request = data as WorkerRequest;
    const input = request.type === "test" ? { rows: Array.from({ length: 512 }, (_, i) => Array.from({ length: 9 }, (_, j) => (i + j) % 997)), ties: Array.from({ length: 512 }, (_, i) => i) } : scoreInput(request);
    const started = performance.now();
    const { scores, active, timings } = await gpuScores(input, request.preference);
    const kernelChecks={members:true,template:false,optimizer:false};
    if(request.type === "test") {
      try {
        await gpuScores(scoreInput({kernel:"lexicographic",version:3,
          rows:[[-2147483648,2147483647],[-2147483647,-2147483648],[-2147483648,2147483647]],ties:[2,1,0]}),request.preference);
        kernelChecks.template=true;kernelChecks.optimizer=true;
      }catch(error){if(active.fault)throw active.fault;/* Keep verified member scoring available; rank-dependent workloads use server fallback. */}
    }
    scope.postMessage({ id, result: request.type === "test" ? { ...active.details, parity: true, test_ms: performance.now() - started,
      kernel_checks:kernelChecks } :
      { scores, winner: winnerFor(scores, input.ties), gpu_ms: performance.now() - started, signature: active.details.signature,timings } });
  } catch (error) {
    scope.postMessage({ id, error: { code: error instanceof ComputeError ? error.code : "gpu-error",
      message: error instanceof ComputeError ? error.message : "GPU execution failed. Retest or continue on the server." } });
  } finally { busy = false; }
};
