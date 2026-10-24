import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source=await readFile(new URL('../src/audit-time.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;
const {formatAuditTimestamp}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('audit instants retain equivalent offsets and explicit India context across the date boundary',()=>{
 const utc='2026-10-21T23:50:00Z',offset='2026-10-22T05:20:00+05:30';
 const value=formatAuditTimestamp(utc,'Asia/Kolkata');
 assert.equal(value,formatAuditTimestamp(offset,'Asia/Kolkata'));
 assert.match(value,/22 Oct 2026/);assert.match(value,/05:20:00/);
 assert.match(value,/GMT\+05:30/);assert.match(value,/\(Asia\/Kolkata\)$/);
});
test('audit instants preserve UTC and daylight-saving-sensitive named-zone context',()=>{
 const instant='2026-10-21T01:10:00Z';
 assert.match(formatAuditTimestamp(instant,'UTC'),/21 Oct 2026, 01:10:00 GMT(?:\+00:00)? \(UTC\)$/);
 const western=formatAuditTimestamp(instant,'America/Los_Angeles');
 assert.match(western,/20 Oct 2026, 18:10:00 GMT-07:00/);
 assert.match(western,/\(America\/Los_Angeles\)$/);
 assert.match(formatAuditTimestamp('2026-12-21T01:10:00Z','America/Los_Angeles'),/GMT-08:00/);
});
test('missing and malformed audit timestamps have a readable fallback',()=>{
 for(const value of [null,undefined,123,{},[],'','   ','not-a-date','<img src=x>','2026-02-30T12:00:00Z','2026-04-31T12:00:00Z','2100-02-29T12:00:00Z','2026-00-10'])assert.equal(formatAuditTimestamp(value),'Time unavailable');
 assert.match(formatAuditTimestamp('2000-02-29T12:00:00Z','UTC'),/29 Feb 2000/);
});
test('unzoned timestamps and calendar dates never acquire an invented audit timezone',()=>{
 for(const value of ['2026-10-21T23:50:00','2026-10-21 23:50:00','2026-10-21']){
  assert.equal(formatAuditTimestamp(value,'America/Los_Angeles'),value+' (time zone not recorded)');
 }
});
test('unsupported configured display zone falls back to the original instant in explicit UTC',()=>{
 assert.equal(formatAuditTimestamp('2026-10-21T01:10:00+05:30','Unavailable/Zone'),'2026-10-20T19:40:00.000Z (UTC; display time zone unavailable)');
});
test('default display identifies the actual browser/runtime zone instead of claiming India',()=>{
 const zone=new Intl.DateTimeFormat().resolvedOptions().timeZone;
 assert.equal(formatAuditTimestamp('2026-10-21T01:10:00Z'),formatAuditTimestamp('2026-10-21T01:10:00Z',zone));
});
