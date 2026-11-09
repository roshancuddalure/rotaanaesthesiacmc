// Scratch-only independent-review server. Product source stays unchanged.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {createServer} from 'vite';
const target=path.resolve('src/record-workspace.ts');
const candidate=await readFile('../tmp/reference-picker-retention-v2/record-workspace.candidate.ts','utf8');
const server=await createServer({configFile:false,root:process.cwd(),plugins:[{name:'scratch-reference-retention-only',enforce:'pre',load(id){if(path.resolve(id.split('?')[0])===target)return candidate;}}],server:{host:'127.0.0.1',port:Number(process.argv[2]||5233),strictPort:true}});
await server.listen();
console.log(JSON.stringify({origin:`http://127.0.0.1:${server.config.server.port}`,candidate_sha256:createHash('sha256').update(candidate).digest('hex'),scope:'Only record-workspace.ts picker helper overlaid; source unchanged; no API interception supplied by this server.'}));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close().then(()=>process.exit(0)));
