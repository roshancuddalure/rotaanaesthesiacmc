import { request } from "./services/api";
import { workspaceDialog } from "./member-workspace";
import { ComputeWorker, RecoveringCompute, preference, savePreference, resetPreference, prepareEngine, rememberTest, invalidateDevice, diagnostics } from "./compute-device";
import { COMPUTE_VERSION } from "./compute-protocol";

type Engine = "server" | "local_gpu";
type Decision = { slot_id: string; date: string; duty: string; unit: string; action: string;
  person_id: string | null; person_name: string | null; reason: string; score: number | null };
interface Burden { members: number; before: Record<string, {min: number; max: number; mean: number}>; after: Record<string, {min: number; max: number; mean: number}> }
interface Job { burden: Burden; id: string; month: string; status: string; engine: Engine; revision: number;
  processed: number; total: number; proposed: number; unresolved: number; decisions: Decision[];
  frame?: { token: string; rows: number[][]; ties: number[] }; error?: string;
  fallback_reason?: string; context_hash: string; metrics: { planning_ms: number; steps: number }; result?: { assigned: number } }
interface Capabilities { enabled: boolean; browser_gpu: boolean; context_hash: string }
const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const post = <T>(path: string, data = {}) => request<T>(`/api/v1/rota-compute/${path}`,
  { method: "POST", body: JSON.stringify(data), signal: AbortSignal.timeout(30000) });
const capabilities = (month?: string) => request<Capabilities>(`/api/v1/rota-compute/capabilities${month ? `?month=${encodeURIComponent(month)}` : ""}`, { signal: AbortSignal.timeout(10000) });
const start = (month: string, engine: Engine) => post<Job>("jobs", { month, engine });
const step = (job: Job, extra: object = {}) => post<Job>(`jobs/${job.id}/step`, { revision: job.revision, ...extra });

