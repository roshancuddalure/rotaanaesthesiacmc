/* Independent of the bundled app: entry or stylesheet failure must stay recoverable. */
(() => {
  // The module can finish before this independent deferred script executes.
  // Consult the persistent marker as well as the event to avoid false recovery panels.
  let ready = document.documentElement.dataset.frontendReady === "true";
  const settled = () => { ready = true; clearTimeout(watchdog); };
  const show = () => {
    if (ready || document.documentElement.dataset.frontendReady === "true" || document.getElementById("frontend-startup")) return;
    const panel = document.createElement("section");
    panel.id = "frontend-startup";
    panel.className = "frontend-recovery";
    panel.setAttribute("role", "status");
    const message = document.createElement("p");
    message.textContent = "The app is taking longer to start. Check your connection. Reload only after saving or copying any work.";
    const retry = document.createElement("a");
    retry.href = window.location.href;
    retry.textContent = "Reload app";
    retry.addEventListener("click", (event) => {
      if (!window.confirm("Reloading can discard unsaved changes. Continue?")) event.preventDefault();
    });
    panel.append(message, retry);
    document.body.append(panel);
  };
  const watchdog = ready ? undefined : setTimeout(show, 20000);
  const showStyleFailure = () => {
    if (document.getElementById("frontend-style-recovery")) return;
    const panel = document.createElement("aside");
    panel.id = "frontend-style-recovery";
    panel.setAttribute("role", "alert");
    // This notice must remain readable when the app's stylesheet is unavailable.
    panel.style.cssText = "position:relative;z-index:2147483647;margin:12px;padding:16px;border:2px solid #493a8f;background:#fff;color:#20243a;font:16px/1.5 system-ui,sans-serif;overflow-wrap:anywhere";
    const message = document.createElement("p");
    message.textContent = "Appearance could not load. Your current work remains open. Save or copy unsaved changes before reloading.";
    const reload = document.createElement("a");
    reload.href = window.location.href;
    reload.textContent = "Reload app";
    reload.style.cssText = "display:inline-block;padding:12px;color:#423286";
    reload.addEventListener("click", event => {
      if (!window.confirm("Reloading can discard unsaved changes. Have you saved or copied your work?")) event.preventDefault();
    });
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.textContent = "Keep working";
    dismiss.style.cssText = "padding:12px;font:inherit;color:#20243a;background:#fff;border:1px solid #493a8f";
    dismiss.addEventListener("click", () => panel.remove());
    panel.append(message, reload, dismiss);
    document.body.append(panel);
  };
  const checkStyles = () => {
    // A failed initial link can precede this deferred script's error listener.
    // Only inspect after load, when pending stylesheets have settled.
    const links = [...document.querySelectorAll('link[rel~="stylesheet"][href]')].filter(link => !link.disabled);
    const appStyles = links.some(link => /\/assets\/index-[\w-]+\.css(?:\?|$)/.test(link.href));
    // Some browsers expose an empty sheet even for an unsuccessful HTTP response.
    // The shipped app stylesheet always defines this semantic token.
    const missingAppTokens = appStyles && !getComputedStyle(document.documentElement).getPropertyValue("--color-primary").trim();
    if (missingAppTokens || links.some(link => !link.sheet)) showStyleFailure();
  };
  if (document.readyState === "complete") checkStyles();
  else window.addEventListener("load", checkStyles, { once: true });
  window.addEventListener("duty-rota:frontend-ready", settled, { once: true });
  window.addEventListener("error", (event) => {
    const target = event.target;
    if (target instanceof HTMLLinkElement && target.relList.contains("stylesheet")) showStyleFailure();
    else if (target instanceof HTMLScriptElement) show();
  }, true);
})();
