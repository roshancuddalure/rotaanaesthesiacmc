/** Static discovery only. This register never certifies browser behavior. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(root, 'docs/premium-ui');
const rel = file => path.relative(root, file).replaceAll('\\', '/');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const files = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
const sourceFiles = files(path.join(root, 'frontend/src')).filter(file => /\.(?:ts|html)$/.test(file));
const html = path.join(root, 'frontend/index.html');
if (fs.existsSync(html)) sourceFiles.push(html);
sourceFiles.sort();
const tests = files(path.join(root, 'frontend/tests')).filter(file => /(?:browser|test)\.mjs$/.test(file)).map(file => ({ file: rel(file), text: fs.readFileSync(file, 'utf8') }));
const modules = [], actions = [], listeners = [], requests = [], findings = [];
const lineOf = (text, index) => text.slice(0, index).split('\n').length;
const clean = text => text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
const perspectives = ['visual', 'responsive', 'accessibility', 'reliability', 'interaction', 'independent_qa'];
const pendingReviews = () => Object.fromEntries(perspectives.map(key => [key, { status: 'pending', evidence: [], reviewer: null }]));

for (const file of sourceFiles) {
  const text = fs.readFileSync(file, 'utf8'), name = rel(file);
  const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const functions = [], calls = [], moduleListeners = [], selectors = [], moduleRequests = [];
  const visit = node => {
    if (ts.isCallExpression(node)) calls.push(node);
    if (ts.isFunctionLike(node) && node.body) {
      const parent = node.parent;
      functions.push({ start: node.getStart(tree), end: node.end, name: node.name?.getText(tree) || (ts.isVariableDeclaration(parent) ? parent.name.getText(tree) : ts.isPropertyAssignment(parent) ? parent.name.getText(tree) : '(callback)') });
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      if (['querySelector', 'querySelectorAll', 'closest', 'matches', 'getElementById'].includes(method) && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) selectors.push({ selector: method === 'getElementById' ? `#${node.arguments[0].text}` : node.arguments[0].text, line: lineOf(text, node.getStart(tree)) });
      if (method === 'addEventListener') {
        const callback = node.arguments[1];
        const item = { source: name, line: lineOf(text, node.getStart(tree)), event: node.arguments[0]?.getText(tree) || '', binding: node.expression.expression.getText(tree).slice(0, 240), kind: 'event_listener', evidence_status: 'source_only' };
        moduleListeners.push(item);
        if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) && ts.isBlock(callback.body) && callback.body.statements.length === 0) findings.push({ kind: 'empty_listener_candidate', ...item, runtime_status: 'not_exercised', explanation: 'Empty source callback; determine whether intentional before classifying as a no-op.' });
      }
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(node.left) && /^on(?:click|change|input|submit|keydown|cancel|close)$/.test(node.left.name.text)) moduleListeners.push({ source: name, line: lineOf(text, node.getStart(tree)), event: node.left.name.text.slice(2), binding: node.left.expression.getText(tree).slice(0, 240), kind: 'event_property', evidence_status: 'source_only' });
    ts.forEachChild(node, visit);
  };
  visit(tree);
  // Endpoints are source candidates, not a fabricated one-to-one action mapping.
  for (const match of text.matchAll(/(?:["'`])(\/api\/v1\/[^"'`\n]*)/g)) {
    const call = calls.filter(node => node.getStart(tree) <= match.index && node.end >= match.index).sort((a, b) => (a.end - a.pos) - (b.end - b.pos))[0];
    const method = call?.arguments[1]?.getText(tree).match(/\bmethod\s*:\s*['"]([A-Z]+)['"]/)?.[1];
    const directRead = call && /^(request|fetch)$/.test(call.expression.getText(tree)) && call.arguments.length === 1;
    moduleRequests.push({ source: name, line: lineOf(text, match.index), endpoint_expression: match[1], caller_expression: call?.expression.getText(tree) || null, method_candidate: method || (directRead ? 'GET' : 'requires_wrapper_or_options_review'), request_semantics: method && method !== 'GET' ? 'mutation_or_review_request_verify_payload_and_readback' : directRead ? 'read_request_verify_current_context_and_stale_response_handling' : 'resolve_from_request_wrapper_and_options', evidence_status: 'source_only' });
  }
  const roleGates = [...text.matchAll(/(?:isAdmin\(|currentUser\?\.role|role\s*[!=]==?\s*["'][^"']+["']|requireAdmin|canEdit|canManage)/g)].map(match => ({ line: lineOf(text, match.index), expression: clean(text.slice(Math.max(0, match.index - 55), match.index + 110)) }));
  const seen = new Map();
  for (const match of text.matchAll(/<(button|a|input|select|textarea|summary|form|div|span|article|section|li)\b([^>]*?)>/g)) {
    const [markup, tag, attrsText] = match;
    const attrs = {};
    for (const attr of attrsText.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) attrs[attr[1]] = attr[2] ?? attr[3] ?? attr[4] ?? true;
    if (['div', 'span', 'article', 'section', 'li'].includes(tag) && !['button', 'tab', 'menuitem', 'option', 'switch', 'checkbox', 'radio'].includes(attrs.role) && !Object.hasOwn(attrs, 'tabindex')) continue;
    if (tag === 'input' && attrs.type === 'hidden') continue;
    const context = functions.filter(fn => fn.start <= match.index && fn.end >= match.index).sort((a, b) => (a.end - a.start) - (b.end - b.start))[0]?.name ?? '(module)';
    const identities = Object.entries(attrs).filter(([key]) => key === 'id' || key.startsWith('data-') || key === 'name' || key === 'href').map(([key, value]) => `${key}=${value}`);
    const identity = identities.join('|') || `${tag}:${attrs.type || ''}:${clean(text.slice(match.index + markup.length, match.index + markup.length + 100))}`;
    const stem = `${name.replace('frontend/src/', '').replace(/\W+/g, '-')}::${context.replace(/\W+/g, '-')}::${hash(identity).slice(0, 12)}`;
    const instance = (seen.get(stem) || 0) + 1; seen.set(stem, instance);
    const selectorCandidates = Object.keys(attrs).filter(key => key.startsWith('data-')).map(key => `[${key}]`);
    if (typeof attrs.id === 'string' && !attrs.id.includes('${')) selectorCandidates.unshift(`#${attrs.id}`);
    const handlerCandidates = selectors.filter(item => selectorCandidates.some(candidate => item.selector.includes(candidate) || (candidate.startsWith('[') && item.selector.includes(candidate.slice(0, -1) + '='))));
    const testCandidates = tests.filter(test => selectorCandidates.some(selector => test.text.includes(selector) || test.text.includes(selector.slice(1, -1)))).map(test => test.file);
    const label = typeof attrs['aria-label'] === 'string' ? attrs['aria-label'] : ['button', 'a', 'summary'].includes(tag) ? clean(text.slice(match.index + markup.length).split(`</${tag}>`)[0]) : String(attrs.name || attrs.id || attrs.type || tag);
    const semantic = tag === 'a' ? 'navigation_or_download' : tag === 'summary' ? 'native_disclosure' : tag === 'form' ? 'form_submission' : ['input', 'select', 'textarea'].includes(tag) ? 'field_value_or_selection_change' : /cancel|close|discard/i.test(label) ? 'dismissal_or_draft_decision' : /download|export/i.test(label) ? 'download_artifact' : /save|apply|approve|publish|delete|restore|remove/i.test(label) ? 'reviewed_mutation_candidate' : 'action_requires_contract_review';
    actions.push({ action_id: `${stem}${instance > 1 ? `::${instance}` : ''}`, source: name, line: lineOf(text, match.index), context, element: tag, label_expression: label, attributes: attrs, selector_candidates: selectorCandidates,
      role: { status: 'requires_manual_contract', module_gate_reference: name, module_gate_candidate_count: roleGates.length }, selected_context: { month: /month/i.test(text) ? 'module_has_month_context_verify_action_scope' : 'not_established', record_or_unit: /person|member|unit|record/i.test(text) ? 'verify_selected_record_and_unit' : 'not_established' },
      expected_outcome: { category: semantic, verified_contract: null, acceptance: 'Observe the intended visible result; verify changed state, read-back or artifact content as applicable. A click or HTTP 200 alone is insufficient.' },
      handler_selector_candidates: handlerCandidates, request_candidate_reference: { source: name, count: moduleRequests.length, mapping_status: 'module_candidates_only' }, existing_test_candidates: testCandidates,
      states_to_verify: ['loading', 'empty', 'populated', 'validation_error', 'permission_denied', 'offline', 'timeout', 'stale', 'recovery'],
      mutation_safety: { duplicate_protection: 'pending', cancellation: 'pending', uncertain_outcome_reconciliation: 'pending' },
      source_status: 'discovered', runtime_status: 'not_exercised', review: pendingReviews() });
  }
  const creationCandidates = [...text.matchAll(/createElement\(\s*['"](button|a|input|select|textarea|summary|form)['"]\s*\)/g)].map(match => ({ element: match[1], line: lineOf(text, match.index), status: 'requires_runtime_expansion' }));
  modules.push({ source: name, sha256: hash(text), controls: actions.filter(action => action.source === name).length, listeners: moduleListeners.length, dynamic_creation_candidates: creationCandidates, role_gate_candidates: roleGates, selector_references: selectors });
  listeners.push(...moduleListeners); requests.push(...moduleRequests);
}

const groups = new Map();
for (const item of listeners) { const key = `${item.source}|${item.event}|${item.binding}`; groups.set(key, [...(groups.get(key) || []), item]); }
for (const group of groups.values()) if (group.length > 1) findings.push({ kind: 'repeated_binding_candidate', source: group[0].source, binding: group[0].binding, event: group[0].event, lines: group.map(item => item.line), runtime_status: 'not_exercised', explanation: 'Repeated source expressions may refer to different lifecycles or instances. Prove duplicate activation before calling this a defect.' });
const planPath = path.join(root, 'docs/premium_frontend_upgrade_plan_2026-10-21.md');
const planText = fs.readFileSync(planPath, 'utf8');
const items = [...planText.matchAll(/^(\d+)\. (.+)$/gm)].map(match => ({ item_id: Number(match[1]), requirement: match[2].trim() }));
assert.equal(items.length, 260, 'The approved plan must contain exactly 260 numbered items.');
assert.deepEqual(items.map(item => item.item_id), Array.from({ length: 260 }, (_, i) => i + 1));
assert.equal(new Set(actions.map(action => action.action_id)).size, actions.length, 'Action identifiers must be unique.');
const previousPath = path.join(output, 'traceability.json');
const previous = fs.existsSync(previousPath) ? JSON.parse(fs.readFileSync(previousPath, 'utf8')) : null;
const previousInventoryPath = path.join(output, 'action-inventory.json');
const previousInventory = fs.existsSync(previousInventoryPath) ? JSON.parse(fs.readFileSync(previousInventoryPath, 'utf8')) : null;
for (const action of actions) {
  const old = previousInventory?.actions?.find(candidate => candidate.action_id === action.action_id);
  if (!old) continue;
  if (old.expected_outcome?.verified_contract) action.expected_outcome.verified_contract = old.expected_outcome.verified_contract;
  const previousHash = previousInventory.modules.find(module => module.source === action.source)?.sha256;
  const currentHash = modules.find(module => module.source === action.source)?.sha256;
  if (previousHash === currentHash) {
    action.review = old.review || action.review;
    action.runtime_status = old.runtime_status;
    if (old.runtime_evidence) action.runtime_evidence = old.runtime_evidence;
  } else if (old.runtime_evidence?.length || old.runtime_status !== 'not_exercised') {
    action.previous_runtime_evidence = old.runtime_evidence || [];
    action.runtime_status = 'requires_revalidation_after_source_change';
  }
}
const ledger = { schema_version: 1, plan: rel(planPath), plan_sha256: hash(planText), evidence_policy: 'Source discovery never implies runtime verification. Every item requires six independently recorded perspective fields; unresolved dependencies remain explicit.', items: items.map(item => {
  const old = previous?.items?.find(candidate => candidate.item_id === item.item_id && candidate.requirement === item.requirement);
  return old || { ...item, implementation_status: 'pending', files: [], action_ids: [], screenshots: [], tests: [], limitations: [], reviews: pendingReviews() };
}) };
const inventory = { schema_version: 1, method: 'TypeScript AST listener/selector discovery plus HTML-source candidate extraction. Dynamic interpolations, runtime permissions, shared delegation and control generation require browser expansion and manual contract review.', coverage_claim: 'Source inventory only; no runtime action is certified by this artifact.', baseline_snapshot: 'tmp/premium-ui-baseline-20261021T130359Z', summary: { modules: modules.length, source_control_candidates: actions.length, listener_candidates: listeners.length, endpoint_expression_candidates: requests.length, dynamic_creation_candidates: modules.reduce((n, module) => n + module.dynamic_creation_candidates.length, 0), source_findings: findings.length, runtime_passed: 0 }, modules, actions, listeners, requests, findings };
const markdown = `# Frontend action source inventory\n\nThis is source discovery, not browser certification. Baseline: \`${inventory.baseline_snapshot}\`.\n\n${actions.length} control candidates across ${modules.length} files; ${listeners.length} event bindings; ${requests.length} endpoint expressions; ${inventory.summary.dynamic_creation_candidates} dynamic creation candidates. **Zero actions are marked runtime-passed.**\n\nRun \`node frontend/tests/premium-action-inventory.mjs --write\` to refresh after source changes; run with \`--check\` to detect stale digests and malformed traceability.\n\n## Contract and review requirements\n\nEach JSON action records source context, selector candidates, role-gate evidence, month/record context requiring review, outcome category, possible handler references, module endpoint candidates and existing-test candidates. Endpoint and test candidates are not proven action mappings. Populate the exact contract and outcome assertion during workflow review. Static IDs represent template occurrences; expand runtime-generated rows, navigation entries and role variants in browser fixtures. Native fields/disclosures remain in scope even when no JavaScript listener is needed.\n\nEvery action and each of the 260 plan items starts with pending visual, responsive, accessibility, reliability, interaction and independent-QA reviews. A completed save requires read-back; a filter needs changed results; a download requires artifact content; cancellation requires absence of unintended mutation. Source findings are investigation candidates, not confirmed no-ops or duplicate handlers. Preserve concurrent source changes and refresh the inventory only from the integrated snapshot.\n\n## Module coverage\n\n| Source | Controls | Event bindings | Dynamic creators |\n|---|---:|---:|---:|\n${modules.map(module => `| ${module.source} | ${module.controls} | ${module.listeners} | ${module.dynamic_creation_candidates.length} |`).join('\n')}\n\n## Actions\n\n| Stable source action ID | Location | Element | Label expression | Outcome category | Test candidates | Runtime |\n|---|---|---|---|---|---:|---|\n${actions.map(action => `| ${action.action_id.replaceAll('|', '\\|')} | ${action.source}:${action.line} | ${action.element} | ${action.label_expression.replaceAll('|', '\\|').replaceAll('\n', ' ')} | ${action.expected_outcome.category} | ${action.existing_test_candidates.length} | Not exercised |`).join('\n')}\n\n## Investigation candidates\n\n${findings.length ? findings.map(finding => `- ${finding.kind}: ${finding.source}:${finding.line || finding.lines.join(',')} — ${finding.explanation}`).join('\n') : 'No empty listener or repeated binding candidates detected by this limited scan.'}\n\n## Limitations\n\nAST and markup discovery cannot prove live control visibility, final labels, permissions, exact endpoint ownership, request count, DOM geometry or persisted outcomes. Template interpolation can create many runtime controls from one source occurrence. Shared event delegation can bind controls in other modules. Candidate test matches are lexical and may include unrelated uses of a common selector. Manual ownership mapping and production-serving browser outcome checks remain required.\n`;
if (process.argv.includes('--write')) {
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'action-inventory.json'), JSON.stringify(inventory, null, 2) + '\n');
  fs.writeFileSync(path.join(output, 'action-inventory.md'), markdown);
  fs.writeFileSync(previousPath, JSON.stringify(ledger, null, 2) + '\n');
} else if (process.argv.includes('--check')) {
  const saved = JSON.parse(fs.readFileSync(path.join(output, 'action-inventory.json'), 'utf8'));
  assert.deepEqual(saved.modules.map(module => [module.source, module.sha256]), modules.map(module => [module.source, module.sha256]), 'Source inventory is stale; refresh from the integrated snapshot.');
  assert.equal(saved.actions.length, actions.length);
  assert.equal(ledger.items.length, 260);
  for (const item of ledger.items) for (const perspective of perspectives) assert.ok(item.reviews[perspective], `Item ${item.item_id} lacks ${perspective}`);
  assert.ok(saved.actions.every(action => ['not_exercised', 'requires_revalidation_after_source_change'].includes(action.runtime_status) || action.runtime_evidence?.length), 'Runtime claims require evidence.');
}
console.log(JSON.stringify({ ...inventory.summary, plan_items: items.length, review_fields_per_item: perspectives.length, check: process.argv.includes('--check') ? 'passed_source_integrity_only' : 'not_a_runtime_test' }, null, 2));
