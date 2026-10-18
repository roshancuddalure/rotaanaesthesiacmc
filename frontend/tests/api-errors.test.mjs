import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const source=await readFile(new URL("../src/api-errors.ts",import.meta.url),"utf8");
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;
const errors=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("structured validation identifies member fields and preserves ordinary server messages",()=>{
  assert.equal(errors.formatApiError([{loc:["body","canonical_name"],msg:"Invalid member name"},{loc:["body","call_level"],msg:"Unknown call"}],"HTTP 422"),"canonical name: Invalid member name; call level: Unknown call");
  assert.equal(errors.formatApiError({message:"Preview changed. Review again."},"HTTP 409"),"Preview changed. Review again.");
  assert.equal(errors.formatApiError("Member already exists","HTTP 409"),"Member already exists");
  assert.equal(errors.formatApiError([{unknown:true}],"HTTP 422"),"HTTP 422");
  assert.equal(errors.formatApiError(null,"HTTP 500"),"HTTP 500");
});
test("public network failures give deployment-appropriate recovery instructions",()=>{
  const publicMessage=errors.networkRecoveryMessage(false);
  assert.ok(publicMessage.includes("department administrator"));
  assert.ok(!publicMessage.includes("launch.bat"));
  assert.ok(errors.networkRecoveryMessage(true).includes("local backend"));
});