export async function renderComputeSettings(host: HTMLElement) {
  let testWorker: ComputeWorker | undefined;
  let busy = false;
  let month = new Date().toISOString().slice(0, 7);
  let status = "Local computation is off until you enable it on this browser.";
  let caps: Capabilities;
  try { caps = await capabilities(); }
  catch (error) { host.textContent = error instanceof Error ? error.message : "Unable to load compute settings"; return; }
  function render() {
    if (!host.isConnected) return;
    const p = preference();
    host.innerHTML = `<section class="panel compute-settings"><h2>Compute Settings</h2>
      <p>Use this computer for optional rota scoring. Other computers keep their own settings.
      Keep this page open while computing. Server computation is always the fallback.</p>
      ${!caps.enabled ? '<p role="status">Reviewed compute is disabled by the deployment administrator.</p>' : ""}
      ${!caps.browser_gpu ? '<p role="status">Browser GPU is disabled by the deployment administrator.</p>' : ""}
      <label><input type="checkbox" data-compute-enable ${p.enabled ? "checked" : ""}
        ${!caps.enabled || !caps.browser_gpu || busy ? "disabled" : ""}> Allow GPU computation on this browser</label>
      <label>Compute mode<select data-compute-mode ${busy ? "disabled" : ""}>
      <option value="server" ${p.mode === "server" ? "selected" : ""}>Server</option>
      <option value="auto" ${p.mode === "auto" ? "selected" : ""}>Automatic — use measured results</option>
      <option value="local_gpu" ${p.mode === "local_gpu" ? "selected" : ""}>Prefer local GPU — pilot</option></select></label>
      <label>GPU power preference<select data-compute-power ${busy ? "disabled" : ""}>
        <option value="default" ${p.power === "default" ? "selected" : ""}>Browser default</option>
        <option value="high-performance" ${p.power === "high-performance" ? "selected" : ""}>Prefer performance</option>
        <option value="low-power" ${p.power === "low-power" ? "selected" : ""}>Prefer power saving</option>
      </select></label>
      <p>This is a browser hint. WebGPU cannot list every installed GPU or select NVIDIA by name.
      Chrome on Windows may ignore this preference and keep using its assigned GPU.</p>
      <details><summary>NVIDIA or another GPU is missing</summary>
        <p>Check graphics acceleration in browser settings, then open chrome://gpu (or edge://gpu) to inspect the browser-selected GPU.
        Set the browser's graphics preference to High performance in Windows Settings → System → Display → Graphics, restart the browser and retest.
        Chrome also documents chrome://flags/#force-high-performance-gpu as a browser-wide option requiring a restart.
        Do not bypass driver blocklists or enable unsafe WebGPU flags.</p>
        <p>These settings are controlled by you and the browser. This page cannot switch Windows GPU settings or combine multiple GPUs.</p>
      </details>
      <p>Automatic uses the server unless an exact-result comparison on this device proves local execution
      is at least 20% faster, including network, transfer and validation time. Three runs per engine include cold GPU startup and full schedule validation. Results expire after seven days or when rota data changes.</p>
      <div class="registry-actions"><button type="button" data-compute-test ${busy || !caps.browser_gpu || !caps.enabled ? "disabled" : ""}>Test Device</button>
      <button type="button" data-compute-reset ${busy ? "disabled" : ""}>Reset device settings</button></div>
      ${p.test ? `<div class="compute-diagnostics"><p>Browser-selected GPU: ${escape(p.test.adapter)}. Exact score check: ${p.test.parity ? "passed" : "failed"}.
      ${p.test.software ? "Fallback adapter detected; rota generation will use the server." : "Browser reports a hardware adapter."}</p>
      <dl><dt>Vendor</dt><dd>${escape(p.test.vendor || "Information unavailable")}</dd><dt>Architecture</dt><dd>${escape(p.test.architecture || "Information unavailable")}</dd>
      <dt>Device</dt><dd>${escape(p.test.device || "Information unavailable")}</dd><dt>Description</dt><dd>${escape(p.test.description || "Information unavailable")}</dd></dl>
      <p>Browser privacy settings may hide details. The current GPU is checked again before local generation.</p></div>` : "<p>No current device test. Test Device to check browser GPU availability.</p>"}
      <button type="button" data-compute-diagnostics>Download GPU diagnostics</button>
      <label>Draft month for comparison<input type="month" data-compute-month value="${month}" ${busy ? "disabled" : ""}></label>
      <button type="button" data-compute-compare ${busy || !p.enabled || !p.test?.supported || p.test.software || !caps.enabled || !caps.browser_gpu ? "disabled" : ""}>Compare engines on this month</button>
      <p>Comparison creates and cancels six proposals. It never applies assignments or publishes a rota.</p>
      ${p.proof ? `<p>Last comparison: server ${(p.proof.server_ms / 1000).toFixed(2)} s;
      local ${(p.proof.local_ms / 1000).toFixed(2)} s; matching decisions: ${p.proof.parity ? "yes" : "no"}.</p>` : ""}
      <p role="status" aria-live="polite" data-compute-status>${escape(status)}</p></section>`;
  }
  render();
  host.onchange = event => {
    const input = event.target as HTMLInputElement;
    const p = preference();
    if (input.matches("[data-compute-month]")) { month = input.value; return; }
    if (input.matches("[data-compute-power]")) {
      invalidateDevice(); const next = preference(); next.power = input.value as typeof next.power;
      try { savePreference(next); status = "Power preference changed. Test the device and compare engines again."; }
      catch (error) { status = error instanceof Error ? error.message : "Unable to save settings"; }
      render(); return;
    }
    try {
      if (input.matches("[data-compute-enable]")) { p.enabled = input.checked; savePreference(p); render(); }
      if (input.matches("[data-compute-mode]")) { p.mode = input.value as typeof p.mode; savePreference(p); render(); }
    } catch (error) { status = error instanceof Error ? error.message : "Unable to save settings"; render(); }
  };
  host.onclick = async event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!button || busy) return;
    if (button.matches("[data-compute-diagnostics]")) {
      const url = URL.createObjectURL(new Blob([JSON.stringify(diagnostics(), null, 2)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = "rota-gpu-diagnostics.json"; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000); return;
    }
    if (button.matches("[data-compute-reset]")) { resetPreference(); status = "Device settings reset. GPU computation is off."; render(); return; }
    if (!button.matches("[data-compute-test], [data-compute-compare]")) return;
    const month = host.querySelector<HTMLInputElement>("[data-compute-month]")!.value;
    busy = true; status = "Testing…"; render();
    try {
      testWorker = new ComputeWorker();
      const test = await testWorker.call("test");
      rememberTest(test);
      if (button.matches("[data-compute-compare]")) {
        const reports: { job: Job; elapsed: number; engine: Engine }[] = [];
        for (const engine of ["server", "local_gpu", "local_gpu", "server", "server", "local_gpu"] as Engine[]) {
          if (engine === "local_gpu") { testWorker.close(); testWorker = new ComputeWorker(); }
          let job: Job | undefined;
          const began = performance.now();
          try {
            job = await start(month, engine);
            while (["queued", "running"].includes(job.status)) {
              if (!host.isConnected) throw new Error("Comparison stopped after leaving settings. Proposals were cancelled.");
              const result = job.frame ? await testWorker.call("score", job.frame) : undefined;
              if (result && result.signature !== test.signature) throw new Error("Browser-selected GPU changed. Retest before comparing engines.");
              job = await step(job, result ? { selection: result.winner, token: job.frame!.token } : {});
              const message = host.querySelector("[data-compute-status]");
              if (message) message.textContent = `Comparing ${engine === "server" ? "server" : "local GPU"}: ${job.processed} of ${job.total} slots`;
            }
            if (job.status !== "completed") throw new Error(job.error || "Comparison did not complete");
            await post(`jobs/${job.id}/validate`, { revision: job.revision });
            reports.push({ job, elapsed: performance.now() - began, engine });
          } finally { if (job) await post(`jobs/${job.id}/cancel`); }
        }
        const choices = (job: Job) => job.decisions.map(d => [d.slot_id, d.person_id, d.action, d.score]);
        if (!reports[0].job.total || !reports[0].job.proposed) throw new Error("This month has no eligible workload to benchmark. Choose a populated draft month.");
        const same = reports.every(r => r.job.context_hash === reports[0].job.context_hash
          && JSON.stringify(choices(r.job)) === JSON.stringify(choices(reports[0].job)));
        const median = (engine: Engine) => reports.filter(r => r.engine === engine).map(r => r.elapsed).sort((a,b) => a-b)[1];
        const latest = preference();
        latest.proof = { server_ms: median("server"), local_ms: median("local_gpu"),
          month, context_hash: reports[0].job.context_hash,
          parity: same, at: Date.now(), version: COMPUTE_VERSION, adapter: test.adapter, signature: test.signature, browser: navigator.userAgent };
        savePreference(latest);
        status = same ? "Comparison complete. Automatic mode will use the measured faster path when the threshold is met."
          : "Results differed. Automatic mode will use the server.";
      } else status = "Device test passed. This confirms exact scoring support; it does not promise a faster rota run.";
    } catch (error) { invalidateDevice(); status = `${error instanceof Error ? error.message : "Device test failed"} Server computation remains available.`; }
    finally { testWorker?.close(); busy = false; render(); }
  };
  const observer = new MutationObserver(() => {
    if (!host.isConnected || !host.querySelector(".compute-settings")) { testWorker?.close(); observer.disconnect(); }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

export async function openRotaCompute(month: string, admin: boolean, onApplied: () => void) {
  const dialog = workspaceDialog("Generate and review rota draft", "compute-workspace");
  let job: Job | undefined;
  let running = false;
  let closed = false;
  let worker: RecoveringCompute | undefined;
  let notice = "";
  let elapsed = 0;
  let actionBusy = false;
  const lifetime = new AbortController();
  let caps: Capabilities;
  dialog.innerHTML = '<p class="mw-content" role="status">Loading compute options…</p>';
  dialog.showModal();
  dialog.addEventListener("close", () => { closed = true; running = false; lifetime.abort(); worker?.close(); dialog.remove(); });
  try {
    caps = await capabilities(month);
    if (!caps.enabled) throw new Error("Reviewed compute is disabled by the administrator.");
    const recent = await request<Job[]>(`/api/v1/rota-compute/jobs?month=${encodeURIComponent(month)}`, { signal: AbortSignal.timeout(10000) });
    job = recent.find(j => ["queued", "running", "completed"].includes(j.status));
  } catch (error) { dialog.innerHTML = `<div class="mw-content"><p role="alert">${escape(error instanceof Error ? error.message : error)}</p><button data-close>Close</button></div>`;
    dialog.querySelector("button")!.addEventListener("click", () => dialog.close()); return; }
  function render() {
    if (closed) return;
    const focused = dialog.contains(document.activeElement)
      ? document.activeElement?.getAttributeNames().find(name => name.startsWith("data-")) : undefined;
    const active = job && ["queued", "running"].includes(job.status);
    dialog.innerHTML = `<header class="mw-header"><div><h2>Generate and review rota draft</h2><p>${escape(month)} · ${job ? escape(job.engine === "server" ? "Server" : "Local GPU pilot") : "Ready"}</p></div>
      <button type="button" data-close aria-label="Close compute review">Close</button></header>
      <div class="mw-content"><p>Existing assignments are preserved. Proposed choices are saved only after review and final server validation.</p>
      <p role="status" aria-live="polite">${escape(notice || job?.error || (job ? job.status : "Choose Generate to prepare a proposal."))}</p>
      ${job ? `<progress max="${Math.max(1, job.total)}" value="${job.processed}" aria-label="Generation progress"></progress>
      <p>${job.processed} of ${job.total} slots checked · ${job.proposed} proposed · ${job.unresolved} need review</p>
      <p>Planning: ${(job.metrics.planning_ms / 1000).toFixed(2)} s on server; this session: ${(elapsed / 1000).toFixed(2)} s.</p>
      ${job.burden ? `<details><summary>Workload comparison across ${job.burden.members} active posted members</summary><p>Before ? proposed monthly duties per member. These counts describe workload; all safety rules are checked separately.</p>
      <dl>${[["total", "All duties"], ["hours24", "24-hour duties"], ["weekend24", "Weekend 24-hour duties"]].map(([key,label]) => `<dt>${label}</dt><dd>${job!.burden.before[key].min}?${job!.burden.before[key].max} (mean ${job!.burden.before[key].mean}) ? ${job!.burden.after[key].min}?${job!.burden.after[key].max} (mean ${job!.burden.after[key].mean})</dd>`).join("")}</dl></details>` : ""}
      <div class="table-scroll" tabindex="0" aria-label="Proposed rota changes"><table><thead><tr><th>Date / duty</th><th>Proposal</th><th>Reason</th></tr></thead><tbody>
      ${job.decisions.map(d => `<tr><td data-label="Date / duty">${escape(d.date)}<small>${escape(d.unit)} · ${escape(d.duty)}</small></td>
      <td data-label="Proposal">${escape(d.person_name || d.action)}</td><td data-label="Reason">${escape(d.reason)}</td></tr>`).join("")}</tbody></table></div>` : ""}
      </div><footer class="mw-footer">
      ${!job || ["failed", "cancelled", "applied"].includes(job.status) ? '<button type="button" class="primary" data-generate>Generate proposal</button>' : ""}
      ${active && !running ? '<button type="button" class="primary" data-resume>Continue generation</button>' : ""}
      ${active && !running && job?.engine === "local_gpu" ? '<button type="button" data-server-fallback>Continue on server</button>' : ""}
      ${active || job?.status === "completed" ? '<button type="button" data-cancel>Cancel proposal</button>' : ""}
      ${job?.status === "completed" ? '<label><input type="checkbox" data-review-confirm> I reviewed the proposed changes and unresolved slots</label><button type="button" class="primary" data-apply disabled>Apply reviewed draft</button>' : ""}
      ${job?.decisions.length ? '<button type="button" data-download>Download report</button>' : ""}
      </footer>`;
    if (focused) dialog.querySelector<HTMLButtonElement>(`[${focused}]`)?.focus({ preventScroll: true });
  }
  async function run() {
    if (!job || running) return;
    running = true; notice = "Calculating…"; render();
    const began = performance.now();
    try {
      while (running && !closed && ["queued", "running"].includes(job.status)) {
        let extra: object = {};
        if (job.frame) {
          try {
            worker ||= new RecoveringCompute(message => { notice = message; render(); });
            const result = await worker.score(job.frame);
            extra = { selection: result.winner, token: job.frame.token };
          } catch (error) {
            if (!running || closed) break;
            notice = `${error instanceof Error ? error.message : "GPU failed"} Continuing on server.`;
            worker?.close(); worker = undefined; extra = { fallback: true };
          }
        }
        if (!running || closed) break;
        let next: Job;
        try { next = await step(job, extra); }
        catch (error) {
          const status = (error as { status?: number })?.status;
          if (status === 422 && "selection" in extra) {
            invalidateDevice(); worker?.close(); worker = undefined;
            notice = "Server rejected the GPU result. Continuing with server scoring.";
            next = await step(job, { fallback: true });
          } else if (status === undefined || status >= 500) {
            // A response may be lost after the server commits a step. Recover its
            // revision first; retry only once, with the same idempotent revision.
            const current = await request<Job>(`/api/v1/rota-compute/jobs/${job.id}`, { signal: AbortSignal.timeout(10000) });
            if (!running || closed) break;
            next = current.revision !== job.revision || !["queued", "running"].includes(current.status) ? current : await step(current, extra);
          } else throw error;
        }
        if (!running || closed) break;
        job = next; elapsed = performance.now() - began; render();
      }
      if (job.status === "completed" && !closed && running) {
        await post(`jobs/${job.id}/validate`, { revision: job.revision });
        elapsed = performance.now() - began;
        notice = `Draft ready for review. No assignments have been applied. ${job.fallback_reason || ""}`;
      } else if (!closed && running && !["queued", "running"].includes(job.status)) {
        notice = job.error || `Proposal ${job.status}. Existing assignments were preserved.`;
      }
    } catch (error) { notice = `${error instanceof Error ? error.message : "Computation interrupted"}. You can retry or resume this proposal.`;
      try { job = await request<Job>(`/api/v1/rota-compute/jobs/${job.id}`, { signal: AbortSignal.timeout(10000) }); } catch { /* Preserve last known progress. */ }
    } finally { running = false; worker?.close(); worker = undefined; render(); }
  }
  dialog.onchange = () => { const apply = dialog.querySelector<HTMLButtonElement>("[data-apply]");
    if (apply) apply.disabled = !dialog.querySelector<HTMLInputElement>("[data-review-confirm]")?.checked; };
  dialog.onclick = async event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!button) return;
    if (button.matches("[data-close]")) { closed = true; running = false; worker?.close(); dialog.close(); dialog.remove(); return; }
    if (button.matches("[data-download]")) {
      const url = URL.createObjectURL(new Blob([JSON.stringify({ ...job, session_elapsed_ms: elapsed }, null, 2)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = `rota-compute-${month}.json`; link.click(); URL.revokeObjectURL(url); return;
    }
    if (actionBusy) return;
    actionBusy = true;
    button.disabled = true;
    try {
      if (button.matches("[data-generate]")) {
        notice = "Checking compute device…"; render();
        const engine = await prepareEngine(admin, caps.browser_gpu, { month, hash: caps.context_hash }, lifetime.signal);
        if (closed) return;
        job = await start(month, engine); notice = engine === "server" && preference().mode !== "server" ? "Using server computation after device checks." : ""; actionBusy = false; await run();
      } else if (button.matches("[data-resume]")) { actionBusy = false; await run(); }
      else if (button.matches("[data-server-fallback]")) { job = await step(job!, { fallback: true }); actionBusy = false; await run(); }
      else if (button.matches("[data-cancel]")) {
        running = false; worker?.close();
        job = await post<Job>(`jobs/${job!.id}/cancel`);
        notice = job.status === "applied" ? "This draft was already applied. Its saved assignments were preserved."
          : "Proposal cancelled. Existing assignments were preserved.";
      } else if (button.matches("[data-apply]") && dialog.querySelector<HTMLInputElement>("[data-review-confirm]")?.checked) {
        job = await post<Job>(`jobs/${job!.id}/apply`, { revision: job!.revision });
        notice = `${job.result?.assigned ?? 0} assignments applied to the draft. The rota has not been published.`; onApplied();
      }
    } catch (error) { notice = error instanceof Error ? error.message : "Unable to complete this action"; }
    finally { actionBusy = false; render(); }
  };
  render();
}
