import { esc } from './ui';

type MemberItem = { name: string; html: string };
const limits = new Map<string, number>();
const pages = new Map<string, number>();
let lists = new Map<string, MemberItem[]>();
let currentQuery = '';

export function resetUnitMemberLists(clearLimits = false) {
  lists = new Map();
  if (clearLimits) { limits.clear(); pages.clear(); currentQuery = ''; }
}

export function unitMemberList(key: string, items: MemberItem[]): string {
  lists.set(key, items);
  return `<div data-unit-member-list="${esc(key)}">${listBody(key, items)}</div>`;
}

function listBody(key: string, items: MemberItem[], printing = false): string {
  const matching = currentQuery ? items.filter(item => item.name.toLocaleLowerCase().includes(currentQuery)) : [];
  const shown = matching.length ? matching : items;
  const limit = printing ? Math.max(1, shown.length) : limits.get(key) ?? 10;
  const page = printing ? 0 : Math.max(0, Math.min(pages.get(key) ?? 0, Math.ceil(shown.length / limit) - 1));
  pages.set(key, page);
  const visible = shown.slice(page * limit, (page + 1) * limit);
  const action = (mode: string, text: string, disabled: boolean) => `<button type="button" ${disabled ? 'disabled' : ''} aria-describedby="unit-member-count-${esc(key)}" data-unit-member-action="${mode}" data-unit-member-key="${esc(key)}">${text}</button>`;
  return `<p class="unit-member-list__count" id="unit-member-count-${esc(key)}">${shown.length ? page * limit + 1 : 0}&ndash;${Math.min((page + 1) * limit, shown.length)} of ${shown.length} postings</p><div class="unit-chip-row">${visible.map(item => item.html).join('')}</div>
    ${printing ? '' : `<div class="paginator"><label>Rows per page <select data-unit-member-size="${esc(key)}" aria-label="Rows per page">${[10,20,30].map(size => `<option ${size === limit ? 'selected' : ''}>${size}</option>`).join('')}</select></label>${action('previous','Previous',page === 0)}<span>Page ${page + 1} of ${Math.max(1,Math.ceil(shown.length / limit))}</span>${action('next','Next',(page + 1) * limit >= shown.length)}</div>`}`;

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
  pages.clear();
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
  pages.set(key, Math.max(0, (pages.get(key) ?? 0) + (mode === 'previous' ? -1 : 1)));
  host.innerHTML = listBody(key, items);
  const next = host.querySelector<HTMLButtonElement>(`[data-unit-member-action="${mode}"]`)
    ?? host.querySelector<HTMLButtonElement>('[data-unit-member-action="less"]')
    ?? host.querySelector<HTMLButtonElement>('[data-unit-member-action]');
  next?.focus();
}

if (typeof document !== 'undefined') document.addEventListener('change', event => {
  const select = event.target as HTMLSelectElement;
  const key = select.dataset?.unitMemberSize;
  if (!key || ![10,20,30].includes(Number(select.value))) return;
  limits.set(key, Number(select.value));
  pages.set(key, 0);
  const host = select.closest<HTMLElement>('[data-unit-member-list]');
  const items = lists.get(key);
  if (host && items) {
    host.innerHTML = listBody(key, items);
    host.querySelector<HTMLSelectElement>('[data-unit-member-size]')?.focus();
  }
});
