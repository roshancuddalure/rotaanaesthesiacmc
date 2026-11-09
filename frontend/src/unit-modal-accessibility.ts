const UNIT_FOCUSABLE = 'button:not(:disabled), a[href], input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]';

/** Own only the nested unit overlay's focus. Existing view-root delegation keeps all actions. */
export function bindUnitModalAccessibility(root: HTMLElement | null, closeModal: () => void, signal: AbortSignal): void {
  if (!root || signal.aborted) return;
  let current: HTMLElement | null = null;
  let opener: HTMLElement | null = null;
  let openerUnit: string | undefined;
  let openerSpecial: string | undefined;
  let outsideFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const background = new Map<HTMLElement, boolean>();
  const visible = (element: HTMLElement): boolean => element.isConnected && !!element.getClientRects().length
    && !element.closest('[hidden], [inert]') && getComputedStyle(element).visibility !== 'hidden';
  const releaseBackground = (): void => {
    for (const [element, inert] of background) element.inert = inert;
    background.clear();
  };
  const otherOverlayOwnsFocus = (): boolean => !!document.querySelector('dialog[open]')
    || [...document.querySelectorAll<HTMLElement>('body > .modal-backdrop, body > .mobile-more-backdrop')]
      .some(element => !!element.getClientRects().length && !element.hidden);
  const items = (modal: HTMLElement): HTMLElement[] => [...modal.querySelectorAll<HTMLElement>(UNIT_FOCUSABLE)]
    .filter(element => element.tabIndex >= 0 && visible(element));
  const usableOpener = (element: HTMLElement | null): element is HTMLElement => !!element && visible(element)
    && !element.matches(':disabled')
    && (element.tabIndex >= 0 || element.hasAttribute('tabindex') || element.isContentEditable)
    && !element.closest('dialog, .modal-backdrop, .mobile-more-backdrop');
  const rememberOpener = (): void => {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    opener = usableOpener(active) ? active : usableOpener(outsideFocus) ? outsideFocus : null;
    const trigger = opener?.closest<HTMLElement>('[data-open-unit-modal], [data-open-special-unit-modal]');
    openerUnit = trigger?.dataset.openUnitModal;
    openerSpecial = trigger?.dataset.openSpecialUnitModal;
  };
  const restoreOpener = (): void => {
    if (otherOverlayOwnsFocus()) return;
    let target = usableOpener(opener) ? opener : null;
    if (!target && (openerUnit || openerSpecial)) {
      target = [...root.querySelectorAll<HTMLElement>('[data-open-unit-modal], [data-open-special-unit-modal]')]
        .filter(element => visible(element) && (openerUnit ? element.dataset.openUnitModal === openerUnit : element.dataset.openSpecialUnitModal === openerSpecial))
        .find(element => element.matches('button')) ?? null;
    }
    if (!target && (openerUnit || openerSpecial)) target = root.querySelector<HTMLElement>('[data-refresh-unit-board]');
    if (target && visible(target)) target.focus({ preventScroll: true });
  };
  const shieldBackground = (modal: HTMLElement): void => {
    const app = document.getElementById('app');
    if (!app?.contains(modal)) return;
    let branch: HTMLElement = modal;
    while (branch !== app && branch.parentElement) {
      for (const sibling of branch.parentElement.children) {
        if (sibling !== branch && sibling instanceof HTMLElement) {
          if (!background.has(sibling)) background.set(sibling, sibling.inert);
          sibling.inert = true;
        }
      }
      branch = branch.parentElement;
    }
  };
  const focusInitial = (modal: HTMLElement, old: HTMLElement | null): void => {
    if (otherOverlayOwnsFocus() || modal.closest('[inert]')) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && modal.contains(active)) return;
    const oldNavigation = active instanceof HTMLElement && old?.contains(active) ? active.getAttribute('aria-label') : null;
    const target = oldNavigation ? items(modal).find(element => element.getAttribute('aria-label') === oldNavigation) : null;
    (target ?? modal.querySelector<HTMLElement>('[data-close-unit-modal]') ?? items(modal)[0])?.focus({ preventScroll: true });
  };
  const refresh = (): void => {
    const next = root.querySelector<HTMLElement>('#unit-management-modal');
    if (next === current) return;
    const previous = current;
    const active = document.activeElement;
    const shouldRestore = !!previous && (!active || active === document.body || previous.contains(active));
    releaseBackground();
    if (next && !previous) rememberOpener();
    current = next;
    if (next) {
      shieldBackground(next);
      focusInitial(next, previous);
    } else {
      if (shouldRestore) restoreOpener();
      opener = null;openerUnit = undefined;openerSpecial = undefined;
    }
  };
  const observer = new MutationObserver(refresh);
  observer.observe(root, { childList: true, subtree: true });
  // Native workspaces may outlive the unit DOM they opened from. Let their own
  // close handlers finish first, then recover only otherwise unowned BODY focus.
  const resumeAfterNative = (): void => {
    if (signal.aborted || !current?.isConnected || otherOverlayOwnsFocus()) return;
    if (document.activeElement === document.body) focusInitial(current, null);
  };
  const watched = new WeakSet<HTMLDialogElement>();
  const watchNative = (dialog: HTMLDialogElement): void => {
    if (watched.has(dialog) || signal.aborted) return;
    watched.add(dialog);
    dialog.addEventListener('close', () => {
      watched.delete(dialog);
      queueMicrotask(() => {
        resumeAfterNative();
        if (dialog.isConnected) watchNative(dialog);
      });
    }, { once: true, signal });
  };
  for (const dialog of document.querySelectorAll<HTMLDialogElement>('body > dialog')) watchNative(dialog);
  const nativeObserver = new MutationObserver(records => {
    let removedOverlay = false;
    for (const record of records) {
      for (const node of record.addedNodes) if (node instanceof HTMLDialogElement) watchNative(node);
      for (const node of record.removedNodes) {
        if (node instanceof HTMLDialogElement && node.open) removedOverlay = true;
        else if (node instanceof HTMLElement && node.matches('.modal-backdrop, .mobile-more-backdrop')) removedOverlay = true;
      }
    }
    if (removedOverlay) queueMicrotask(resumeAfterNative);
  });
  nativeObserver.observe(document.body, { childList: true });
  document.addEventListener('click', event => {
    const target = event.target;
    if (!(target instanceof Element) || otherOverlayOwnsFocus()) return;
    if (!current?.contains(target)) {
      const trigger = target.closest<HTMLElement>('[data-open-unit-modal], [data-open-special-unit-modal]');
      if (!trigger || !root.contains(trigger) || target.closest('[data-open-member], [data-unit-member-action]')) return;
      const unitOpener = target.closest<HTMLElement>('button, a[href], [tabindex]')
        ?? trigger.querySelector<HTMLButtonElement>('button[data-open-unit-modal], button[data-open-special-unit-modal]')
        ?? trigger;
      // Commit only the actual opening action. A cancelled pointer gesture has
      // no stored candidate that could override later keyboard focus.
      if (usableOpener(unitOpener) && document.activeElement !== unitOpener) unitOpener.focus({ preventScroll: true });
      return;
    }
    // WebKit may blur a pointer-activated button after pointerdown. Capture
    // click before the existing delegated handler records its upper workspace opener.
    const workspaceOpener = target.closest<HTMLButtonElement>('button[data-open-member], button[data-add-operational-record], button[data-edit-operational-record], button[data-open-review-action]');
    if (workspaceOpener && !workspaceOpener.disabled && visible(workspaceOpener) && document.activeElement !== workspaceOpener) workspaceOpener.focus({ preventScroll: true });
  }, { capture: true, signal });
  document.addEventListener('focusin', event => {
    const target = event.target;
    if (target instanceof HTMLElement && !target.closest('dialog, .modal-backdrop, .mobile-more-backdrop')) outsideFocus = target;
  }, { capture: true, signal });
  document.addEventListener('keydown', event => {
    const modal = current;
    if (!modal || !visible(modal) || otherOverlayOwnsFocus() || event.defaultPrevented) return;
    if (event.key === 'Escape') {
      const target = event.target instanceof HTMLElement ? event.target : null;
      // Existing expanded help owns its first Escape through the shared handler.
      if (target?.closest('[data-help][aria-expanded="true"]')) return;
      event.preventDefault();closeModal();
    } else if (event.key === 'Tab') {
      const controls = items(modal), first = controls[0], last = controls[controls.length - 1];
      if (!first || !last) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
        event.preventDefault();last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) {
        event.preventDefault();first.focus();
      }
    }
  }, { capture: true, signal });
  signal.addEventListener('abort', () => { observer.disconnect();nativeObserver.disconnect();releaseBackground();current = null;opener = null; }, { once: true });
  refresh();
}
