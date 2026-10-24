import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source=await readFile(new URL('../src/diagnostics-summary.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext}}).outputText;
const {shareableDiagnostics}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('diagnostics retains every aggregate count and known category without coercion',()=>{
  const input={generated_at:'2026-10-24T12:30:45.123456',database_counts:{people:234,units:0,new_table:1234567890},mapping_status:{confirmed:5,private_name:7},import_warnings:{error:1},rota_period_status:{draft:2},invalid_member_names:3,auth_accounts_by_role:{computer_admin:2},invalid_name_rules:['EMPTY']};
  const result=shareableDiagnostics(input);
  assert.equal(result.generated_at,input.generated_at);
  assert.deepEqual({...result.database_counts},{people:234,units:0,additional_table_1:1234567890});
  assert.deepEqual({...result.mapping_status},{confirmed:5,additional_category_1:7});
  assert.deepEqual({...result.import_warnings},{error:1});
  assert.deepEqual({...result.rota_period_status},{draft:2});
  assert.deepEqual({...result.auth_accounts_by_role},{computer_admin:2});
  assert.equal(result.invalid_member_names,3);assert.equal(result.invalid_name_rule_count,1);
  assert.equal(result.privacy.category_labels_withheld,2);
});

test('unknown fields, nested identities, credentials, pairing data and rule text never enter shared output',()=>{
  const secrets=['fixture-token','fixture-pairing-secret','Dr Private Example','private@example.invalid'];
  const input={generated_at:secrets[0],database_counts:{[secrets[2]]:4},mapping_status:{[secrets[3]]:2},auth_accounts_by_role:{[secrets[0]]:1},invalid_name_rules:secrets,access_token:secrets[0],pairing_secret:secrets[1],future_payload:{members:[{name:secrets[2],email:secrets[3]}],authorization:secrets[0]}};
  const before=JSON.stringify(input),result=shareableDiagnostics(input),shared=JSON.stringify(result);
  for(const secret of secrets)assert.equal(shared.includes(secret),false);
  assert.equal(result.generated_at,null);assert.equal(result.invalid_name_rule_count,4);
  assert.equal(result.database_counts.additional_table_1,4);
  assert.equal(JSON.stringify(input),before,'Presentation must not mutate the response');
});

test('missing, malformed and nonfinite values remain unreported rather than becoming zero',()=>{
  for(const input of [null,undefined,[],42,'private']){
    const result=shareableDiagnostics(input);assert.equal(result.generated_at,null);
    assert.equal(result.invalid_member_names,null);assert.deepEqual({...result.database_counts},{});
  }
  const result=shareableDiagnostics({database_counts:{people:'42',units:Infinity,duty_slots:NaN,postings:0},invalid_member_names:false,invalid_name_rules:'private'});
  assert.deepEqual({...result.database_counts},{people:null,units:null,duty_slots:null,postings:0});
  assert.equal(result.invalid_member_names,null);assert.equal(result.invalid_name_rule_count,null);
});

test('untrusted property names cannot collide with known categories or pollute shared objects',()=>{
  const input=JSON.parse('{"database_counts":{"__proto__":1,"constructor":2,"additional_table_1":3,"people":4}}');
  const result=shareableDiagnostics(input);
  assert.equal(Object.getPrototypeOf(result.database_counts),null);
  assert.deepEqual({...result.database_counts},{additional_table_1:1,additional_table_2:2,additional_table_3:3,people:4});
  assert.equal({}.polluted,undefined);
});

test('only timestamp-shaped text can appear as the reported generation time',()=>{
  for(const value of ['2026-10-24T12:30:45Z','2026-10-24T12:30:45+05:30','2026-10-24T12:30:45.123456','2028-02-29T12:00:00Z'])assert.equal(shareableDiagnostics({generated_at:value}).generated_at,value);
  for(const value of ['token 2026-10-24','<img src=x>','2026-99-99T99:99:99Z','2026-10-24T12:30:45Z secret','2026-02-30T12:00:00Z','2026-02-29T12:00:00Z','2026-10-24T24:00:00Z','2026-10-24T12:30:45+24:00',42])assert.equal(shareableDiagnostics({generated_at:value}).generated_at,null);
});

test('every aggregate field rejects nested data and malformed containers without serializing it',()=>{
  const groups=['database_counts','mapping_status','import_warnings','rota_period_status','auth_accounts_by_role'];
  const privateValue='private-fixture-value';
  for(const group of groups){
    for(const value of [privateValue,[privateValue],{name:privateValue},null,true]){
      const result=shareableDiagnostics({[group]:{people:value},invalid_member_names:value});
      assert.deepEqual(Object.values(result[group]),[null]);assert.equal(result.invalid_member_names,null);
      assert.equal(JSON.stringify(result).includes(privateValue),false);
    }
    for(const malformed of [privateValue,[{name:privateValue}],null,42]){
      const result=shareableDiagnostics({[group]:malformed});assert.deepEqual({...result[group]},{});
      assert.equal(JSON.stringify(result).includes(privateValue),false);
    }
  }
});
