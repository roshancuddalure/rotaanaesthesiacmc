// Passive transport observation: preserves the native fetch call/return value.
// WebKit's interception protocol may omit file payload bytes in postDataBuffer().
export async function observeImportUploads(page) {
  await page.addInitScript(() => {
    const originalFetch = window.fetch;
    window.__importUploadObservations = [];
    window.fetch = function(resource, init) {
      if (init?.body instanceof FormData) {
        const pathname = new URL(typeof resource === 'string' ? resource : resource.url, location.href).pathname;
        const observation = Promise.all([...init.body.entries()].map(async ([key, value]) => [key, value instanceof File ? { filename: value.name, bytes: await value.text() } : value])).then(entries => ({ pathname, entries }));
        window.__importUploadObservations.push(observation);
      }
      return originalFetch.apply(this, arguments);
    };
  });
}
export async function observedImportFile(page, pathname) {
  return page.evaluate(async pathname => {
    const observations = await Promise.all(window.__importUploadObservations);
    return observations.filter(item => item.pathname === pathname).at(-1)?.entries.find(([key]) => key === 'file')?.[1];
  }, pathname);
}
