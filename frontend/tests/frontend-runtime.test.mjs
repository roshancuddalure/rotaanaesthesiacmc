import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

const compile = source => ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020}}).outputText;
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(compile(source)).toString("base64")}`;
const runtimeUrl = moduleUrl(await readFile(new URL("../src/frontend-runtime.ts", import.meta.url), "utf8"));
const runtime = await import(runtimeUrl);
const errorUrl = moduleUrl(await readFile(new URL("../src/api-errors.ts", import.meta.url), "utf8"));
let apiSource = await readFile(new URL("../src/services/api.ts", import.meta.url), "utf8");
apiSource = apiSource.replace('import { notifyDataChange } from "../data-sync";', 'const notifyDataChange = (path: string, method: string) => (globalThis as any).__changes.push({path, method});')
  .replace('from "../api-errors"', `from ${JSON.stringify(errorUrl)}`)
  .replace('from "../frontend-runtime"', `from ${JSON.stringify(runtimeUrl)}`)
  .replace('export { downloadPreviewIssues } from "../import-report";', '')
  .replaceAll("import.meta.env", "({DEV: false, VITE_API_BASE_URL: ''})");
globalThis.__changes = [];
const api = await import(moduleUrl(apiSource));
const originalFetch = globalThis.fetch;

test('current-session401 preserves refusal, signals once and stops repeat changes until explicit sign-in',async()=>{
 const previousWindow=globalThis.window,events=[],calls=[];
 try {
  globalThis.window={dispatchEvent:event=>events.push(event.type)};
  api.setAuthToken('expired-test');
  globalThis.fetch=async(url,options)=>{
   calls.push({url,method:options.method||'GET'});
   if(url.endsWith('/auth/sign-in'))return new Response(JSON.stringify({token:'renewed-test',user:{id:'one'}}),{status:200});
   if(url.endsWith('/save')&&options.headers.get('Authorization')==='Bearer renewed-test')return new Response('{"saved":true}',{status:200});
   return new Response('{"detail":"Session no longer valid"}',{status:401});
  };
  await assert.rejects(api.request('/api/v1/example/save',{method:'POST',body:'{}'}),e=>e.status===401&&e.message==='Session no longer valid');
  assert.deepEqual(events,['duty-rota:session-expired']);
  await assert.rejects(api.request('/api/v1/example/save',{method:'POST',body:'{}'}),/draft has not been submitted again/);
  await assert.rejects(api.memberWorkbookRequest('apply',new File(['x'],'x.csv'),{header_row:1,sheet:'CSV',mapping:{},resolutions:{}}),/draft has not been submitted again/);
  assert.equal(calls.length,1,'No repeat JSON or multipart mutation reaches network');
  await assert.rejects(api.request('/api/v1/example/read'),e=>e.status===401);
  assert.equal(events.length,1,'Repeated refused reads do not create expiry prompt loops');
  await api.signIn('example','test-password');
  assert.equal(calls.filter(call=>call.url.endsWith('/save')).length,1,'Sign-in does not replay failed save');
  assert.deepEqual(await api.request('/api/v1/example/save',{method:'POST',body:'{}'}),{saved:true});
  assert.equal(calls.filter(call=>call.url.endsWith('/save')).length,2,'Explicit new submission uses renewed session');
 }finally{globalThis.window=previousWindow;globalThis.fetch=originalFetch;api.clearAuthToken();}
});

test('403 and bad sign-in401 do not mark the current session expired; old-account401 cannot expire new account',async()=>{
 const previousWindow=globalThis.window,events=[];
 try{
  globalThis.window={dispatchEvent:event=>events.push(event.type)};api.setAuthToken('valid-test');
  let calls=0;
  globalThis.fetch=async()=>{calls++;return new Response('{"detail":"Forbidden for this role"}',{status:403});};
  for(let i=0;i<2;i++)await assert.rejects(api.request('/api/v1/example/save',{method:'POST',body:'{}'}),e=>e.status===403);
  assert.equal(calls,2);assert.equal(events.length,0);
  globalThis.fetch=async()=>new Response('{"detail":"Bad credentials"}',{status:401});
  await assert.rejects(api.signIn('wrong','wrong'),e=>e.status===401);assert.equal(events.length,0);
  globalThis.fetch=async()=>{api.setAuthToken('new-account-test');return new Response('{"detail":"Old session"}',{status:401});};
  await assert.rejects(api.request('/api/v1/example/save',{method:'POST',body:'{}'}),/save outcome is not confirmed/);
  assert.equal(events.length,0,'Late old-account refusal cannot invalidate renewed session');
  globalThis.fetch=async()=>new Response('{"saved":true}',{status:200});
  assert.deepEqual(await api.request('/api/v1/example/save',{method:'POST',body:'{}'}),{saved:true});
 }finally{globalThis.window=previousWindow;globalThis.fetch=originalFetch;api.clearAuthToken();}
});

test('all protected download helpers reject old-account data before and after blob decoding',async()=>{
 try{
  const downloads=[()=>api.downloadPastDutyTemplate(),()=>api.downloadMemberImportTemplate('csv'),()=>api.downloadRejectedImportRows('leave','batch1'),()=>api.downloadRotaExport('2026-10'),()=>api.downloadRotaTemplateEagleEyeExport('2026-10'),()=>api.downloadRotaTemplateCallWiseExport('2026-10')];
  for(const download of downloads)for(const stage of ['response','body']){
   api.setAuthToken('download-original');let calls=0;
   globalThis.fetch=async()=>{
    calls++;if(stage==='response')api.setAuthToken('download-replacement');
    return{ok:true,status:200,headers:new Headers(),blob:async()=>{if(stage==='body')api.setAuthToken('download-replacement');return new Blob(['private bytes']);}};
   };
   await assert.rejects(download(),error=>error.name==='AbortError'&&/Session changed/.test(error.message));assert.equal(calls,1);
  }
 }finally{globalThis.fetch=originalFetch;api.clearAuthToken();}
});

test('empty authenticated artifacts are rejected without retries across all download entry points',async()=>{
 try {
  api.setAuthToken('empty-download-test');
  const downloads=[()=>api.downloadPastDutyTemplate(),()=>api.downloadMemberImportTemplate('csv'),()=>api.downloadRejectedImportRows('leave','batch1'),()=>api.downloadRotaExport('2026-10'),()=>api.downloadRotaTemplateEagleEyeExport('2026-10'),()=>api.downloadRotaTemplateCallWiseExport('2026-10'),()=>api.requestDownload('/api/v1/example/report')];
  for(const download of downloads)for(const status of [200,204]){
   let calls=0;
   globalThis.fetch=async()=>{calls++;return new Response(status===204?null:'',{status});};
   await assert.rejects(download(),error=>error.kind==='invalid-response'&&error.status===status&&/empty download/.test(error.message));
   assert.equal(calls,1,'An empty artifact must not be fetched again automatically');
  }
 }finally{globalThis.fetch=originalFetch;api.clearAuthToken();}
});

test('obsolete sign-in forms cannot commit a token after tab replacement or a newer sign-in',async()=>{
 try {
  api.clearAuthToken();let release;
  globalThis.fetch=async(_url,options)=>{
   const body=JSON.parse(options.body);
   if(body.username==='older')return new Promise(resolve=>release=()=>resolve(new Response(JSON.stringify({token:'old-fake-token',user:{id:'old'}}),{status:200})));
   return new Response(JSON.stringify({token:'new-fake-token',user:{id:'new'}}),{status:200});
  };
  let oldCurrent=true;
  const old=api.signIn('older','fake-password',()=>oldCurrent);
  oldCurrent=false;
  release();await assert.rejects(old,error=>error.name==='AbortError');
  oldCurrent=true;
  const replaced=api.signIn('older','fake-password',()=>oldCurrent);
  oldCurrent=false;
  const fresh=await api.signIn('newer','fake-password');
  assert.equal(fresh.user.id,'new');
  release();await assert.rejects(replaced,error=>error.name==='AbortError'||/session changed/i.test(error.message));
  let authorization;
  globalThis.fetch=async(_url,options)=>{authorization=new Headers(options.headers).get('Authorization');return new Response('{}',{status:200});};
  await api.request('/api/v1/example');
  assert.equal(authorization,'Bearer new-fake-token');
 }finally{globalThis.fetch=originalFetch;api.clearAuthToken();}
});

test('protected download401 signals expiry and successful exports preserve exact filename and bytes',async()=>{
 const previousWindow=globalThis.window,events=[];
 try{
  globalThis.window={dispatchEvent:event=>events.push(event.type)};api.setAuthToken('download-test');
  globalThis.fetch=async()=>new Response('{"detail":"Sign-in required"}',{status:401});
  await assert.rejects(api.downloadRotaExport('2026-10'),error=>error.status===401);
  assert.deepEqual(events,['duty-rota:session-expired']);
  api.setAuthToken('download-renewed');
  globalThis.fetch=async()=>new Response('PK\x03\x04-expected-original-export-bytes',{status:200,headers:{'Content-Disposition':'attachment; filename="reviewed-export.xlsx"','Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}});
  for(const download of [api.downloadRotaExport,api.downloadRotaTemplateEagleEyeExport,api.downloadRotaTemplateCallWiseExport]){
   const result=await download('2026-10');assert.equal(result.filename,'reviewed-export.xlsx');assert.equal(await result.blob.text(),'PK\x03\x04-expected-original-export-bytes');
  }
 }finally{globalThis.window=previousWindow;globalThis.fetch=originalFetch;api.clearAuthToken();}
});

test('spreadsheet downloads reject non-workbook documents and preserve valid transport bytes',async()=>{
 try{
  api.setAuthToken('spreadsheet-validation');
  const valid=new Uint8Array([0x50,0x4b,0x03,0x04,7,8,9]);
  for(const download of [api.downloadRotaExport,api.downloadRotaTemplateEagleEyeExport,api.downloadRotaTemplateCallWiseExport]){
   for(const [body,type] of [['<html>Gateway error</html>','text/html'],['{"detail":"Error"}','application/json'],['not a workbook','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],['PK','application/octet-stream']]){
    globalThis.fetch=async()=>new Response(body,{headers:{'Content-Type':type}});
    await assert.rejects(download('2026-05'),error=>error.kind==='invalid-response'&&/did not return an Excel workbook/.test(error.message));
   }
   for(const type of ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/octet-stream','application/zip',null]){
    globalThis.fetch=async()=>new Response(valid,{headers:type?{'Content-Type':type}:{}});
    assert.deepEqual(new Uint8Array(await(await download('2026-05')).blob.arrayBuffer()),valid);
   }
  }
 }finally{globalThis.fetch=originalFetch;api.clearAuthToken();}
});

test('spreadsheet header decoding rejects a changed session before returning private bytes',async()=>{
 try{
  api.setAuthToken('download-old-session');
  globalThis.fetch=async()=>({ok:true,status:200,blob:async()=>({size:7,type:'application/zip',slice:()=>({arrayBuffer:async()=>{api.setAuthToken('download-new-session');return new Uint8Array([0x50,0x4b,0x03,0x04]).buffer;}})})});
  await assert.rejects(api.downloadRotaExport('2026-05'),error=>error.name==='AbortError');
 }finally{globalThis.fetch=originalFetch;api.clearAuthToken();}
});

test('spreadsheet reads time out without retry, including a stalled response body',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});
 try{
  api.setAuthToken('download-deadline');let calls=0;
  for(const download of [api.downloadRotaExport,api.downloadRotaTemplateEagleEyeExport,api.downloadRotaTemplateCallWiseExport]){
   globalThis.fetch=async(_url,{signal})=>{calls++;return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Read stopped','AbortError')),{once:true}));};
   const rejected=assert.rejects(download('2026-05'),error=>error.kind==='timeout'&&/server may still/.test(error.message));
   t.mock.timers.tick(120000);await rejected;
  }
  assert.equal(calls,3,'No automatic download retry');
  let signal;
  globalThis.fetch=async(_url,options)=>{signal=options.signal;return {ok:true,status:200,blob:()=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Body stopped','AbortError')),{once:true}))};};
  const pending=api.downloadRotaExport('2026-05');await Promise.resolve();await Promise.resolve();
  const rejected=assert.rejects(pending,error=>error.kind==='timeout');t.mock.timers.tick(120000);await rejected;
 }finally{t.mock.timers.reset();globalThis.fetch=originalFetch;api.clearAuthToken();}
});

test('successful spreadsheet handoff clears its deadline and network failures remain explicit',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});
 try{
  api.setAuthToken('download-cleanup');let signal;
  globalThis.fetch=async(_url,options)=>{signal=options.signal;return new Response(new Uint8Array([0x50,0x4b,3,4,9]));};
  await api.downloadRotaExport('2026-05');t.mock.timers.tick(240000);assert.equal(signal.aborted,false,'Completed download has no remaining abort timer');
  globalThis.fetch=async()=>{throw new TypeError('network failure');};
  await assert.rejects(api.downloadRotaExport('2026-05'),error=>error.kind==='network');
 }finally{t.mock.timers.reset();globalThis.fetch=originalFetch;api.clearAuthToken();}
});

test('shared import and report helpers preserve multipart bodies and reject old-account error details',async()=>{
 try{
  const body=new FormData();body.append('file',new File(['member,date\nExample,2026-10-21'],'leave.csv'));body.append('settings','{"mode":"append"}');
  api.setAuthToken('shared-original');let calls=0;
  globalThis.fetch=async(url,options)=>{
   calls++;assert.equal(url,'/api/v1/import-review/leave/preview');assert.equal(options.method,'POST');assert.equal(options.body,body);assert.equal(options.headers.Authorization,'Bearer shared-original');assert.equal(options.headers['Content-Type'],undefined);
   return new Response('{"id":"preview1","rows":[]}',{status:200});
  };
  assert.deepEqual(await api.requestMultipartJSON('/api/v1/import-review/leave/preview',body),{id:'preview1',rows:[]});assert.equal(calls,1);
  for(const operation of [()=>api.request('/api/v1/example'),()=>api.request('/api/v1/example',{method:'POST',body:'{}'}),()=>api.requestMultipartJSON('/api/v1/import-review/columns',body),()=>api.requestDownload('/api/v1/extra-duty/report')]){
   api.setAuthToken('error-original');
   globalThis.fetch=async()=>({ok:false,status:403,json:async()=>{api.setAuthToken('error-replacement');return{detail:'PRIVATE OLD ACCOUNT DETAIL'};}});
   await assert.rejects(operation(),error=>!error.message.includes('PRIVATE')&&(error.name==='AbortError'||/session changed/i.test(error.message)));
  }
 }finally{globalThis.fetch=originalFetch;api.clearAuthToken();}
});

test('shared multipart previews provide actionable malformed-response and safe network fallback without retry',async()=>{
 try{
  api.setAuthToken('preview-test');let calls=0;const body=new FormData();
  globalThis.fetch=async()=>{calls++;return new Response('<html>not JSON</html>',{status:200});};
  await assert.rejects(api.requestMultipartJSON('/api/v1/import-review/columns',body),error=>error.kind==='invalid-response'&&/unreadable preview/.test(error.message));assert.equal(calls,1);
  globalThis.fetch=async()=>{calls++;throw new TypeError('Private URL or transport detail');};
  await assert.rejects(api.requestMultipartJSON('/api/v1/import-review/columns',body),error=>error.kind==='network'&&!error.message.includes('Private'));assert.equal(calls,2);
 }finally{globalThis.fetch=originalFetch;api.clearAuthToken();}
});

test("multipart imports reject old-session success before and after decoding without replay", async () => {
  try {
    for (const kind of ['members', 'past', 'leave-apply', 'leave-preview', 'units-apply', 'units-preview']) for (const stage of ['response', 'body']) {
      api.setAuthToken('upload-original');
      let calls = 0;
      globalThis.fetch = async (_url, options) => {
        calls++;
        assert.equal(options.method, 'POST');
        assert.equal(options.headers.Authorization, 'Bearer upload-original');
        assert.equal(options.body.get('preview_hash'), kind.endsWith('preview') ? null : 'reviewed-upload');
        if (stage === 'response') api.setAuthToken('upload-replacement');
        return { ok: true, status: 200, json: async () => {
          if (stage === 'body') api.setAuthToken('upload-replacement');
          return { applied: 1 };
        } };
      };
      const file = new File(['name\nExample'], 'review.csv', {type:'text/csv'});
      const operation = kind === 'members' ? api.memberWorkbookRequest('apply', file, {sheet:'CSV',header_row:1,mapping:{},resolutions:{}}, 'reviewed-upload')
        : kind === 'past' ? api.pastDutyUpload('apply', file, {header_row:1}, 'reviewed-upload')
        : kind === 'leave-apply' ? api.applyLeaveImport('2026-10', file, 'reviewed-upload')
        : kind === 'leave-preview' ? api.previewLeaveImport('2026-10', file)
        : kind === 'units-apply' ? api.applyUnitAssignmentImport('2026-10', file, false, {}, 'reviewed-upload')
        : api.previewUnitAssignmentImport('2026-10', file, false);
      await assert.rejects(operation, /session changed.*save outcome is not confirmed/i);
      assert.equal(calls, 1);
    }
  } finally { globalThis.fetch = originalFetch; api.clearAuthToken(); }
});

test("stored working months reject impossible values before any context change", () => {
  for (const value of [null, undefined, '', '0000-01', '2026-00', '2026-13', '2026-5', '2026-05-01', '<script>']) assert.equal(runtime.isValidWorkingMonth(value), false);
  for (const value of ['2026-01', '2026-12', '2000-02']) assert.equal(runtime.isValidWorkingMonth(value), true);
});

test("restricted storage uses memory without dropping set/remove operations", () => {
  const storage = runtime.createSafeStorage(() => { throw new DOMException("Blocked", "SecurityError"); });
  assert.equal(storage.getItem("preference"), null);
  storage.setItem("preference", "royal");
  assert.equal(storage.getItem("preference"), "royal");
  storage.removeItem("preference");
  assert.equal(storage.getItem("preference"), null);
});

test("available browser storage retains existing values and actual removals", () => {
  const values = new Map([["existing", "yes"]]);
  const storage = runtime.createSafeStorage(() => ({getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key)}));
  assert.equal(storage.getItem("existing"), "yes");
  storage.setItem("existing", "updated");
  assert.equal(values.get("existing"), "updated");
  storage.removeItem("existing");
  assert.equal(values.has("existing"), false);
  assert.equal(runtime.frontendBuildIdentity(), "development");
});

test("quota failures preserve session writes and failed removals cannot restore stale tokens", () => {
  const storage = runtime.createSafeStorage(() => ({
    getItem: () => "old-value",
    setItem: () => { throw new DOMException("Quota exceeded", "QuotaExceededError"); },
    removeItem: () => { throw new DOMException("Restricted", "SecurityError"); },
  }));
  assert.equal(storage.getItem("token"), "old-value");
  storage.setItem("token", "new-value");
  assert.equal(storage.getItem("token"), "new-value");
  storage.removeItem("token");
  assert.equal(storage.getItem("token"), null);
});

test("request lifecycle preserves headers, payloads and structured server status", async () => {
  try {
    let captured;
    api.setAuthToken("test-token");
    globalThis.fetch = async (url, options) => { captured = {url, options}; return new Response('{"id":"saved"}', {status: 200}); };
    assert.deepEqual(await api.request("/api/v1/example", {method: "POST", body: '{"x":1}', headers: {"X-Test": "preserved"}}), {id: "saved"});
    assert.equal(captured.options.body, '{"x":1}');
    assert.equal(captured.options.method, "POST");
    assert.equal(captured.options.headers.get("X-Test"), "preserved");
    assert.equal(captured.options.headers.get("Authorization"), "Bearer test-token");
    globalThis.fetch = async () => new Response('{"detail":{"code":"stale","message":"Review again"}}', {status: 409});
    await assert.rejects(api.request("/api/v1/example"), error => error.kind === "http" && error.status === 409 && error.detail.code === "stale" && error.message === "Review again");
  } finally { api.clearAuthToken(); globalThis.fetch = originalFetch; }
});

test("204 success is accepted while empty JSON and HTML errors remain actionable", async () => {
  try {
    globalThis.fetch = async () => new Response(null, {status: 204});
    assert.equal(await api.request("/api/v1/example", {method: "DELETE"}), undefined);
    globalThis.fetch = async () => new Response("", {status: 200});
    await assert.rejects(api.request("/api/v1/example"), error => error.kind === "invalid-response" && error.status === 200);
    await assert.rejects(api.request("/api/v1/example", {method: "PUT", body: "{}"}), /Check the current record/);
    globalThis.fetch = async () => new Response("<h1>Gateway failed</h1>", {status: 502});
    await assert.rejects(api.request("/api/v1/example"), error => error.kind === "http" && error.status === 502 && !error.message.includes("<h1>"));
  } finally { globalThis.fetch = originalFetch; }
});

test("read deadline is bounded and caller cancellation remains AbortError", async () => {
  try {
    let count = 0;
    globalThis.fetch = async (_url, options) => {
      count++;
      return new Promise((_resolve, reject) => {
        if (options.signal.aborted) reject(new DOMException("Aborted", "AbortError"));
        options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {once: true});
      });
    };
    await assert.rejects(api.request("/api/v1/example", {readTimeoutMs: 5}), error => error.kind === "timeout");
    const controller = new AbortController();
    const pending = api.request("/api/v1/example", {signal: controller.signal});
    controller.abort();
    await assert.rejects(pending, error => error.name === "AbortError");
    assert.equal(count, 2, "No failed request is automatically retried");
  } finally { globalThis.fetch = originalFetch; }
});

test("mutation lifetime is unchanged and uncertain saves are never replayed", async () => {
  try {
    let count = 0;
    globalThis.fetch = async (_url, options) => {
      count++;
      await new Promise(resolve => setTimeout(resolve, 15));
      assert.equal(options.signal.aborted, false);
      throw new TypeError("network details containing a private URL");
    };
    await assert.rejects(api.request("/api/v1/example", {method: "POST", body: "{}", readTimeoutMs: 1}), error => error.kind === "network" && error.message.includes("not confirmed") && !error.message.includes("private URL"));
    assert.equal(count, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test("startup and reload recovery remain CSP compatible and user controlled", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const bootstrap = await readFile(new URL("../public/frontend-bootstrap.js", import.meta.url), "utf8");
  const source = await readFile(new URL("../src/frontend-runtime.ts", import.meta.url), "utf8");
  assert.match(html, /id="frontend-startup"/);
  assert.match(html, /src="\/frontend-bootstrap\.js"/);
  assert.doesNotMatch(html, /onclick=/);
  assert.match(bootstrap, /window.confirm/);
  assert.match(source, /window.confirm/);
  assert.equal((source.match(/location\.reload\(/g) ?? []).length, 1);
  assert.doesNotMatch(source, /setTimeout\([^]*location\.reload/);
  const frontendImage = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
  const combinedImage = await readFile(new URL('../../Dockerfile', import.meta.url), 'utf8');
  assert.match(frontendImage, /^COPY public \.\/public$/m, 'Standalone frontend image must package bootstrap and downloadable templates');
  assert.match(combinedImage, /^COPY frontend\/public \.\/public$/m, 'Combined image retains existing public assets');
});

test("late bootstrap respects completed app readiness without false startup warnings", async () => {
  const source = await readFile(new URL("../public/frontend-bootstrap.js", import.meta.url), "utf8");
  let timers = 0;
  let created = 0;
  const listeners = new Map();
  const document = {
    documentElement: {dataset: {frontendReady: "true"}},
    getElementById: () => null,
    createElement() { created++; throw new Error("A ready app must not show startup recovery"); },
  };
  vm.runInNewContext(source, {
    document,
    window: {addEventListener: (name, listener) => listeners.set(name, listener)},
    setTimeout() { timers++; return 1; }, clearTimeout() {},
    HTMLScriptElement: class {}, HTMLLinkElement: class {},
  });
  assert.equal(timers, 0);
  assert.equal(created, 0);
  assert.ok(listeners.has("duty-rota:frontend-ready"));
});

test("startup watchdog rechecks readiness when its callback was already queued", async () => {
  const source = await readFile(new URL("../public/frontend-bootstrap.js", import.meta.url), "utf8");
  let callback;
  let created = 0;
  const document = {
    documentElement: {dataset: {}}, getElementById: () => null,
    createElement() { created++; throw new Error("Queued callback must respect readiness"); },
  };
  vm.runInNewContext(source, {
    document, window: {addEventListener() {}},
    setTimeout(fn) { callback = fn; return 1; }, clearTimeout() {},
    HTMLScriptElement: class {}, HTMLLinkElement: class {},
  });
  document.documentElement.dataset.frontendReady = "true";
  callback();
  assert.equal(created, 0);
});

test("cross-tab sign-out rejects an old-account read and clears later authorization", async () => {
  const target = new EventTarget();
  target.localStorage = {};
  const stop = api.installSessionSynchronization(target);
  let changed = 0;
  target.addEventListener("duty-rota:session-changed", () => changed++);
  try {
    api.setAuthToken("old-account");
    let finish;
    globalThis.fetch = () => new Promise(resolve => { finish = resolve; });
    const pending = api.request("/api/v1/example");
    const event = new Event("storage");
    Object.assign(event, {key: "duty_rota_auth_token", newValue: null, storageArea: target.localStorage});
    target.dispatchEvent(event);
    finish(new Response('{"private":"old-account-data"}', {status: 200}));
    await assert.rejects(pending, error => error.name === "AbortError");
    assert.equal(changed, 1);
    globalThis.fetch = async (_url, options) => {
      assert.equal(options.headers.has("Authorization"), false);
      return new Response("{}", {status: 200});
    };
    await api.request("/api/v1/example");
  } finally { stop(); api.clearAuthToken(); globalThis.fetch = originalFetch; }
});

test("session change never replays an uncertain mutation or treats it as saved", async () => {
  const target = new EventTarget();
  target.localStorage = {};
  const stop = api.installSessionSynchronization(target);
  try {
    api.setAuthToken("old-account");
    let finish;
    let calls = 0;
    globalThis.fetch = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
    const pending = api.request("/api/v1/example", {method: "POST", body: "{}"});
    const event = new Event("storage");
    Object.assign(event, {key: null, newValue: null, storageArea: target.localStorage});
    target.dispatchEvent(event);
    finish(new Response('{"saved":true}', {status: 200}));
    await assert.rejects(pending, error => error.kind === "network" && /session changed/.test(error.message) && /not confirmed/.test(error.message));
    assert.equal(calls, 1);
  } finally { stop(); api.clearAuthToken(); globalThis.fetch = originalFetch; }
});

test("account changes while a response body is decoding also suppress private results", async () => {
  const target = new EventTarget(); target.localStorage = {};
  const stop = api.installSessionSynchronization(target);
  try {
    api.setAuthToken("old-account");
    let finishBody;
    let decoding;
    const started = new Promise(resolve => { decoding = resolve; });
    globalThis.fetch = async () => ({ok: true, status: 200, json() { decoding(); return new Promise(resolve => { finishBody = resolve; }); }});
    const pending = api.request("/api/v1/example");
    await started;
    const event = new Event("storage");
    Object.assign(event, {key: "duty_rota_auth_token", newValue: null, storageArea: target.localStorage});
    target.dispatchEvent(event);
    finishBody({private: "old-account-data"});
    await assert.rejects(pending, error => error.name === "AbortError");
  } finally { stop(); api.clearAuthToken(); globalThis.fetch = originalFetch; }
});

test("multipart apply cannot confirm an old-account save after switching accounts", async () => {
  try {
    api.setAuthToken("old-account");
    let finish;
    let calls = 0;
    globalThis.fetch = (_url, options) => {
      calls++;
      assert.equal(options.headers.Authorization, "Bearer old-account");
      assert.equal(options.body.get("preview_hash"), "reviewed-hash");
      return new Promise(resolve => { finish = resolve; });
    };
    const pending = api.memberWorkbookRequest("apply", new Blob(["name\nMember"]),
      {sheet: "Members", header_row: 1, mapping: {}, resolutions: {}}, "reviewed-hash");
    api.clearAuthToken();
    api.setAuthToken("new-account");
    finish(new Response('{"saved":true}', {status: 200}));
    await assert.rejects(pending, error => /session changed/i.test(error.message) && /not confirmed/i.test(error.message));
    assert.equal(calls, 1, "An uncertain upload must never be replayed");
  } finally { api.clearAuthToken(); globalThis.fetch = originalFetch; }
});
