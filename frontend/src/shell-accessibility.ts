const focusable = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])';

/** Focus management for the legacy shell overlays; native dialogs keep their own lifecycle. */
export function installShellOverlayAccessibility() {
  let previous: HTMLElement[] = [];
  let lastOutsideFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
  let lastOpenerFocus = lastOutsideFocus;
  const openers = new WeakMap<HTMLElement, HTMLElement>();
  const overlayInert = new Map<HTMLElement, boolean>();
  let originalInert: boolean | undefined;
  const overlays = () => [...document.querySelectorAll<HTMLElement>('body > .modal-backdrop, body > .mobile-more-backdrop')]
    .filter((el) => el.querySelector('[role="dialog"][aria-modal="true"]') && el.getClientRects().length > 0);
  const refresh = () => {
    const current = overlays();
    const app = document.getElementById('app');
    const last = current[current.length - 1];
    for (const overlay of current) {
      if (!previous.includes(overlay)) {
        const opener = lastOpenerFocus && !overlay.contains(lastOpenerFocus) ? lastOpenerFocus : lastOutsideFocus;
        if (opener) openers.set(overlay, opener);
      }
      if (!overlayInert.has(overlay)) overlayInert.set(overlay, overlay.inert);
    }
    for (const [overlay, wasInert] of overlayInert) {
      overlay.inert = current.includes(overlay) && overlay !== last ? true : wasInert;
      if (!current.includes(overlay)) overlayInert.delete(overlay);
    }
    if (app && current.length && originalInert === undefined) { originalInert = app.inert; app.inert = true; }
    if (app && !current.length && originalInert !== undefined) { app.inert = originalInert; originalInert = undefined; }
    const removedTop = previous[previous.length - 1];
    const changed = previous[previous.length - 1] !== last;
    previous = current;
    if (!changed || document.querySelector('dialog[open]')) return;
    if (last && !last.contains(document.activeElement)) {
      const opener = removedTop && openers.get(removedTop);
      if (opener?.isConnected && last.contains(opener) && !opener.closest('[inert]') && opener.getClientRects().length) {
        opener.focus({ preventScroll: true });
        return;
      }
      const target = [...last.querySelectorAll<HTMLElement>(focusable)].find((el) => el.getClientRects().length);
      target?.focus({ preventScroll: true });
    } else if (!last && removedTop) {
      const opener = openers.get(removedTop);
      if (opener?.isConnected && opener.getClientRects().length && !opener.closest('[inert]')) opener.focus({ preventScroll: true });
      else document.getElementById('account-menu-button')?.focus({ preventScroll: true });
    }
  };
  new MutationObserver(refresh).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('focusin', (event) => {
    const target = event.target;
    if (target instanceof HTMLElement) {
      if (!target.closest('.modal-backdrop, .mobile-more-backdrop, dialog')) lastOutsideFocus = target;
      if (!target.closest('.modal-backdrop, .mobile-more-backdrop, dialog') || previous.some(overlay => overlay.contains(target))) lastOpenerFocus = target;
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab' || document.querySelector('dialog[open]')) return;
    const stack = overlays();
    const top = stack[stack.length - 1];
    if (!top) return;
    const items = [...top.querySelectorAll<HTMLElement>(focusable)].filter((el) => el.getClientRects().length && !el.closest('[hidden], [inert]'));
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && (document.activeElement === first || !top.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !top.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
  });
}
