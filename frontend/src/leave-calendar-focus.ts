/** Reveal the owned month date while preserving native Tab and manual scrolling. */
export function bindLeaveCalendarFocus(root: HTMLElement | null, lifetime: AbortSignal): void {
  if (!root || lifetime.aborted) return;
  const view = root.ownerDocument.defaultView;
  if (!view) return;
  let stopPending: (() => void) | undefined;
  const recovery = new WeakMap<HTMLElement, { element: HTMLElement; text: string; role: string | null }>();
  const stop = () => { stopPending?.(); };
  lifetime.addEventListener("abort", stop, { once: true });

  function help(region: HTMLElement, failed: boolean): void {
    const saved = recovery.get(region);
    if (!failed) {
      if (saved?.element.isConnected) {
        saved.element.textContent = saved.text;
        if (saved.role === null) saved.element.removeAttribute("role");
        else saved.element.setAttribute("role", saved.role);
      }
      recovery.delete(region);
      return;
    }
    if (saved) return;
    const element = root!.ownerDocument.getElementById("leave-month-scroll-help");
    if (!element || !root!.contains(element)) return;
    recovery.set(region, { element, text: element.textContent ?? "", role: element.getAttribute("role") });
    element.textContent = "Choose Day list for a full-width view if a focused date is clipped. Calendar focus reveal is currently unavailable.";
    element.setAttribute("role", "status");
  }

  root.addEventListener("focusin", event => {
    stop();
    const eventTarget = event.target;
    if (!(eventTarget instanceof HTMLButtonElement) || !eventTarget.matches("[data-leave-day]")) return;
    const target = eventTarget;
    const region = target.closest<HTMLElement>(".leave-month-scroll");
    if (!region || !root!.contains(region) || target !== root!.ownerDocument.activeElement) return;
    const pending = new AbortController();
    let frame = 0, stable = 0, last = "";
    const started = view!.performance.now();
    const cancel = () => {
      const outstanding = frame;
      frame = 0;
      if (stopPending === cancel) stopPending = undefined;
      pending.abort();
      if (outstanding) {
        try {
          if (typeof view!.cancelAnimationFrame === "function") view!.cancelAnimationFrame(outstanding);
        } catch {
          // Aborted ownership prevents an uncancellable callback from doing work.
        }
      }
    };
    stopPending = cancel;
    const intentOptions = { capture: true, once: true, signal: pending.signal };
    for (const name of ["pointerdown", "wheel", "keydown"]) {
      root!.ownerDocument.addEventListener(name, cancel, intentOptions);
    }
    target.addEventListener("focusout", cancel, { once: true, signal: pending.signal });
    const owns = () => !pending.signal.aborted && !lifetime.aborted
      && root!.isConnected && region.isConnected && target.isConnected
      && root!.contains(region) && region.contains(target)
      && target === root!.ownerDocument.activeElement
      && !target.closest("[hidden], [inert]");

    function geometry() {
      const b = target.getBoundingClientRect(), c = region!.getBoundingClientRect();
      const style = view!.getComputedStyle(target);
      const ring = style.outlineStyle === "none" ? 0
        : (Number.parseFloat(style.outlineWidth) || 0) + Math.max(0, Number.parseFloat(style.outlineOffset) || 0);
      const left = c.left + region!.clientLeft, right = left + region!.clientWidth;
      return { b, c, ring, left, right,
        visible: b.width > 0 && b.height > 0 && c.width > 0 && c.height > 0,
        fits: b.left - ring >= left - 0.5 && b.right + ring <= right + 0.5 };
    }

    function tick(): void {
      frame = 0;
      if (!owns()) { cancel(); return; }
      try {
        const before = geometry();
        if (!before.visible) { cancel(); return; }
        if (view!.performance.now() - started >= 1000) {
          help(region!, true);
          cancel();
          return;
        }
        const margin = Math.max(5, before.ring + 1);
        const raw = before.b.left - margin < before.left ? before.b.left - margin - before.left
          : before.b.right + margin > before.right ? before.b.right + margin - before.right : 0;
        const delta = raw < 0 ? Math.floor(raw) : Math.ceil(raw);
        if (delta) {
          try {
            if (typeof region!.scrollBy !== "function") throw new Error("Native scroll unavailable");
            region!.scrollBy({ left: delta, behavior: "instant" });
          } catch {
            region!.scrollLeft += delta;
          }
        }
        const after = geometry();
        const signature = [after.b.left, after.b.right, after.b.top, after.b.bottom,
          after.c.left, after.c.right, after.c.top, after.c.bottom,
          region!.clientWidth, region!.clientHeight, region!.scrollLeft]
          .map(value => Math.round(value * 100) / 100).join(",");
        stable = after.fits && signature === last ? stable + 1 : 0;
        last = signature;
        if (stable >= 4) { help(region!, false); cancel(); return; }
        if (typeof view!.requestAnimationFrame !== "function") {
          help(region!, true);
          cancel();
          return;
        }
        frame = view!.requestAnimationFrame(tick);
      } catch {
        if (owns()) help(region!, true);
        cancel();
      }
    }
    tick();
  }, { signal: lifetime });
}
