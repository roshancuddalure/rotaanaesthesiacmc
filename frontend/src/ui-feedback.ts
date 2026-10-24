/** Feedback remains readable without interpreting server text as markup. */
export function announceToast(message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    container.setAttribute('role', 'region');
    container.setAttribute('aria-label', 'Notifications');
    container.tabIndex = 0;
    const content = document.querySelector('.shell > .content');
    const view = content?.querySelector('#view-root');
    if (content && view) {
      container.classList.add('toast-container--in-content');
      content.insertBefore(container, view);
    } else document.body.append(container);
  }
  const duplicate = [...container.children].find((item) => item.getAttribute('data-message') === message && item.getAttribute('data-type') === type);
  if (duplicate) return;
  const updateSummary = () => {
    const count = container.querySelectorAll('.toast').length;
    let summary = container.querySelector<HTMLElement>('.toast-summary');
    if (!count) { summary?.remove(); return; }
    if (!summary) {
      summary = document.createElement('p');
      summary.className = 'toast-summary';
      container.prepend(summary);
    }
    summary.textContent = `${count} ${count === 1 ? 'notification' : 'notifications'} · Scroll to review`;
  };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.dataset.message = message;
  toast.dataset.type = type;
  const content = document.createElement('span');
  content.setAttribute('role', type === 'error' ? 'alert' : 'status');
  content.textContent = message;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-dismiss';
  close.setAttribute('aria-label', 'Dismiss notification');
  close.textContent = 'Dismiss';
  toast.append(content, close);
  container.append(toast);
  updateSummary();
  let timer = 0;
  let remaining = 7000;
  let started = 0;
  const dismiss = () => {
    const ownedFocus = toast.contains(document.activeElement);
    const next = toast.nextElementSibling?.querySelector<HTMLElement>('.toast-dismiss')
      ?? toast.previousElementSibling?.querySelector<HTMLElement>('.toast-dismiss');
    window.clearTimeout(timer);
    toast.remove();
    updateSummary();
    if (ownedFocus) {
      if (next) next.focus();
      else {
        const destination = document.querySelector<HTMLElement>('#section-title');
        if (destination) { destination.tabIndex = -1; destination.focus(); }
      }
    }
  };
  const pause = () => { window.clearTimeout(timer); if (started) remaining = Math.max(0, remaining - (Date.now() - started)); started = 0; };
  const resume = () => {
    if (type === 'error' || toast.matches(':hover') || toast.contains(document.activeElement)) return;
    window.clearTimeout(timer);
    started = Date.now();
    timer = window.setTimeout(dismiss, remaining);
  };
  close.addEventListener('click', dismiss);
  toast.addEventListener('mouseenter', pause);
  toast.addEventListener('mouseleave', resume);
  toast.addEventListener('focusin', pause);
  toast.addEventListener('focusout', () => queueMicrotask(resume));
  resume();
}
