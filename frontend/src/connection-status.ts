import { healthCheck } from './services/api';

/** Last known read result. Network hints never assert that a server is reachable. */
export function bindConnectionStatus(root: HTMLDetailsElement) {
  const events = new AbortController();
  const summary = root.querySelector<HTMLElement>('summary')!;
  const dot = root.querySelector<HTMLElement>('#api-status')!;
  const message = root.querySelector<HTMLElement>('[data-connection-message]')!;
  const detail = root.querySelector<HTMLElement>('[data-connection-detail]')!;
  const button = root.querySelector<HTMLButtonElement>('[data-check-connection]')!;
  const panel = root.querySelector<HTMLElement>('.connection-checker-panel')!;
  let disposed = false;
  let networkGeneration = 0;
  let uncertain = true;
  let last: { ok: boolean; at: number; error?: string } | undefined;
  let pending: Promise<{ ok: true } | { ok: false; error: Error }> | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  let focusRevision = 0;
  const alive = () => !disposed && root.isConnected;
  const ageLimit = 5 * 60_000;
  const placePanel = () => {
    if (!alive() || !root.open) return;
    const anchor = summary.getBoundingClientRect();
    panel.style.left = `${Math.max(16, Math.min(anchor.right - panel.offsetWidth, innerWidth - panel.offsetWidth - 16))}px`;
    panel.style.top = `${Math.max(16, Math.min(anchor.bottom + 8, innerHeight - panel.offsetHeight - 16))}px`;
  };
  const render = () => {
    if (!alive()) return;
    let state: string, text: string;
    if (!navigator.onLine) { state = 'offline'; text = 'Your browser reports that it is offline. Server availability is not confirmed.'; }
    else if (pending) { state = 'checking'; text = 'Checking the server…'; }
    else if (uncertain) { state = 'unconfirmed'; text = 'Current server availability has not been confirmed. Check the server to try again.'; }
    else if (!last?.ok) { state = 'unconfirmed'; text = 'Server availability could not be confirmed. You can check again.'; }
    else if (Date.now() - last.at >= ageLimit) { state = 'stale'; text = 'The last server check is more than five minutes old. Check again for a recent result.'; }
    else { state = 'checked'; text = 'Last server check succeeded. Check again to confirm current availability.'; }
    root.dataset.state = state;
    dot.dataset.state = state === 'checked' ? 'ok' : state === 'offline' ? 'error' : 'unknown';
    summary.setAttribute('aria-label', `Server connection. ${text}`);
    message.textContent = text;
    detail.textContent = last ? `${last.ok ? 'Last successful check' : 'Last check'}: ${new Date(last.at).toLocaleString()}.${last.error ? ` ${last.error}` : ''}` : '';
    button.disabled = Boolean(pending);
    button.textContent = pending ? 'Checking…' : 'Check server';
    root.setAttribute('aria-busy', String(Boolean(pending)));
    placePanel();
  };
  const check = () => {
    if (pending) return pending;
    if (!alive()) return Promise.resolve({ ok: false as const, error: new Error('Connection view is closed.') });
    clearTimeout(expiry);
    const generation = networkGeneration;
    const ownedFocus = document.activeElement === button;
    const submittedFocus = focusRevision;
    // Start after assigning ownership, including when a test/helper rejects synchronously.
    pending = Promise.resolve().then(async () => {
      try {
        await healthCheck();
        if (alive()) {
          last = { ok: true, at: Date.now() };
          uncertain = generation !== networkGeneration;
          expiry = setTimeout(render, ageLimit + 1);
        }
        return { ok: true as const };
      } catch (error) {
        const failure = error instanceof Error ? error : new Error('The server check could not complete.');
        if (alive()) { last = { ok: false, at: Date.now(), error: failure.message }; uncertain = generation !== networkGeneration; }
        return { ok: false as const, error: failure };
      } finally {
        pending = undefined;
        render();
        if (ownedFocus && submittedFocus === focusRevision && alive() && root.open
          && (document.activeElement === document.body || document.activeElement === button)) button.focus({ preventScroll: true });
      }
    });
    render();
    return pending;
  };
  button.addEventListener('click', () => { void check(); }, { signal: events.signal });
  document.addEventListener('focusin', event => {
    if (event.target !== button && event.target !== document.body) focusRevision++;
  }, { signal: events.signal });
  root.addEventListener('toggle', placePanel, { signal: events.signal });
  window.addEventListener('resize', placePanel, { signal: events.signal });
  window.addEventListener('scroll', placePanel, { passive: true, signal: events.signal });
  const networkChanged = () => { networkGeneration++; uncertain = true; render(); };
  window.addEventListener('offline', networkChanged, { signal: events.signal });
  window.addEventListener('online', networkChanged, { signal: events.signal });
  document.addEventListener('click', event => { if (root.open && !root.contains(event.target as Node)) root.open = false; }, { signal: events.signal });
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape' && root.open) { event.preventDefault(); event.stopPropagation(); root.open = false; summary.focus({ preventScroll: true }); }
  }, { signal: events.signal });
  root.addEventListener('focusout', event => {
    if (event.relatedTarget instanceof HTMLElement && event.relatedTarget !== document.body && !root.contains(event.relatedTarget)) root.open = false;
  }, { signal: events.signal });
  render();
  return { check, dispose: () => { disposed = true; events.abort(); clearTimeout(expiry); } };
}
