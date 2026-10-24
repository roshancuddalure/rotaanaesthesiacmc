// Preserve the existing runtime info filter while the shared API declaration is narrower.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import ts from 'typescript';
const path='src/rota-rules.ts',before=await readFile(path,'utf8');
const matches=[...before.matchAll(/\b(problem|p)\.severity !== "info"/g)];
assert.equal(matches.length,3,'Reinspect changed concurrent source before editing');
const after=before.replace(/\b(problem|p)\.severity !== "info"/g,'($1.severity as string) !== "info"');
const emit=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
assert.equal(emit(before),emit(after),'Type-only compatibility must preserve executable output exactly');
assert.equal(await readFile(path,'utf8'),before,'Concurrent change; retry from current source');
const sha=s=>createHash('sha256').update(s).digest('hex');
await writeFile('../docs/premium-ui/reviews/rules-severity-type-compat-current.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),scope:'Three erased TypeScript assertions only. Concurrent rota rules implementation and API declaration retained; runtime info filtering byte-for-byte unchanged after TypeScript transpilation. No permission/rule/API/backend modification.',before_sha256:sha(before),source_sha256:{'frontend/src/rota-rules.ts':sha(after)},transpiled_js_equal:true,transpiled_js_sha256:sha(emit(after)),completion_claim:false},null,2)+'\n');
await writeFile(path,after);console.log('Applied three erased assertions; executable TypeScript output identical.');
