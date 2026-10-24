import { esc } from './ui';

type MemberItem = { name: string; html: string };
const limits = new Map<string, number>();
let lists = new Map<string, MemberItem[]>();
let currentQuery = '';

export function resetUnitMemberLists(clearLimits = false) {
  lists = new Map();
  if (clearLimits) { limits.clear(); currentQuery = ''; }
}

export function unitMemberList(key: string, items: MemberItem[]): string {
  lists.set(key, items);
  return `<div data-unit-member-list="${esc(key)}">${listBody(key, items)}</div>`;
}

function listBody(key: string, items: MemberItem[], printing = false): string {
  const matching = currentQuery ? items.filter(item => item.name.toLocaleLowerCase().includes(currentQuery)) : [];
  const shown = matching.length ? matching : items;
  const limit = printing ? shown.length : limits.get(key) ?? 12;
  const visible = shown.slice(0, limit);
  const remaining = shown.length - visible.length;
  const action = (mode: string, text: string) => `<button type="button" aria-describedby="unit-member-count-${esc(key)}" data-unit-member-action="${mode}" data-unit-member-key="${esc(key)}">${text}</button>`;
  return `<p class="unit-member-list__count" id="unit-member-count-${esc(key)}">${visible.length} of ${shown.length} ${matching.length ? `matching postings · ${items.length} total` : 'postings shown'}</p><div class="unit-chip-row">${visible.map(item => item.html).join('')}</div>
    ${remaining > 0 || limit > 12 && shown.length > 12 ? `<div class="unit-member-list__actions">${remaining > 0 ? action('more', `Show next ${Math.min(24, remaining)}`) + action('all', `Show all ${shown.length} postings`) : ''}${limit > 12 ? action('less', 'Show fewer') : ''}</div>` : ''}`;
}

/** Materialize complete matching member lists for print, preserving live nodes. */
export function prepareUnitMemberPrint(root: HTMLElement) {
  const saved: {host: HTMLElement; nodes: Node[]}[] = [];
  root.querySelectorAll<HTMLElement>('[data-unit-member-list]').forEach(host => {
    const items = lists.get(host.dataset.unitMemberList!);
    if (!items || host.closest<HTMLElement>('[data-unit-board-card]')?.hidden) return;
    saved.push({host, nodes: [...host.childNodes]});
    host.innerHTML = listBody(host.dataset.unitMemberList!, items, true);
  });
  return () => saved.forEach(({host, nodes}) => { if (host.isConnected) host.replaceChildren(...nodes); });
}

export function filterUnitMemberLists(root: HTMLElement, query: string) {
  currentQuery = query.trim().toLocaleLowerCase();
  root.querySelectorAll<HTMLElement>('[data-unit-member-list]').forEach(host => {
    const items = lists.get(host.dataset.unitMemberList!);
    if (items) host.innerHTML = listBody(host.dataset.unitMemberList!, items);
  });
}

export function activateUnitMemberList(button: HTMLButtonElement): void {
  const key = button.dataset.unitMemberKey!;
  const items = lists.get(key);
  const host = button.closest<HTMLElement>('[data-unit-member-list]');
  if (!items || !host) return;
  const mode = button.dataset.unitMemberAction;
  limits.set(key, mode === 'all' ? items.length : mode === 'less' ? 12 : (limits.get(key) ?? 12) + 24);
  host.innerHTML = listBody(key, items);
  const next = host.querySelector<HTMLButtonElement>(`[data-unit-member-action="${mode}"]`)
    ?? host.querySelector<HTMLButtonElement>('[data-unit-member-action="less"]')
    ?? host.querySelector<HTMLButtonElement>('[data-unit-member-action]');
  next?.focus();
}
