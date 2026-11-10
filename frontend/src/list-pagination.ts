/** Pagination for complete, locally filtered record collections. Keeps form state in the DOM. */
export function installListPagination(root: HTMLElement = document.body): () => void {
  const selector = 'table, .card-list, .member-card-list, .candidate-list, .assigned-list, .unit-editor-list, .registry-unit-list, .rb-list, .rr-cat__body, .rr-history, .mw-call-timeline, .mw-timeline, .mw-roster-list, .leave-day-person-list, .rota-slot-card-list, .rota-day-compact-list, .rota-short-list, .rota-distribution-list, [data-paginate-list]';
  type State = { page: number; size: number; bar: HTMLElement; rows: HTMLElement[] };
  const states = new WeakMap<HTMLElement, State>();
  const managed = new Set<HTMLElement>();
  function refresh(host: HTMLElement, reset = false) {
    // Analysis tables have data-level pagination, shared with their mobile cards.
    if (host.querySelector('[data-table-paginator]') || host.closest('.panel, .mobile-section')?.querySelector('[data-table-paginator]')) return;
    const body = host instanceof HTMLTableElement ? host.tBodies[0] : host;
    if (!body) return;
    const rows = Array.from(body.children).filter((row): row is HTMLElement => row instanceof HTMLElement && (!host.matches('.mw-roster-list') || row.matches('article')) && !row.hidden && row.style.display !== 'none' && !row.matches('.paginator, .empty, .ds-empty, h1, h2, h3, h4, h5, h6') && !row.querySelector('td.empty, td .ds-empty'));
    let state = states.get(host);
    if (!state && rows.length < 2) return;
    if (!state) {
      const bar = document.createElement('nav');
      bar.className = 'paginator list-paginator';
      bar.setAttribute('aria-label', `${host.getAttribute('aria-label') || host.querySelector('caption')?.textContent || 'List'} pages`);
      bar.innerHTML = '<label>Rows per page <select aria-label="Rows per page"><option>10</option><option>20</option><option>30</option></select></label><div class="paginator-controls"><button type="button" data-list-prev>Previous</button><span aria-live="polite"></span><button type="button" data-list-next>Next</button></div>';
      state = { page: 0, size: 10, bar, rows: [] };
      states.set(host, state);
      managed.add(host);
      const current = state;
      bar.addEventListener('click', event => {
        const button = (event.target as Element).closest('button');
        if (!button || button.disabled) return;
        current.page += button.hasAttribute('data-list-prev') ? -1 : 1;
        refresh(host);
      });
      bar.querySelector('select')!.addEventListener('change', event => {
        const size = Number((event.target as HTMLSelectElement).value);
        if (![10, 20, 30].includes(size)) return;
        current.size = size;
        current.page = 0;
        refresh(host);
      });
    }
    if (reset || rows.length !== state.rows.length || rows.some((row, index) => row !== state!.rows[index])) state.page = 0;
    state.rows = rows;
    state.page = Math.max(0, Math.min(state.page, Math.ceil(rows.length / state.size) - 1));
    rows.forEach((row, index) => {
      row.toggleAttribute('data-pagination-hidden', index < state!.page * state!.size || index >= (state!.page + 1) * state!.size);
    });
    const text = `${rows.length ? state.page * state.size + 1 : 0}–${Math.min((state.page + 1) * state.size, rows.length)} of ${rows.length} · Page ${state.page + 1} of ${Math.max(1, Math.ceil(rows.length / state.size))}`;
    const info = state.bar.querySelector('span')!;
    if (info.textContent !== text) info.textContent = text;
    state.bar.querySelector<HTMLButtonElement>('[data-list-prev]')!.disabled = state.page === 0;
    state.bar.querySelector<HTMLButtonElement>('[data-list-next]')!.disabled = (state.page + 1) * state.size >= rows.length;
    state.bar.hidden = host.hidden || host.style.display === 'none';
    if (!state.bar.isConnected) host.after(state.bar);
  }
  function scan() {
    managed.forEach(host => { if (!host.isConnected) { states.get(host)?.bar.remove(); managed.delete(host); } });
    root.querySelectorAll<HTMLElement>(selector).forEach(host => refresh(host));
  }
  const observer = new MutationObserver(records => {
    if (records.some(record => !(record.target as Element).closest?.('.list-paginator'))) scan();
  });
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'style'] });
  scan();
  return () => {
    observer.disconnect();
    managed.forEach(host => {
      const state = states.get(host)!;
      state.rows.forEach(row => row.removeAttribute('data-pagination-hidden'));
      state.bar.remove();
    });
  };
}
