/** Hash navigation needs no server routes and never encodes member data or credentials. */
export function installManualScrollRestoration(): void {
  // Route restoration and public guide anchors already set their own positions.
  // Browser auto-restoration can run after popstate and overwrite those positions.
  try { window.history.scrollRestoration = 'manual'; } catch { /* Unsupported history must not prevent startup. */ }
}

export function routeFromHash(hash: string, allowed: readonly string[]): string | null {
  const value = new URLSearchParams(hash.replace(/^#/, '')).get('view');
  return value && allowed.includes(value) ? value : null;
}

/** Only public guide headings may enter a section URL; never private record IDs. */
export const GUIDE_SECTION_IDS = [
  'guide-phase-1', 'guide-phase-2', 'guide-duty-eligibility', 'guide-monthly-workflow',
  'guide-sections', 'guide-admin', 'guide-terms', 'guide-suggestions',
  'guide-problems', 'guide-checklist',
] as const;

export function guideSectionFromHash(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const section = params.get('section');
  return params.get('view') === 'user-guide' && section && GUIDE_SECTION_IDS.some(id => id === section)
    ? section : null;
}

export function writeRoute(view: string, replace = false): void {
  const url = new URL(window.location.href);
  const params = new URLSearchParams({view});
  const section = view === 'user-guide' ? guideSectionFromHash(url.hash) : null;
  if (section) params.set('section', section);
  url.hash = params.toString();
  if (url.href === window.location.href) return;
  if (replace) window.history.replaceState(null, '', url);
  else window.history.pushState(null, '', url);
}

/** Restore after real content replaces a skeleton; cancel when navigation supersedes it. */
export function restoreViewScroll(host: HTMLElement, position: {x: number; y: number}, current: () => boolean): () => void {
  let done = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;
  const stop = () => { done = true; observer.disconnect(); clearTimeout(timer); cancelAnimationFrame(frame); };
  const inspect = () => {
    if (done) return;
    if (!host.isConnected || !current()) { stop(); return; }
    if (host.querySelector('[aria-busy="true"], .skeleton') || !host.textContent?.trim()) return;
    frame = requestAnimationFrame(() => {
      if (current() && host.isConnected) window.scrollTo(position.x, position.y);
      stop();
    });
  };
  const observer = new MutationObserver(inspect);
  observer.observe(host, {childList: true, subtree: true, attributes: true, attributeFilter: ['aria-busy']});
  // A bounded observer never survives an indefinitely unavailable screen.
  timer = setTimeout(stop, 120000);
  inspect();
  return stop;
}
