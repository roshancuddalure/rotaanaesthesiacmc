import "./styles.css";
import { getMetadata, healthCheck } from "./services/api";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App root not found");
}

app.innerHTML = `
  <main class="shell">
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-mark">DR</span>
        <div>
          <h1>Duty Rota</h1>
          <p>Admin console</p>
        </div>
      </div>
      <nav class="nav">
        <button class="active">Overview</button>
        <button>Imports</button>
        <button>People</button>
        <button>Rota Board</button>
        <button>Leave</button>
        <button>Validation</button>
        <button>Exports</button>
      </nav>
    </aside>
    <section class="content">
      <header class="topbar">
        <div>
          <p class="eyebrow">Phase 0 scaffold</p>
          <h2>CMC Anaesthesia duty rota operations</h2>
        </div>
        <span id="api-status" class="status">Checking API...</span>
      </header>
      <section class="grid">
        <article class="panel">
          <h3>Foundation</h3>
          <p>Backend, frontend, PostgreSQL, Docker, and planning docs are now separated into a working skeleton.</p>
        </article>
        <article class="panel">
          <h3>Rules First</h3>
          <p>The backend starts with domain modules for call levels, duty types, and 24-hour spacing validation.</p>
        </article>
        <article class="panel">
          <h3>Next Build</h3>
          <p>Phase 1 will add the real PostgreSQL models for people, aliases, units, leaves, duty slots, and assignments.</p>
        </article>
      </section>
      <section class="panel wide">
        <h3>Loaded Metadata</h3>
        <pre id="metadata">Loading...</pre>
      </section>
    </section>
  </main>
`;

const apiStatus = document.querySelector<HTMLSpanElement>("#api-status");
const metadata = document.querySelector<HTMLPreElement>("#metadata");

async function boot() {
  try {
    await healthCheck();
    if (apiStatus) {
      apiStatus.textContent = "API online";
      apiStatus.classList.add("ok");
    }

    const data = await getMetadata();
    if (metadata) {
      metadata.textContent = JSON.stringify(data, null, 2);
    }
  } catch (error) {
    if (apiStatus) {
      apiStatus.textContent = "API offline";
      apiStatus.classList.add("error");
    }
    if (metadata) {
      metadata.textContent = error instanceof Error ? error.message : "Unable to load metadata";
    }
  }
}

boot();

