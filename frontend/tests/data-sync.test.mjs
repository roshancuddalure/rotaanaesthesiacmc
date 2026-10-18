import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/data-sync.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;
const sync = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("committed mutations invalidate dependents; previews and auth leave drafts alone", () => {
  const priorWindow=globalThis.window, priorStorage=globalThis.localStorage;
  globalThis.window=new EventTarget();
  const stored=[];
  globalThis.localStorage={setItem:(...args)=>stored.push(args)};
  try {
    const notices=[];
    const unsubscribe=sync.onDataChange(value=>notices.push(value.path));
    sync.notifyDataChange("/api/v1/admin/members", "GET");
    sync.notifyDataChange("/api/v1/admin/members/import/preview", "POST");
    sync.notifyDataChange("/api/v1/unit-management/import-preview?month=2026-10", "POST");
    sync.notifyDataChange("/api/v1/auth/sign-in", "POST");
    sync.notifyDataChange("/api/v1/rota-compute/jobs", "POST");
    sync.notifyDataChange("/api/v1/rota-compute/jobs/job/step", "POST");
    sync.notifyDataChange("/api/v1/rota-compute/jobs/job/validate", "POST");
    sync.notifyDataChange('/api/v1/rota-intelligence/jobs','POST');
    sync.notifyDataChange('/api/v1/rota-intelligence/jobs/job/select','POST');
    sync.notifyDataChange('/api/v1/rota-intelligence/jobs/job/examples','POST');
    assert.deepEqual(notices,[]);
    sync.notifyDataChange("/api/v1/members/person/call-changes", "POST");
    sync.notifyDataChange("/api/v1/admin/past-duties/apply", "POST");
    assert.deepEqual(notices,["/api/v1/members/person/call-changes","/api/v1/admin/past-duties/apply"]);
    assert.equal(stored.length,2);
    const external=new Event("storage");
    Object.assign(external,{key:"duty_rota_data_revision",newValue:JSON.stringify({path:"/api/v1/leave/import-apply",at:123})});
    window.dispatchEvent(external);
    assert.equal(notices.at(-1),"/api/v1/leave/import-apply");
    unsubscribe();
    sync.notifyDataChange("/api/v1/unit-management/assignments", "DELETE");
    assert.equal(notices.length,3);
  } finally {globalThis.window=priorWindow;globalThis.localStorage=priorStorage;}
});
