import { prepareUnitMemberPrint } from './unit-member-lists';

/** Filter the displayed unit groups, preserving authoritative month totals and assignments. */
export function bindUnitBoardFilters(root: HTMLElement, changed: (search: string, campus: string) => void,
  postings?: { groups: string[]; render: (indexes: number[]) => string; page?: number; pageChanged?: (page: number) => void }) {
  const search = root.querySelector<HTMLInputElement>('[data-unit-board-search]');
  const campus = root.querySelector<HTMLSelectElement>('[data-unit-board-campus]');
  const count = root.querySelector<HTMLElement>('[data-unit-board-count]');
  if (!search || !campus || !count) return;
  const cards = [...root.querySelectorAll<HTMLElement>('[data-unit-board-card]')];
  const rows = [...root.querySelectorAll<HTMLElement>('[data-unit-board-row]')];
  let page = postings?.page ?? 0;
  const pageSize = 50;
  let previousFilter = JSON.stringify([search.value.trim().toLocaleLowerCase(), campus.value]);
  const body = root.querySelector<HTMLElement>('[data-unit-posting-body]');
  const pager = root.querySelector<HTMLElement>('[data-unit-posting-pager]');
  let matchingIndexes: number[] = [];
  const apply = () => {
    const query = search.value.trim().toLocaleLowerCase();
    const visibleKeys = new Set<string>();
    cards.forEach(card => {
      const matches = (!query || (card.dataset.unitBoardSearch || '').includes(query))
        && (!campus.value || card.dataset.unitBoardCampus === campus.value);
      card.hidden = !matches;
      if (matches) visibleKeys.add(card.dataset.unitBoardCard!);
    });
    let shownRows = 0;
    if (postings && body && pager) {
      const filter = JSON.stringify([query, campus.value]);
      if (filter !== previousFilter) page = 0;
      previousFilter = filter;
      const matches = postings.groups.map((group, index) => ({group, index})).filter(item => !query && !campus.value || visibleKeys.has(item.group));
      shownRows = matches.length;
      matchingIndexes = matches.map(item => item.index);
      const pages = Math.max(1, Math.ceil(matches.length / pageSize));
      page = Math.min(page, pages - 1);
      postings.pageChanged?.(page);
      body.innerHTML = postings.render(matches.slice(page * pageSize, (page + 1) * pageSize).map(item => item.index));
      pager.replaceChildren();
      if (matches.length > pageSize) {
        const status = document.createElement('span');
        status.setAttribute('role', 'status');
        status.textContent = `Postings ${page * pageSize + 1}–${Math.min((page + 1) * pageSize, matches.length)} of ${matches.length} · Page ${page + 1} of ${pages}`;
        pager.append(status);
        for (const [label, delta] of [['Previous postings', -1], ['Next postings', 1]] as const) {
          const button = document.createElement('button');
          button.type = 'button'; button.textContent = label; button.dataset.postingsPage = String(delta);
          button.disabled = delta < 0 ? page === 0 : page === pages - 1;
          button.onclick = event => {
            event.stopPropagation();
            page += delta; apply();
            const next = pager.querySelector<HTMLButtonElement>(`[data-postings-page="${delta}"]`);
            (next && !next.disabled ? next : pager.querySelector<HTMLButtonElement>('button:not(:disabled)'))?.focus({preventScroll:true});
          };
          pager.append(button);
        }
      }
    } else rows.forEach(row => { row.hidden = Boolean(query || campus.value) && !visibleKeys.has(row.dataset.unitBoardRow!); if (!row.hidden) shownRows++; });
    count.textContent = `${visibleKeys.size} of ${cards.length} unit groups · ${shownRows} of ${postings?.groups.length ?? rows.length} postings shown`;
    const empty = root.querySelector<HTMLElement>('[data-unit-board-empty]');
    if (empty) empty.hidden = visibleKeys.size > 0 || cards.length === 0;
    const reset = root.querySelector<HTMLButtonElement>('[data-unit-board-reset]');
    if (reset) reset.disabled = !search.value && !campus.value;
    changed(search.value, campus.value);
  };
  search.oninput = apply;
  campus.onchange = apply;
  root.querySelectorAll<HTMLButtonElement>('[data-unit-board-reset]').forEach(button => {
    button.onclick = () => { search.value = ''; campus.value = ''; apply(); search.focus({preventScroll:true}); };
  });
  apply();
  let restorePrint: (() => void) | undefined;
  let printFocus: HTMLElement | null = null;
  let lastBoardFocus: HTMLElement | null = root.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
  const trackFocus = (event: FocusEvent) => {
    lastBoardFocus = root.contains(event.target as Node) ? event.target as HTMLElement : null;
  };
  document.addEventListener('focusin', trackFocus);
  const finishPrint = () => {
    restorePrint?.(); restorePrint = undefined;
    // Some browsers emit afterprint while print media still hides action controls.
    if (!media.matches && printFocus) {
      if (printFocus.isConnected && document.activeElement === document.body) printFocus.focus({preventScroll:true});
      printFocus = null;
    }
  };
  const startPrint = () => {
    if (restorePrint || !root.contains(search) || !search.isConnected) return;
    printFocus = document.activeElement === document.body ? lastBoardFocus : document.activeElement as HTMLElement | null;
    const nodes = body ? [...body.childNodes] : [];
    const restoreMembers = prepareUnitMemberPrint(root);
    if (body && postings) body.innerHTML = postings.render(matchingIndexes);
    restorePrint = () => {
      if (body?.isConnected && root.contains(search)) body.replaceChildren(...nodes);
      restoreMembers();
    };
  };
  const media = window.matchMedia('print');
  const mediaChanged = () => { if (media.matches) startPrint(); else finishPrint(); };
  window.addEventListener('beforeprint', startPrint);
  window.addEventListener('afterprint', finishPrint);
  media.addEventListener('change', mediaChanged);
  const cleanup = new MutationObserver(() => {
    if (search.isConnected && root.contains(search)) return;
    finishPrint();
    window.removeEventListener('beforeprint', startPrint);
    window.removeEventListener('afterprint', finishPrint);
    media.removeEventListener('change', mediaChanged);
    document.removeEventListener('focusin', trackFocus);
    cleanup.disconnect();
  });
  cleanup.observe(document.body, {childList:true, subtree:true});
  if (media.matches) startPrint();
}
