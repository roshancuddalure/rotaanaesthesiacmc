type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
let validationSequence = 0;

export function installFormValidation(form: HTMLFormElement, summary: HTMLElement,
  resolve?: (path: Array<string | number>) => Field | null) {
  const prefix = `field-validation-${++validationSequence}-`;
  const marked = new Map<Field, string[]>();
  const clear = () => {
    for (const [field, ids] of marked) {
      field.removeAttribute("aria-invalid");
      const described = (field.getAttribute("aria-describedby") || "").split(/\s+/).filter(id => id && !ids.includes(id));
      if (described.length) field.setAttribute("aria-describedby", described.join(" "));
      else field.removeAttribute("aria-describedby");
    }
    marked.clear();
    form.querySelectorAll('[data-validation-hint]').forEach(node => node.remove());
    summary.replaceChildren();
  };
  form.addEventListener("input", clear);
  form.addEventListener("change", clear);
  const show = (error: unknown, moveFocus = true) => {
    if (!form.isConnected || !form.closest("dialog[open]")) return;
    clear();
    summary.tabIndex = -1;
    summary.textContent = error instanceof Error ? error.message : "The change could not be saved. Review the fields and try again.";
    const detail = (error as { detail?: unknown })?.detail;
    if (Array.isArray(detail)) {
      const list = document.createElement("ul");
      detail.forEach((item, index) => {
        if (!Array.isArray(item?.loc) || typeof item.msg !== "string") return;
        const path = item.loc.filter((part: unknown) => part !== "body");
        const name = path.length === 1 ? path[0] : path.length === 2 && path[0] === "behavior" ? path[1] : undefined;
        const candidate = resolve?.(path) ?? (typeof name === "string" ? form.elements.namedItem(name) : null);
        const field = candidate instanceof HTMLInputElement || candidate instanceof HTMLSelectElement || candidate instanceof HTMLTextAreaElement ? candidate : null;
        const row = document.createElement("li");
        if (field) {
          const labelNode = field.labels?.[0]?.cloneNode(true) as HTMLElement | undefined;
          labelNode?.querySelectorAll('input, select, textarea, [data-validation-hint]').forEach(node => node.remove());
          const label = labelNode?.textContent?.trim() || String(name || path.join(" ")).replace(/_/g, " ");
          const hint = document.createElement("span");
          hint.id = `${prefix}${index}`; hint.dataset.validationHint = ""; hint.className = "mw-error"; hint.textContent = item.msg;
          field.after(hint);
          field.setAttribute("aria-invalid", "true");
          marked.set(field, [...(marked.get(field) || []), hint.id]);
          field.setAttribute("aria-describedby", [field.getAttribute("aria-describedby"), hint.id].filter(Boolean).join(" "));
          const link = document.createElement("button");
          link.type = "button"; link.className = "quiet-button";
          link.textContent = `${label}: ${item.msg}`;
          link.onclick = () => {
            let parent = field.parentElement;
            while (parent && parent !== form) {
              if (parent instanceof HTMLDetailsElement) parent.open = true;
              parent = parent.parentElement;
            }
            field.focus();
          };
          row.append(link);
        } else row.textContent = item.msg;
        list.append(row);
      });
      if (list.children.length) summary.append(list);
    }
    if (moveFocus) summary.focus({ preventScroll: false });
  };
  return { clear, show };
}

/** Preserve a meaningful editing destination chosen during a slow request. */
export function watchFormFocus() {
  let moved = false;
  const listener = (event: FocusEvent) => {
    if (event.target !== document.body && event.target !== document.documentElement) moved = true;
  };
  document.addEventListener("focusin", listener);
  return { unchanged: () => !moved, stop: () => document.removeEventListener("focusin", listener) };
}
