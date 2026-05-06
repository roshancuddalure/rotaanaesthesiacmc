import "./styles.css";
import {
  type AdminMapping,
  type AnalysisDashboard,
  type AnalysisManualReview,
  type AnalysisPerson,
  type AnalysisPreflight,
  type DepartmentMember,
  type DuplicateCandidate,
  type DiagnosticsSummary,
  type InvalidMembersResult,
  type MappingOptions,
  type MappingType,
  type MemberAudit,
  type UserAccount,
  addMemberDesignation,
  autoMergeDuplicates,
  cleanupInvalidMembers,
  clearAuthToken,
  createMember,
  createUserAccount,
  forgotPassword,
  getAnalysisDashboard,
  getAnalysisManualReview,
  getAnalysisPreflight,
  getDedupeCandidates,
  getCurrentUser,
  getDiagnosticsSummary,
  getInvalidMembers,
  getMappingOptions,
  getMappings,
  getHistoricalImportStatus,
  getMemberAudit,
  getMembers,
  healthCheck,
  listUserAccounts,
  mergeMembers,
  prefillCallLevels,
  resetPassword,
  reconcileTrustedRoster,
  runHistoricalImport,
  scanHistoricalMappings,
  signIn,
  updateMapping,
  updateMember,
} from "./services/api";

/* ============================================================
   UX Helpers — Toast, Sidebar, Focus Preservation
   ============================================================ */

function createToastContainer() {
  if (document.getElementById("toast-container")) return;
  const container = document.createElement("div");
  container.id = "toast-container";
  container.className = "toast-container";
  container.setAttribute("aria-live", "polite");
  container.setAttribute("aria-atomic", "true");
  document.body.appendChild(container);
}

function showToast(message: string, type: "success" | "error" | "warning" | "info" = "info") {
  createToastContainer();
  const container = document.getElementById("toast-container");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 5000);
}

function setButtonLoading(button: HTMLElement | null, loading: boolean, originalText?: string) {
  if (!button) return;
  if (loading) {
    button.setAttribute("data-original-text", button.textContent || "");
    button.innerHTML = '<span class="spinner"></span> Loading…';
    button.setAttribute("disabled", "true");
  } else {
    button.textContent = originalText || button.getAttribute("data-original-text") || "Done";
    button.removeAttribute("disabled");
  }
}

function resetButton(button: HTMLElement | null) {
  if (!button) return;
  const original = button.getAttribute("data-original-text");
  if (original) button.textContent = original;
  button.removeAttribute("disabled");
}

let sidebarOpen = false;

function toggleSidebar(force?: boolean) {
  const sidebar = document.querySelector<HTMLElement>(".sidebar");
  const overlay = document.querySelector<HTMLElement>(".sidebar-overlay");
  sidebarOpen = force !== undefined ? force : !sidebarOpen;
  sidebar?.classList.toggle("open", sidebarOpen);
  overlay?.classList.toggle("active", sidebarOpen);
  document.body.style.overflow = sidebarOpen ? "hidden" : "";
}

function closeSidebarOnMobile() {
  if (window.innerWidth <= 768) toggleSidebar(false);
}

let lastFocusedId = "";

function saveFocus() {
  const el = document.activeElement as HTMLElement | null;
  if (el?.id) lastFocusedId = el.id;
}

function restoreFocus() {
  if (!lastFocusedId) return;
  const el = document.getElementById(lastFocusedId);
  if (el) el.focus();
}

function confirmAction(message: string): boolean {
  return window.confirm(message);
}

const appRoot = document.querySelector<HTMLDivElement>("#app");

if (!appRoot) {
  throw new Error("App root not found");
}

const app = appRoot;

let mappings: AdminMapping[] = [];
let options: MappingOptions = { duty_types: [], mapping_types: [] };
let activeMappingType: MappingType | "all" = "all";
let mappingSearch = "";
let analysis: AnalysisDashboard | null = null;
let analysisManualReview: AnalysisManualReview | null = null;
let analysisPreflight: AnalysisPreflight | null = null;
let members: DepartmentMember[] = [];
let dedupeCandidates: DuplicateCandidate[] = [];
let invalidMembers: InvalidMembersResult = { count: 0, people: [] };
let memberAudit: MemberAudit | null = null;
let memberSearch = "";
let memberPositionFilter = "all";
let memberCallLevelFilter = "all";
let memberSort = "name";
let memberSortDirection: "asc" | "desc" = "asc";
let currentUser: UserAccount | null = null;
let accounts: UserAccount[] = [];

function renderShell() {
  sidebarOpen = false;
  app.innerHTML = `
  <a href="#view-root" class="skip-link">Skip to content</a>
  <div class="sidebar-overlay" id="sidebar-overlay"></div>
  <main class="shell">
    <aside class="sidebar" id="sidebar">
      <div class="brand">
        <span class="brand-mark">DR</span>
        <div>
          <h1>Duty Rota</h1>
          <p>Admin console</p>
        </div>
        <button class="sidebar-close" id="sidebar-close" aria-label="Close menu">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <nav class="nav" aria-label="Main navigation">
        <button data-view="overview" class="active" aria-current="page">Overview</button>
        <button data-view="analysis">Analysis</button>
        <button data-view="mappings">Mappings</button>
        <button data-view="imports">Imports</button>
        <button data-view="members">Department Members</button>
        <button data-view="accounts">Login Accounts</button>
        <button data-view="diagnostics">Diagnostics</button>
        <button disabled title="Coming soon">Rota Board</button>
        <button disabled title="Coming soon">Leave</button>
        <button disabled title="Coming soon">Validation</button>
        <button disabled title="Coming soon">Exports</button>
      </nav>
    </aside>
    <section class="content">
      <header class="topbar">
        <div class="topbar-actions">
          <button class="sidebar-toggle" id="sidebar-toggle" aria-label="Open menu" aria-expanded="false">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>
          <div>
            <p class="eyebrow" id="section-eyebrow">Overview</p>
            <h2 id="section-title">CMC Anaesthesia duty rota operations</h2>
          </div>
        </div>
        <div class="topbar-actions">
          <span id="api-status" class="status">Checking API...</span>
          <button class="icon-button" id="sign-out">Sign Out</button>
        </div>
      </header>
      <div id="view-root"></div>
    </section>
  </main>
`;
  document.getElementById("sidebar-toggle")?.addEventListener("click", () => {
    const btn = document.getElementById("sidebar-toggle");
    toggleSidebar();
    if (btn) btn.setAttribute("aria-expanded", String(sidebarOpen));
  });
  document.getElementById("sidebar-close")?.addEventListener("click", () => {
    toggleSidebar(false);
    const btn = document.getElementById("sidebar-toggle");
    if (btn) btn.setAttribute("aria-expanded", "false");
  });
  document.getElementById("sidebar-overlay")?.addEventListener("click", () => {
    toggleSidebar(false);
    const btn = document.getElementById("sidebar-toggle");
    if (btn) btn.setAttribute("aria-expanded", "false");
  });
}

function renderLogin() {
  app.innerHTML = `
    <main class="auth-shell">
      <section class="auth-panel">
        <div class="brand login-brand">
          <span class="brand-mark">DR</span>
          <div>
            <h1>Duty Rota</h1>
            <p>Rota team sign in</p>
          </div>
        </div>
        <div class="auth-tabs">
          <button class="selected" data-auth-tab="signin">Sign In</button>
          <button data-auth-tab="forgot">Forgot Password</button>
        </div>
        <div id="auth-root"></div>
      </section>
    </main>
  `;
  renderSignInForm();
  app.querySelectorAll<HTMLButtonElement>("[data-auth-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      app.querySelectorAll<HTMLButtonElement>("[data-auth-tab]").forEach((item) => item.classList.remove("selected"));
      button.classList.add("selected");
      if (button.dataset.authTab === "forgot") renderForgotForm();
      else renderSignInForm();
    });
  });
}

function renderSignInForm() {
  const root = document.querySelector<HTMLDivElement>("#auth-root");
  if (!root) return;
  root.innerHTML = `
    <form id="login-form">
      <label for="login-username">Username</label>
      <input id="login-username" autocomplete="username" placeholder="Enter username" />
      <label for="login-password">Password</label>
      <input id="login-password" type="password" autocomplete="current-password" placeholder="Enter password" />
      <button class="primary full-width" type="submit" id="login-submit">Sign In</button>
      <p class="form-message" id="login-message"></p>
    </form>
  `;
  root.querySelector("#login-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const username = root.querySelector<HTMLInputElement>("#login-username")?.value ?? "";
    const password = root.querySelector<HTMLInputElement>("#login-password")?.value ?? "";
    const submitBtn = root.querySelector<HTMLButtonElement>("#login-submit");
    if (!username || !password) {
      const message = root.querySelector<HTMLParagraphElement>("#login-message");
      if (message) message.textContent = "Please enter username and password.";
      return;
    }
    setButtonLoading(submitBtn, true, "Sign In");
    try {
      const response = await signIn(username, password);
      currentUser = response.user;
      await bootApp();
    } catch (error) {
      const message = root.querySelector<HTMLParagraphElement>("#login-message");
      if (message) message.textContent = error instanceof Error ? error.message : "Sign in failed";
      resetButton(submitBtn);
    }
  });
}

function renderForgotForm() {
  const root = document.querySelector<HTMLDivElement>("#auth-root");
  if (!root) return;
  root.innerHTML = `
    <form id="forgot-form">
      <label for="forgot-username">Username</label>
      <input id="forgot-username" autocomplete="username" placeholder="Enter username" />
      <button class="primary full-width" type="submit" id="forgot-submit">Create Reset Token</button>
      <p class="form-message" id="forgot-message"></p>
    </form>
    <form id="reset-form" style="display:none;margin-top:12px;">
      <label for="reset-token">Reset Token</label>
      <input id="reset-token" readonly />
      <label for="reset-password">New Password</label>
      <input id="reset-password" type="password" autocomplete="new-password" placeholder="Enter new password" />
      <button class="primary full-width" type="submit" id="reset-submit">Reset Password</button>
    </form>
  `;
  root.querySelector("#forgot-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const username = root.querySelector<HTMLInputElement>("#forgot-username")?.value ?? "";
    const btn = root.querySelector<HTMLButtonElement>("#forgot-submit");
    if (!username) {
      const message = root.querySelector<HTMLParagraphElement>("#forgot-message");
      if (message) message.textContent = "Please enter a username.";
      return;
    }
    setButtonLoading(btn, true, "Create Reset Token");
    try {
      const result = await forgotPassword(username);
      const message = root.querySelector<HTMLParagraphElement>("#forgot-message");
      const token = root.querySelector<HTMLInputElement>("#reset-token");
      const section = root.querySelector<HTMLFormElement>("#reset-form");
      if (message) message.textContent = result.message;
      if (token && result.reset_token) token.value = result.reset_token;
      if (section) section.style.display = "grid";
      showToast("Reset token generated", "success");
    } catch (error) {
      const message = root.querySelector<HTMLParagraphElement>("#forgot-message");
      if (message) message.textContent = error instanceof Error ? error.message : "Failed to create token";
      showToast("Failed to create reset token", "error");
    } finally {
      resetButton(btn);
    }
  });
  root.querySelector("#reset-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const token = root.querySelector<HTMLInputElement>("#reset-token")?.value ?? "";
    const password = root.querySelector<HTMLInputElement>("#reset-password")?.value ?? "";
    const btn = root.querySelector<HTMLButtonElement>("#reset-submit");
    if (!token || !password) {
      const message = root.querySelector<HTMLParagraphElement>("#forgot-message");
      if (message) message.textContent = "Please enter token and new password.";
      return;
    }
    setButtonLoading(btn, true, "Reset Password");
    try {
      await resetPassword(token, password);
      const message = root.querySelector<HTMLParagraphElement>("#forgot-message");
      if (message) {
        message.textContent = "Password reset. You can sign in now.";
        message.classList.add("success");
      }
      showToast("Password reset successfully", "success");
      setTimeout(() => {
        renderSignInForm();
        document.querySelectorAll<HTMLButtonElement>("[data-auth-tab]").forEach((item) => item.classList.remove("selected"));
        document.querySelector<HTMLButtonElement>("[data-auth-tab='signin']")?.classList.add("selected");
      }, 1500);
    } catch (error) {
      const message = root.querySelector<HTMLParagraphElement>("#forgot-message");
      if (message) message.textContent = error instanceof Error ? error.message : "Reset failed";
      showToast("Password reset failed", "error");
      resetButton(btn);
    }
  });
}

renderShell();

let apiStatus = document.querySelector<HTMLSpanElement>("#api-status");
let viewRoot = document.querySelector<HTMLDivElement>("#view-root");
let sectionEyebrow = document.querySelector<HTMLParagraphElement>("#section-eyebrow");
let sectionTitle = document.querySelector<HTMLHeadingElement>("#section-title");

function refreshShellRefs() {
  apiStatus = document.querySelector<HTMLSpanElement>("#api-status");
  viewRoot = document.querySelector<HTMLDivElement>("#view-root");
  sectionEyebrow = document.querySelector<HTMLParagraphElement>("#section-eyebrow");
  sectionTitle = document.querySelector<HTMLHeadingElement>("#section-title");
}

function setApiStatus(text: string, className: "ok" | "error") {
  if (!apiStatus) return;
  apiStatus.textContent = text;
  apiStatus.classList.remove("ok", "error");
  apiStatus.classList.add(className);
}

function setHeader(eyebrow: string, title: string) {
  if (sectionEyebrow) sectionEyebrow.textContent = eyebrow;
  if (sectionTitle) sectionTitle.textContent = title;
}

function mappingTypeLabel(type: string): string {
  return type.replace("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function targetLabelForKey(key: string | null): string | null {
  if (!key) return null;
  return options.duty_types.find((dutyType) => dutyType.key === key)?.label ?? key;
}

function filteredMappings(): AdminMapping[] {
  const search = mappingSearch.trim().toLowerCase();
  return mappings.filter((mapping) => {
    const matchesType = activeMappingType === "all" || mapping.mapping_type === activeMappingType;
    const matchesSearch = !search || mapping.source_label.toLowerCase().includes(search);
    return matchesType && matchesSearch;
  });
}

function updateLocalMapping(id: string, patch: Partial<AdminMapping>) {
  mappings = mappings.map((mapping) => (mapping.id === id ? { ...mapping, ...patch } : mapping));
}

function renderOverview() {
  setHeader("Overview", "CMC Anaesthesia duty rota operations");
  if (!viewRoot) return;
  viewRoot.innerHTML = `
    <section class="summary-grid">
      <article class="metric">
        <span>${mappings.length}</span>
        <p>Mapping rows</p>
      </article>
      <article class="metric">
        <span>${mappings.filter((mapping) => mapping.status === "needs_review").length}</span>
        <p>Need review</p>
      </article>
      <article class="metric">
        <span>${mappings.filter((mapping) => mapping.status === "reviewed").length}</span>
        <p>Reviewed</p>
      </article>
    </section>
    <section class="panel">
      <h3>Import Control</h3>
      <p>Open Mappings to review duty labels, unit names, and posting groups before imported data is used on the rota board.</p>
    </section>
  `;
}

// ── Analysis dashboard state ─────────────────────────────────────────────────
let analysisTab: string = "overview";
let analysisPersonSearch: string = "";
let analysisPersonSort: keyof AnalysisPerson = "total_24hr";
let analysisPersonSortDir: "asc" | "desc" = "desc";

function topPeople(key: keyof AnalysisPerson, limit = 8): AnalysisPerson[] {
  if (!analysis) return [];
  return [...analysis.people]
    .filter((person) => Number(person[key]) > 0)
    .sort((a, b) => Number(b[key]) - Number(a[key]))
    .slice(0, limit);
}

function categoryLabel(key: string): string {
  return (
    ({
      main_24hr: "Main 24hr",
      cb_24hr: "CB 24hr",
      rc_24hr: "RC 24hr",
      schell: "Schell",
      floating: "Floating",
      fifth_call: "5th Call",
      cart: "CART",
      pac: "PAC",
      shift: "Shifts",
      caesar_a: "Caesar A",
      caesar_b: "Caesar B",
      rc12hr: "RC 12hr",
      cb_co12hr: "CB Co 12hr",
      chad: "CHAD",
      ruhsa: "RUHSA",
      neuro_dept: "Neuro",
    } as Record<string, string>)[key] ?? key
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function analysisCallLevelLabel(key: string): string {
  return (
    ({
      CO_1ST_CALL: "Co 1st Call",
      "1ST_CALL": "1st Call",
      "2ND_CALL": "2nd Call",
      "3RD_CALL": "3rd Call",
      CO_4TH_CALL: "Co 4th Call",
      "4TH_CALL": "4th Call",
      "5TH_CALL": "5th Call",
    } as Record<string, string>)[key] ?? key
  );
}

function renderPersonMetric(label: string, value: number): string {
  return `<article class="person-metric"><strong>${value}</strong><span>${label}</span></article>`;
}

function renderMiniRank(people: AnalysisPerson[], key: keyof AnalysisPerson): string {
  if (!people.length) return `<p class="empty-state">No data</p>`;
  return people
    .map(
      (person, index) => `
        <div class="rank-row">
          <button class="person-link" data-analysis-person="${escapeHtml(person.name)}">${index + 1}. ${escapeHtml(person.name)}</button>
          <strong>${Number(person[key])}</strong>
        </div>
      `,
    )
    .join("");
}

function renderBarChart(
  entries: Array<{ label: string; total: number; weekend?: number; title?: string }>,
  maxH = 120,
): string {
  const max = Math.max(...entries.map((e) => e.total), 1);
  return entries
    .map((e) => {
      const weekendH = Math.round(((e.weekend ?? 0) / max) * maxH);
      const weekdayH = Math.round(((e.total - (e.weekend ?? 0)) / max) * maxH);
      const singleH = Math.round((e.total / max) * maxH);
      const bars =
        e.weekend !== undefined
          ? `<div role="img" aria-label="Weekend ${e.weekend}" class="bar weekend-bar" style="height:${weekendH}px"></div><div role="img" aria-label="Weekday ${e.total - e.weekend}" class="bar weekday-bar" style="height:${weekdayH}px"></div>`
          : `<div role="img" aria-label="${e.total}" class="bar weekday-bar" style="height:${singleH}px"></div>`;
      return `
        <div class="bar-col" aria-label="${escapeHtml(e.title ?? e.label)}: ${e.total}">
          <span>${e.total}</span>
          <div class="bar-stack">${bars}</div>
          <small>${escapeHtml(e.label)}</small>
        </div>
      `;
    })
    .join("");
}

function renderMonthBars(): string {
  if (!analysis) return "";
  return renderBarChart(
    analysis.months.map((month) => ({
      label: analysis!.month_labels[month],
      total: analysis!.month_stats[month].total_24hr,
      weekend: analysis!.month_stats[month].weekend_24hr,
    })),
  );
}

function renderDayBars(): string {
  if (!analysis) return "";
  const totals = Object.fromEntries(analysis.days.map((day) => [day, 0]));
  analysis.people.forEach((person) => {
    analysis!.days.forEach((day) => {
      totals[day] += person.day_breakdown[day] ?? 0;
    });
  });
  return renderBarChart(
    analysis.days.map((day) => ({
      label: day.slice(0, 3),
      total: totals[day],
      weekend: day === "Saturday" || day === "Sunday" ? totals[day] : 0,
    })),
  );
}

// ── Tab: Overview ─────────────────────────────────────────────────────────────
function renderAnalysisOverviewTab(): string {
  if (!analysis) return "";
  const categories = Object.entries(analysis.duty_category_totals)
    .sort((a, b) => b[1] - a[1])
    .map(
      ([key, value]) => `
        <div class="category-pill">
          <span>${categoryLabel(key)}</span>
          <strong>${value}</strong>
        </div>
      `,
    )
    .join("");
  const monthPersonEntries = analysis.months.map((month) => ({
    label: analysis!.month_labels[month],
    total: analysis!.month_stats[month].persons,
  }));
  return `
    <div class="summary-grid four-col">
      <article class="metric"><span>${analysis.summary.total_24hr.toLocaleString()}</span><p>Total 24hr duties</p></article>
      <article class="metric"><span>${analysis.summary.total_weekend_24hr.toLocaleString()}</span><p>Weekend 24hr</p></article>
      <article class="metric"><span>${analysis.summary.weekend_percent}%</span><p>Weekend share</p></article>
      <article class="metric"><span>${analysis.summary.avg_24hr_per_active_person}</span><p>Avg per active person</p></article>
    </div>
    <div class="summary-grid four-col">
      <article class="metric"><span>${analysis.summary.personnel}</span><p>Total personnel</p></article>
      <article class="metric"><span>${analysis.summary.active_personnel}</span><p>Active in period</p></article>
      <article class="metric"><span>${analysis.summary.months}</span><p>Months analysed</p></article>
      <article class="metric"><span>${analysis.summary.total_records.toLocaleString()}</span><p>Total records</p></article>
    </div>
    <div class="analytics-grid">
      <article class="panel chart-panel">
        <h3>24hr Duties per Month</h3>
        <div class="chart-legend">
          <span class="legend-dot weekend-dot"></span>Weekend &nbsp;
          <span class="legend-dot weekday-dot"></span>Weekday
        </div>
        <div class="bar-chart">${renderMonthBars()}</div>
      </article>
      <article class="panel chart-panel">
        <h3>Day-of-Week Distribution</h3>
        <div class="bar-chart">${renderDayBars()}</div>
      </article>
    </div>
    <div class="analytics-grid">
      <article class="panel chart-panel">
        <h3>Active Personnel per Month</h3>
        <div class="bar-chart">${renderBarChart(monthPersonEntries)}</div>
      </article>
      <article class="panel">
        <h3>Duty Category Totals</h3>
        <div class="category-grid">${categories}</div>
      </article>
    </div>
    <div class="analytics-grid">
      <article class="panel">
        <h3>Top Total 24hr</h3>
        ${renderMiniRank(topPeople("total_24hr"), "total_24hr")}
      </article>
      <article class="panel">
        <h3>Top Weekend 24hr</h3>
        ${renderMiniRank(topPeople("total_weekend_24hr"), "total_weekend_24hr")}
      </article>
    </div>
  `;
}

// ── Tab: Personnel ────────────────────────────────────────────────────────────
function filteredSortedPeople(): AnalysisPerson[] {
  if (!analysis) return [];
  const q = analysisPersonSearch.toLowerCase();
  const list = analysis.people.filter((p) => !q || p.name.toLowerCase().includes(q));
  return list.sort((a, b) => {
    const av = Number(a[analysisPersonSort]);
    const bv = Number(b[analysisPersonSort]);
    if (bv !== av) return analysisPersonSortDir === "desc" ? bv - av : av - bv;
    return a.name.localeCompare(b.name);
  });
}

function renderSortTh(label: string, key: keyof AnalysisPerson): string {
  const active = analysisPersonSort === key;
  const dir = active ? (analysisPersonSortDir === "desc" ? " ↓" : " ↑") : "";
  const sortAttr = active ? `aria-sort="${analysisPersonSortDir === "desc" ? "descending" : "ascending"}"` : 'aria-sort="none"';
  return `<th><button class="table-sort${active ? " sort-active" : ""}" data-person-sort="${key}" ${sortAttr}>${label}${dir}</button></th>`;
}

function refreshPersonnelResultsInPlace(): boolean {
  const tbody = document.getElementById("analysis-person-tbody");
  const cards = document.getElementById("analysis-person-cards");
  const count = document.getElementById("analysis-person-count");
  if (!tbody || !cards || !count) return false;

  const people = filteredSortedPeople();
  const rows = people.map((person, index) => `
        <tr>
          <td>
            <button class="person-link" data-analysis-person="${escapeHtml(person.name)}">${index + 1}. ${escapeHtml(person.name)}</button>
            <small>${person.months_active.length} mo active${person.promotions.length ? ` · ${person.promotions.length} promo${person.promotions.length > 1 ? "s" : ""}` : ""}</small>
          </td>
          <td class="num">${person.total_24hr}</td>
          <td class="num">${person.total_weekend_24hr}</td>
          <td class="num">${person.total_weekday_24hr}</td>
          <td class="num">${person.main_24hr}</td>
          <td class="num">${person.cb_24hr}</td>
          <td class="num">${person.rc_24hr}</td>
          <td class="num">${person.schell}</td>
          <td class="num">${person.floating}</td>
          <td class="num">${person.caesar_b}</td>
          <td class="num">${person.cart}</td>
          <td class="num">${person.pac}</td>
          <td class="num">${person.shift}</td>
        </tr>
      `).join("");
  const cardHtml = people.map((person) => `
    <article class="data-card">
      <div class="data-card-row">
        <span class="data-card-label">Name</span>
        <span class="data-card-value"><button class="person-link" data-analysis-person="${escapeHtml(person.name)}">${escapeHtml(person.name)}</button></span>
      </div>
      <div class="data-card-row"><span class="data-card-label">Total 24hr</span><span class="data-card-value">${person.total_24hr}</span></div>
      <div class="data-card-row"><span class="data-card-label">Weekend</span><span class="data-card-value">${person.total_weekend_24hr}</span></div>
      <div class="data-card-row"><span class="data-card-label">Main</span><span class="data-card-value">${person.main_24hr}</span></div>
      <div class="data-card-row"><span class="data-card-label">CB</span><span class="data-card-value">${person.cb_24hr}</span></div>
      <div class="data-card-row"><span class="data-card-label">RC</span><span class="data-card-value">${person.rc_24hr}</span></div>
      <div class="data-card-row"><span class="data-card-label">Schell</span><span class="data-card-value">${person.schell}</span></div>
    </article>
  `).join("");

  tbody.innerHTML = rows || `<tr><td colspan="13" class="empty">No results.</td></tr>`;
  cards.innerHTML = cardHtml || `<p class="empty">No results.</p>`;
  count.textContent = `${people.length} of ${analysis?.people.length ?? 0} people`;
  return true;
}

function renderAnalysisPersonnelTab(): string {
  const people = filteredSortedPeople();
  const rows = people
    .map(
      (person, index) => `
        <tr>
          <td>
            <button class="person-link" data-analysis-person="${escapeHtml(person.name)}">${index + 1}. ${escapeHtml(person.name)}</button>
            <small>${person.months_active.length} mo active${person.promotions.length ? ` · ${person.promotions.length} promo${person.promotions.length > 1 ? "s" : ""}` : ""}</small>
          </td>
          <td class="num">${person.total_24hr}</td>
          <td class="num">${person.total_weekend_24hr}</td>
          <td class="num">${person.total_weekday_24hr}</td>
          <td class="num">${person.main_24hr}</td>
          <td class="num">${person.cb_24hr}</td>
          <td class="num">${person.rc_24hr}</td>
          <td class="num">${person.schell}</td>
          <td class="num">${person.floating}</td>
          <td class="num">${person.caesar_b}</td>
          <td class="num">${person.cart}</td>
          <td class="num">${person.pac}</td>
          <td class="num">${person.shift}</td>
        </tr>
      `,
    )
    .join("");

  const cards = people.map((person) => `
    <article class="data-card">
      <div class="data-card-row">
        <span class="data-card-label">Name</span>
        <span class="data-card-value"><button class="person-link" data-analysis-person="${escapeHtml(person.name)}">${escapeHtml(person.name)}</button></span>
      </div>
      <div class="data-card-row"><span class="data-card-label">Total 24hr</span><span class="data-card-value">${person.total_24hr}</span></div>
      <div class="data-card-row"><span class="data-card-label">Weekend</span><span class="data-card-value">${person.total_weekend_24hr}</span></div>
      <div class="data-card-row"><span class="data-card-label">Main</span><span class="data-card-value">${person.main_24hr}</span></div>
      <div class="data-card-row"><span class="data-card-label">CB</span><span class="data-card-value">${person.cb_24hr}</span></div>
      <div class="data-card-row"><span class="data-card-label">RC</span><span class="data-card-value">${person.rc_24hr}</span></div>
      <div class="data-card-row"><span class="data-card-label">Schell</span><span class="data-card-value">${person.schell}</span></div>
    </article>
  `).join("");

  return `
    <div class="analysis-toolbar">
      <label for="analysis-person-search" class="visually-hidden">Search personnel</label>
      <input id="analysis-person-search" class="analysis-search" placeholder="Search personnel…" value="${escapeHtml(analysisPersonSearch)}" aria-label="Search personnel" />
      <span id="analysis-person-count" class="analysis-count">${people.length} of ${analysis?.people.length ?? 0} people</span>
    </div>
    <section class="panel table-panel hide-mobile">
      <table class="analysis-table">
        <thead>
          <tr>
            <th>Name</th>
            ${renderSortTh("Total 24hr", "total_24hr")}
            ${renderSortTh("Weekend", "total_weekend_24hr")}
            ${renderSortTh("Weekday", "total_weekday_24hr")}
            ${renderSortTh("Main", "main_24hr")}
            ${renderSortTh("CB", "cb_24hr")}
            ${renderSortTh("RC", "rc_24hr")}
            ${renderSortTh("Schell", "schell")}
            ${renderSortTh("Float", "floating")}
            ${renderSortTh("Caesar B", "caesar_b")}
            ${renderSortTh("CART", "cart")}
            ${renderSortTh("PAC", "pac")}
            ${renderSortTh("Shifts", "shift")}
          </tr>
        </thead>
        <tbody id="analysis-person-tbody">${rows || `<tr><td colspan="13" class="empty">No results.</td></tr>`}</tbody>
      </table>
    </section>
    <section id="analysis-person-cards" class="card-list">
      ${cards || `<p class="empty">No results.</p>`}
    </section>
  `;
}

// ── Tab: Weekend ──────────────────────────────────────────────────────────────
function renderAnalysisWeekendTab(): string {
  if (!analysis) return "";
  const weekendPeople = [...analysis.people]
    .filter((p) => p.total_weekend_24hr > 0)
    .sort((a, b) => b.total_weekend_24hr - a.total_weekend_24hr);

  const topSat = [...weekendPeople]
    .sort((a, b) => (b.day_breakdown["Saturday"] ?? 0) - (a.day_breakdown["Saturday"] ?? 0))
    .slice(0, 10);
  const topSun = [...weekendPeople]
    .sort((a, b) => (b.day_breakdown["Sunday"] ?? 0) - (a.day_breakdown["Sunday"] ?? 0))
    .slice(0, 10);

  const weekendMonthEntries = analysis.months.map((month) => ({
    label: analysis!.month_labels[month],
    total: analysis!.month_stats[month].weekend_24hr,
  }));

  const rows = weekendPeople
    .map(
      (p, i) => `
        <tr>
          <td><button class="person-link" data-analysis-person="${escapeHtml(p.name)}">${i + 1}. ${escapeHtml(p.name)}</button></td>
          <td class="num">${p.total_weekend_24hr}</td>
          <td class="num">${p.day_breakdown["Saturday"] ?? 0}</td>
          <td class="num">${p.day_breakdown["Sunday"] ?? 0}</td>
          <td class="num">${p.total_24hr > 0 ? Math.round((p.total_weekend_24hr / p.total_24hr) * 100) : 0}%</td>
        </tr>
      `,
    )
    .join("");

  return `
    <div class="analytics-grid">
      <article class="panel chart-panel">
        <h3>Weekend 24hr Duties per Month</h3>
        <div class="bar-chart">${renderBarChart(weekendMonthEntries)}</div>
      </article>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <article class="panel">
          <h3>Top Saturday</h3>
          ${topSat
            .filter((p) => (p.day_breakdown["Saturday"] ?? 0) > 0)
            .map((p, i) => `<div class="rank-row"><button class="person-link" data-analysis-person="${escapeHtml(p.name)}">${i + 1}. ${escapeHtml(p.name)}</button><strong>${p.day_breakdown["Saturday"] ?? 0}</strong></div>`)
            .join("")}
        </article>
        <article class="panel">
          <h3>Top Sunday</h3>
          ${topSun
            .filter((p) => (p.day_breakdown["Sunday"] ?? 0) > 0)
            .map((p, i) => `<div class="rank-row"><button class="person-link" data-analysis-person="${escapeHtml(p.name)}">${i + 1}. ${escapeHtml(p.name)}</button><strong>${p.day_breakdown["Sunday"] ?? 0}</strong></div>`)
            .join("")}
        </article>
      </div>
    </div>
    <section class="panel table-panel" style="margin-top:16px">
      <table class="analysis-table">
        <thead>
          <tr>
            <th>Name</th>
            <th class="num">Total Weekend</th>
            <th class="num">Saturdays</th>
            <th class="num">Sundays</th>
            <th class="num">% of Total</th>
          </tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="5" class="empty">No weekend duties.</td></tr>`}</tbody>
      </table>
    </section>
  `;
}

// ── Tab: Duty Types ───────────────────────────────────────────────────────────
function renderAnalysisDutyTypesTab(): string {
  if (!analysis) return "";
  const dutyKeys: Array<[string, keyof AnalysisPerson]> = [
    ["Main 24hr", "main_24hr"],
    ["CB 24hr", "cb_24hr"],
    ["RC 24hr", "rc_24hr"],
    ["Schell", "schell"],
    ["Floating", "floating"],
    ["Caesar B", "caesar_b"],
  ];
  const rankSections = dutyKeys
    .map(([label, key]) => {
      const top = topPeople(key, 10);
      if (!top.length) return "";
      return `<article class="panel"><h3>${label}</h3>${renderMiniRank(top, key)}</article>`;
    })
    .join("");
  const dutyTypeRows = [...analysis.people]
    .filter((p) => p.total_24hr > 0)
    .sort((a, b) => b.total_24hr - a.total_24hr)
    .map(
      (p, i) => `
        <tr>
          <td><button class="person-link" data-analysis-person="${escapeHtml(p.name)}">${i + 1}. ${escapeHtml(p.name)}</button></td>
          <td class="num">${p.total_24hr}</td>
          <td class="num">${p.main_24hr}</td>
          <td class="num">${p.cb_24hr}</td>
          <td class="num">${p.rc_24hr}</td>
          <td class="num">${p.schell}</td>
          <td class="num">${p.floating}</td>
          <td class="num">${p.caesar_b}</td>
        </tr>
      `,
    )
    .join("");
  return `
    <div class="analysis-duty-grid">${rankSections}</div>
    <section class="panel table-panel" style="margin-top:16px">
      <table class="analysis-table">
        <thead>
          <tr>
            <th>Name</th>
            <th class="num">Total 24hr</th>
            <th class="num">Main</th>
            <th class="num">CB</th>
            <th class="num">RC</th>
            <th class="num">Schell</th>
            <th class="num">Floating</th>
            <th class="num">Caesar B</th>
          </tr>
        </thead>
        <tbody>${dutyTypeRows || `<tr><td colspan="8" class="empty">No data.</td></tr>`}</tbody>
      </table>
    </section>
  `;
}

// ── Tab: CART & Schell ────────────────────────────────────────────────────────
function renderAnalysisCartSchellTab(): string {
  if (!analysis) return "";
  const cartRows = [...analysis.people]
    .filter((p) => p.cart > 0)
    .sort((a, b) => b.cart - a.cart)
    .map(
      (p, i) => `
        <tr>
          <td><button class="person-link" data-analysis-person="${escapeHtml(p.name)}">${i + 1}. ${escapeHtml(p.name)}</button></td>
          <td class="num">${p.cart}</td>
          <td class="num">${p.schell}</td>
          <td class="num">${p.floating}</td>
        </tr>
      `,
    )
    .join("");
  const schellOnlyRows = [...analysis.people]
    .filter((p) => p.schell > 0 && p.cart === 0)
    .sort((a, b) => b.schell - a.schell)
    .slice(0, 15)
    .map(
      (p, i) => `
        <tr>
          <td><button class="person-link" data-analysis-person="${escapeHtml(p.name)}">${i + 1}. ${escapeHtml(p.name)}</button></td>
          <td class="num">${p.schell}</td>
          <td class="num">${p.floating}</td>
        </tr>
      `,
    )
    .join("");
  return `
    <div class="analytics-grid">
      <article class="panel">
        <h3>Top CART</h3>
        ${renderMiniRank(topPeople("cart", 12), "cart")}
      </article>
      <article class="panel">
        <h3>Top Schell</h3>
        ${renderMiniRank(topPeople("schell", 12), "schell")}
      </article>
    </div>
    <div class="analytics-grid" style="margin-top:16px">
      <section class="panel table-panel">
        <h3 style="padding:14px 16px 0">CART Performers</h3>
        <table class="analysis-table">
          <thead><tr><th>Name</th><th class="num">CART</th><th class="num">Schell</th><th class="num">Floating</th></tr></thead>
          <tbody>${cartRows || `<tr><td colspan="4" class="empty">No CART duties.</td></tr>`}</tbody>
        </table>
      </section>
      <section class="panel table-panel">
        <h3 style="padding:14px 16px 0">Schell Only (No CART)</h3>
        <table class="analysis-table">
          <thead><tr><th>Name</th><th class="num">Schell</th><th class="num">Floating</th></tr></thead>
          <tbody>${schellOnlyRows || `<tr><td colspan="3" class="empty">No data.</td></tr>`}</tbody>
        </table>
      </section>
    </div>
  `;
}

// ── Tab: 5th Call ─────────────────────────────────────────────────────────────
function renderAnalysisFifthCallTab(): string {
  if (!analysis) return "";
  const fifthPeople = [...analysis.people]
    .filter((p) => p.fifth_call > 0)
    .sort((a, b) => b.fifth_call - a.fifth_call);
  const monthTotals = analysis.months.map((month) => ({
    label: analysis!.month_labels[month],
    total: analysis!.people.reduce((sum, p) => sum + (p.fifth_call_monthly[month] ?? 0), 0),
  }));
  const rows = fifthPeople
    .map(
      (p, i) => `
        <tr>
          <td><button class="person-link" data-analysis-person="${escapeHtml(p.name)}">${i + 1}. ${escapeHtml(p.name)}</button></td>
          <td class="num">${p.fifth_call}</td>
          <td class="num">${p.fifth_call_weekend}</td>
          <td class="num">${p.fifth_call - p.fifth_call_weekend}</td>
          ${analysis!.months.map((m) => `<td class="num">${p.fifth_call_monthly[m] ?? 0}</td>`).join("")}
        </tr>
      `,
    )
    .join("");
  return `
    <div class="analytics-grid">
      <article class="panel chart-panel">
        <h3>5th Call Duties per Month</h3>
        <div class="bar-chart">${renderBarChart(monthTotals)}</div>
      </article>
      <article class="panel">
        <h3>Top 5th Call</h3>
        ${renderMiniRank(topPeople("fifth_call", 12), "fifth_call")}
      </article>
    </div>
    <section class="panel table-panel" style="margin-top:16px">
      <table class="analysis-table">
        <thead>
          <tr>
            <th>Name</th>
            <th class="num">Total</th>
            <th class="num">Weekend</th>
            <th class="num">Weekday</th>
            ${analysis.months.map((m) => `<th class="num">${analysis!.month_labels[m]}</th>`).join("")}
          </tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="${4 + analysis.months.length}" class="empty">No 5th call duties.</td></tr>`}</tbody>
      </table>
    </section>
  `;
}

// ── Tab: Shifts & PAC ─────────────────────────────────────────────────────────
function renderAnalysisShiftsPacTab(): string {
  if (!analysis) return "";
  const rows = [...analysis.people]
    .filter((p) => p.pac > 0 || p.shift > 0 || p.caesar_a > 0 || p.rc12hr > 0 || p.cb_co12hr > 0)
    .sort((a, b) => b.pac + b.shift - (a.pac + a.shift))
    .map(
      (p, i) => `
        <tr>
          <td><button class="person-link" data-analysis-person="${escapeHtml(p.name)}">${i + 1}. ${escapeHtml(p.name)}</button></td>
          <td class="num">${p.pac}</td>
          <td class="num">${p.shift}</td>
          <td class="num">${p.caesar_a}</td>
          <td class="num">${p.rc12hr}</td>
          <td class="num">${p.cb_co12hr}</td>
        </tr>
      `,
    )
    .join("");
  return `
    <div class="analytics-grid">
      <article class="panel">
        <h3>Top PAC Duties</h3>
        ${renderMiniRank(topPeople("pac", 12), "pac")}
      </article>
      <article class="panel">
        <h3>Top Shifts</h3>
        ${renderMiniRank(topPeople("shift", 12), "shift")}
      </article>
    </div>
    <section class="panel table-panel" style="margin-top:16px">
      <table class="analysis-table">
        <thead>
          <tr>
            <th>Name</th>
            <th class="num">PAC</th>
            <th class="num">Shifts</th>
            <th class="num">Caesar A</th>
            <th class="num">RC 12hr</th>
            <th class="num">CB Co 12hr</th>
          </tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="6" class="empty">No shift/PAC data.</td></tr>`}</tbody>
      </table>
    </section>
  `;
}

// ── Tab: Postings ─────────────────────────────────────────────────────────────
function renderAnalysisPostingsTab(): string {
  if (!analysis) return "";
  const buckets: Array<[string, "pain_months" | "sicu_months" | "drp_months" | "neuro_icu_months"]> = [
    ["Pain Call", "pain_months"],
    ["SICU / ICU", "sicu_months"],
    ["DRP", "drp_months"],
    ["Neuro ICU", "neuro_icu_months"],
  ];
  const sections = buckets
    .map(([label, key]) => {
      const people = [...analysis!.people]
        .filter((p) => p[key].length > 0)
        .sort((a, b) => b[key].length - a[key].length);
      if (!people.length) return "";
      const rows = people
        .map(
          (p, i) => `
            <tr>
              <td><button class="person-link" data-analysis-person="${escapeHtml(p.name)}">${i + 1}. ${escapeHtml(p.name)}</button></td>
              <td class="num">${p[key].length} mo</td>
              <td>${p[key].map((m) => analysis!.month_labels[m] ?? m).join(", ")}</td>
            </tr>
          `,
        )
        .join("");
      return `
        <section class="panel table-panel" style="margin-bottom:16px">
          <h3 style="padding:14px 16px 0">${label} <span class="posting-count">${people.length} people</span></h3>
          <table class="analysis-table">
            <thead><tr><th>Name</th><th class="num">Months</th><th>Period</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </section>
      `;
    })
    .join("");
  return sections || `<section class="panel"><p class="empty-state">No posting data available.</p></section>`;
}

// ── Tab: Promotions ───────────────────────────────────────────────────────────
function renderAnalysisPromotionsTab(): string {
  if (!analysis) return "";
  const promoted = analysis.people
    .filter((p) => p.promotions.length > 0)
    .sort((a, b) => b.promotions.length - a.promotions.length);

  const timelineMap: Record<string, Array<{ name: string; from: string; to: string }>> = {};
  promoted.forEach((p) => {
    p.promotions.forEach((promo) => {
      const label = analysis!.month_labels[promo.month] ?? promo.month;
      if (!timelineMap[label]) timelineMap[label] = [];
      timelineMap[label].push({ name: p.name, from: promo.from, to: promo.to });
    });
  });

  const timelineRows = analysis.months
    .flatMap((m) => {
      const label = analysis!.month_labels[m];
      return (timelineMap[label] ?? []).map(
        (c) => `
          <tr>
            <td>${label}</td>
            <td><button class="person-link" data-analysis-person="${escapeHtml(c.name)}">${escapeHtml(c.name)}</button></td>
            <td>${analysisCallLevelLabel(c.from)}</td>
            <td>→</td>
            <td><strong>${analysisCallLevelLabel(c.to)}</strong></td>
          </tr>
        `,
      );
    })
    .join("");

  const personRows = promoted
    .map(
      (p, i) => `
        <tr>
          <td><button class="person-link" data-analysis-person="${escapeHtml(p.name)}">${i + 1}. ${escapeHtml(p.name)}</button></td>
          <td>${p.promotions.map((pr) => `${analysis!.month_labels[pr.month] ?? pr.month}: ${analysisCallLevelLabel(pr.from)} → ${analysisCallLevelLabel(pr.to)}`).join("<br>")}</td>
        </tr>
      `,
    )
    .join("");

  return `
    <div class="analytics-grid">
      <section class="panel table-panel">
        <h3 style="padding:14px 16px 0">Promotion Timeline</h3>
        <table class="analysis-table">
          <thead><tr><th>Month</th><th>Person</th><th>From</th><th></th><th>To</th></tr></thead>
          <tbody>${timelineRows || `<tr><td colspan="5" class="empty">No promotions detected.</td></tr>`}</tbody>
        </table>
      </section>
      <section class="panel table-panel">
        <h3 style="padding:14px 16px 0">Promotions by Person</h3>
        <table class="analysis-table">
          <thead><tr><th>Name</th><th>Call Level Changes</th></tr></thead>
          <tbody>${personRows || `<tr><td colspan="2" class="empty">No promotions.</td></tr>`}</tbody>
        </table>
      </section>
    </div>
  `;
}

// ── Person Modal ──────────────────────────────────────────────────────────────
function renderAnalysisPersonModal(person: AnalysisPerson): string {
  if (!analysis) return "";
  const allLevels = Object.values(person.call_levels);
  const uniqueLevels = Array.from(new Set(allLevels)).map(analysisCallLevelLabel);
  const units = Array.from(new Set(Object.values(person.units).filter(Boolean)));
  const subtitle = [uniqueLevels.join(" → "), units.join(", ")].filter(Boolean).join(" · ");

  const metricCards = [
    ["Total 24hr", person.total_24hr],
    ["Weekend 24hr", person.total_weekend_24hr],
    ["Weekday 24hr", person.total_weekday_24hr],
    ["Main Calls", person.main_24hr],
    ["CB Calls", person.cb_24hr],
    ["RC Calls", person.rc_24hr],
    ["Schell", person.schell],
    ["Floating", person.floating],
    ["Caesar B", person.caesar_b],
    ["CART", person.cart],
    ["5th Call", person.fifth_call],
    ["5th Wknd", person.fifth_call_weekend],
    ["Caesar A", person.caesar_a],
    ["PAC", person.pac],
    ["Shifts", person.shift],
    ["RC 12hr", person.rc12hr],
  ]
    .map(([label, value]) => renderPersonMetric(String(label), Number(value)))
    .join("");

  const dayCards = analysis.days
    .map((day) => {
      const isWeekendDay = day === "Saturday" || day === "Sunday";
      return `
        <article class="person-day ${isWeekendDay ? "weekend-day" : ""}">
          <span>${day.slice(0, 3)}</span>
          <strong>${person.day_breakdown[day] ?? 0}</strong>
        </article>
      `;
    })
    .join("");

  const monthCards = analysis.months
    .map((month) => {
      const value = person.monthly_24hr[month] ?? 0;
      const callLevel = person.call_levels[month];
      return `
        <article class="person-month ${value ? "has-duty" : ""}">
          <span>${analysis!.month_labels[month]}</span>
          <strong>${value}</strong>
          ${callLevel ? `<em>${analysisCallLevelLabel(callLevel).replace(/\s+/g, "\u00a0")}</em>` : ""}
        </article>
      `;
    })
    .join("");

  const fifthCallSection =
    person.fifth_call > 0
      ? `
      <h4>5th Call by Month</h4>
      <div class="person-month-grid">
        ${analysis.months
          .map((month) => {
            const value = person.fifth_call_monthly[month] ?? 0;
            return `
              <article class="person-month ${value ? "has-duty fifth-call-month" : ""}">
                <span>${analysis!.month_labels[month]}</span>
                <strong>${value}</strong>
              </article>
            `;
          })
          .join("")}
      </div>
    `
      : "";

  const postingBadges = [
    ...person.pain_months.map((m) => `<span class="posting-badge pain-badge">Pain ${analysis!.month_labels[m] ?? m}</span>`),
    ...person.sicu_months.map((m) => `<span class="posting-badge sicu-badge">SICU ${analysis!.month_labels[m] ?? m}</span>`),
    ...person.drp_months.map((m) => `<span class="posting-badge drp-badge">DRP ${analysis!.month_labels[m] ?? m}</span>`),
    ...person.neuro_icu_months.map((m) => `<span class="posting-badge neuro-badge">Neuro ICU ${analysis!.month_labels[m] ?? m}</span>`),
  ].join("");

  const promotionSection = person.promotions.length
    ? `
      <h4>Call Level Changes</h4>
      <div class="promotion-list">
        ${person.promotions
          .map(
            (pr) => `
              <div class="promotion-row">
                <span>${analysis!.month_labels[pr.month] ?? pr.month}</span>
                <strong>${analysisCallLevelLabel(pr.from)} → ${analysisCallLevelLabel(pr.to)}</strong>
              </div>
            `,
          )
          .join("")}
      </div>
    `
    : "";

  return `
    <div class="modal-backdrop" id="analysis-person-modal">
      <section class="person-modal" role="dialog" aria-modal="true" aria-labelledby="person-modal-title">
        <header class="person-modal-header">
          <div>
            <h3 id="person-modal-title">${escapeHtml(person.name)}</h3>
            <p>${escapeHtml(subtitle || `${person.months_active.length} active months`)}</p>
          </div>
          <button class="modal-close" data-close-person-modal aria-label="Close">×</button>
        </header>
        <div class="person-modal-body">
          <div class="person-metric-grid">${metricCards}</div>
          ${postingBadges ? `<h4>Special Postings</h4><div class="posting-badges">${postingBadges}</div>` : ""}
          <h4>24hr Duties by Day of Week</h4>
          <div class="person-day-grid">${dayCards}</div>
          <h4>Monthly 24hr Duty Count</h4>
          <div class="person-month-grid">${monthCards}</div>
          ${fifthCallSection}
          ${promotionSection}
        </div>
      </section>
    </div>
  `;
}

function openAnalysisPersonModal(name: string) {
  if (!analysis) return;
  const existing = document.querySelector("#analysis-person-modal");
  existing?.remove();
  const person = analysis.people.find((item) => item.name === name);
  if (!person) return;
  document.body.insertAdjacentHTML("beforeend", renderAnalysisPersonModal(person));
}

function closeAnalysisPersonModal() {
  document.querySelector("#analysis-person-modal")?.remove();
}

// ── Preflight & Manual Review ─────────────────────────────────────────────────
function renderAnalysisPreflight(preflight: AnalysisPreflight): string {
  const issues = preflight.issues.map((issue) => `<li>${issue}</li>`).join("");
  const duplicateExamples = preflight.examples.duplicate_groups
    .map((group) => `${group.key}: ${group.names.join(", ")}`)
    .slice(0, 4)
    .join("<br>");
  return `
    <details class="panel quality-panel ${preflight.safe_to_publish ? "quality-ok" : "quality-warning"}">
      <summary>
        <span>Data Quality: ${preflight.safe_to_publish ? "✓ Ready" : "⚠ Needs Review"}</span>
        <span class="quality-status-badge">${preflight.included_periods.length} periods</span>
      </summary>
      <div class="quality-grid" style="margin-top:12px">
        <span><strong>${preflight.counts.invalid_members}</strong> invalid names</span>
        <span><strong>${preflight.counts.duplicate_groups}</strong> duplicate groups</span>
        <span><strong>${preflight.counts.unresolved_duty_mappings}</strong> unresolved mappings</span>
        <span><strong>${preflight.counts.unknown_duty_types}</strong> unknown duties</span>
      </div>
      ${issues ? `<ul class="quality-list">${issues}</ul>` : ""}
      ${duplicateExamples ? `<p class="quality-examples"><strong>Duplicate examples:</strong><br>${duplicateExamples}</p>` : ""}
      <p class="quality-examples"><strong>Included periods:</strong> ${preflight.included_periods.join(", ") || "None"}</p>
    </details>
  `;
}

function renderManualReview(review: AnalysisManualReview): string {
  const topRows = review.top_skipped_names
    .slice(0, 25)
    .map(
      (row) => `
        <tr>
          <td><strong>${row.cleaned_person_name}</strong><small>${row.reason}</small></td>
          <td>${row.status}</td>
          <td class="num">${row.count}</td>
        </tr>
      `,
    )
    .join("");
  const unmappedRows = review.unmapped_duty_rows
    .slice(0, 12)
    .map(
      (row) => `
        <tr>
          <td>${row.source_file ?? ""}</td>
          <td>${row.message ?? ""}</td>
        </tr>
      `,
    )
    .join("");
  const comparisonRows = review.reference_comparison
    .slice(0, 17)
    .map(
      (row) => `
        <tr>
          <td>${row.period ?? ""}</td>
          <td class="num">${row.dry_run_24hr ?? ""}</td>
          <td class="num">${row.reference_24hr ?? ""}</td>
          <td class="num">${row.delta_24hr ?? ""}</td>
        </tr>
      `,
    )
    .join("");
  return `
    <details class="panel manual-review-panel">
      <summary>
        <span>Manual Review</span>
        <strong>${review.summary.unique_skipped_names} unresolved names</strong>
      </summary>
      <div class="review-metrics">
        <span><strong>${review.summary.skipped_names}</strong> skipped rows</span>
        <span><strong>${review.summary.unmapped_duty_warnings}</strong> unmapped duty labels</span>
        <span><strong>${review.summary.parser_warnings}</strong> parser warnings</span>
        <span><strong>${review.summary.main_24hr_gap}</strong> vs reference main 24hr</span>
      </div>
      <section class="table-panel review-comparison">
        <h3>Reference Comparison</h3>
        <table>
          <thead><tr><th>Month</th><th>Current</th><th>Reference</th><th>Delta</th></tr></thead>
          <tbody>${comparisonRows || `<tr><td colspan="4" class="empty">No reference comparison file found.</td></tr>`}</tbody>
        </table>
      </section>
      <div class="analytics-grid">
        <section class="table-panel">
          <h3>Top Unresolved Names</h3>
          <table>
            <thead><tr><th>Name</th><th>Status</th><th>Rows</th></tr></thead>
            <tbody>${topRows || `<tr><td colspan="3" class="empty">No unresolved names.</td></tr>`}</tbody>
          </table>
        </section>
        <section class="table-panel">
          <h3>Unmapped Duty Labels</h3>
          <table>
            <thead><tr><th>File</th><th>Issue</th></tr></thead>
            <tbody>${unmappedRows || `<tr><td colspan="2" class="empty">No unmapped duty labels.</td></tr>`}</tbody>
          </table>
        </section>
      </div>
    </details>
  `;
}

// ── Tab bar + main renderAnalysis ─────────────────────────────────────────────
const ANALYSIS_TABS = [
  { id: "overview", label: "Overview" },
  { id: "personnel", label: "Personnel" },
  { id: "weekend", label: "Weekend" },
  { id: "duty-types", label: "Duty Types" },
  { id: "cart-schell", label: "CART & Schell" },
  { id: "fifth-call", label: "5th Call" },
  { id: "shifts-pac", label: "Shifts & PAC" },
  { id: "postings", label: "Postings" },
  { id: "promotions", label: "Promotions" },
] as const;

function renderAnalysisTabContent(): string {
  switch (analysisTab) {
    case "personnel":
      return renderAnalysisPersonnelTab();
    case "weekend":
      return renderAnalysisWeekendTab();
    case "duty-types":
      return renderAnalysisDutyTypesTab();
    case "cart-schell":
      return renderAnalysisCartSchellTab();
    case "fifth-call":
      return renderAnalysisFifthCallTab();
    case "shifts-pac":
      return renderAnalysisShiftsPacTab();
    case "postings":
      return renderAnalysisPostingsTab();
    case "promotions":
      return renderAnalysisPromotionsTab();
    default:
      return renderAnalysisOverviewTab();
  }
}

function refreshAnalysisTabContent() {
  const body = document.querySelector<HTMLDivElement>("#analysis-tab-body");
  if (!body) return;
  body.innerHTML = renderAnalysisTabContent();
  document.querySelectorAll<HTMLButtonElement>("[data-analysis-tab]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.analysisTab === analysisTab);
  });
}

async function renderAnalysis() {
  setHeader("Analysis", "CMC Anaesthesia Duty Analysis · Jan 2025 – May 2026");
  if (!viewRoot) return;
  viewRoot.innerHTML = `<section class="panel"><h3>Loading analysis…</h3></section>`;
  analysis = await getAnalysisDashboard();

  const tabButtons = ANALYSIS_TABS.map(
    (tab) =>
      `<button class="analysis-tab-btn${analysisTab === tab.id ? " active" : ""}" data-analysis-tab="${tab.id}">${tab.label}</button>`,
  ).join("");

  viewRoot.innerHTML = `
    <nav class="analysis-tabs">${tabButtons}</nav>
    <div id="analysis-tab-body">${renderAnalysisTabContent()}</div>
  `;
}

function renderMappingFilters() {
  const filters = ["all", ...options.mapping_types]
    .map(
      (type) => `
        <button class="${activeMappingType === type ? "selected" : ""}" data-filter="${type}">
          ${mappingTypeLabel(type)}
        </button>
      `,
    )
    .join("");

  return `<div class="segmented">${filters}</div>`;
}

function renderDutyTarget(mapping: AdminMapping): string {
  const choices = [
    `<option value="">Needs review</option>`,
    ...options.duty_types.map(
      (dutyType) => `
        <option value="${dutyType.key}" ${mapping.target_key === dutyType.key ? "selected" : ""}>
          ${dutyType.label}
        </option>
      `,
    ),
  ];
  return `<select data-field="target_key" data-id="${mapping.id}">${choices.join("")}</select>`;
}

function renderTextTarget(mapping: AdminMapping): string {
  return `
    <input
      data-field="target_key"
      data-id="${mapping.id}"
      value="${mapping.target_key ?? ""}"
      placeholder="Target key"
    />
  `;
}

function renderMappings() {
  setHeader("Mappings", "Admin mapping control");
  if (!viewRoot) return;

  const filtered = filteredMappings();

  const rows = filtered
    .map(
      (mapping) => `
        <tr data-mapping-row="${mapping.id}">
          <td>
            <strong>${mapping.source_label}</strong>
            <small>${mappingTypeLabel(mapping.mapping_type)}</small>
          </td>
          <td>
            ${mapping.mapping_type === "duty_label" ? renderDutyTarget(mapping) : renderTextTarget(mapping)}
          </td>
          <td>
            <input
              data-field="target_label"
              data-id="${mapping.id}"
              value="${mapping.target_label ?? targetLabelForKey(mapping.target_key) ?? ""}"
              placeholder="Display label"
              aria-label="Target label for ${mapping.source_label}"
            />
          </td>
          <td>
            <select data-field="status" data-id="${mapping.id}" aria-label="Status for ${mapping.source_label}">
              <option value="needs_review" ${mapping.status === "needs_review" ? "selected" : ""}>Needs review</option>
              <option value="suggested" ${mapping.status === "suggested" ? "selected" : ""}>Suggested</option>
              <option value="reviewed" ${mapping.status === "reviewed" ? "selected" : ""}>Reviewed</option>
            </select>
          </td>
          <td>
            <input data-field="notes" data-id="${mapping.id}" value="${mapping.notes ?? ""}" placeholder="Notes" aria-label="Notes for ${mapping.source_label}" />
          </td>
          <td>
            <button class="icon-button" data-save="${mapping.id}" title="Save mapping">Save</button>
          </td>
        </tr>
      `,
    )
    .join("");

  const cards = filtered.map((mapping) => `
    <article class="data-card">
      <div class="data-card-row">
        <span class="data-card-label">Source</span>
        <span class="data-card-value">${mapping.source_label}</span>
      </div>
      <div class="data-card-row">
        <span class="data-card-label">Type</span>
        <span class="data-card-value">${mappingTypeLabel(mapping.mapping_type)}</span>
      </div>
      <div class="data-card-row">
        <span class="data-card-label">Target</span>
        <span class="data-card-value">${mapping.target_label ?? targetLabelForKey(mapping.target_key) ?? "—"}</span>
      </div>
      <div class="data-card-row">
        <span class="data-card-label">Status</span>
        <span class="data-card-value">${mapping.status}</span>
      </div>
      <div class="data-card-row">
        <button class="icon-button" data-save="${mapping.id}">Save</button>
      </div>
    </article>
  `).join("");

  viewRoot.innerHTML = `
    <section class="toolbar">
      ${renderMappingFilters()}
      <label for="mapping-search" class="visually-hidden">Search mappings</label>
      <input id="mapping-search" placeholder="Search source label…" value="${mappingSearch}" style="min-width:200px;" aria-label="Search mappings" />
      <button class="primary" id="scan-mappings">Scan Historical Files</button>
    </section>
    <section class="panel table-panel hide-mobile">
      <table>
        <thead>
          <tr>
            <th>Source Label</th>
            <th>Target Key</th>
            <th>Target Label</th>
            <th>Status</th>
            <th>Notes</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${
            rows ||
            `<tr><td colspan="6" class="empty">No mappings yet. Scan historical files first.</td></tr>`
          }
        </tbody>
      </table>
    </section>
    <section class="card-list">
      ${cards || `<p class="empty">No mappings found.</p>`}
    </section>
  `;
}

async function renderImports() {
  setHeader("Imports", "Historical data import");
  if (!viewRoot) return;

  const status = await getHistoricalImportStatus();
  viewRoot.innerHTML = `
    <section class="summary-grid">
      <article class="metric">
        <span>${status.people}</span>
        <p>People</p>
      </article>
      <article class="metric">
        <span>${status.duty_assignments}</span>
        <p>Duty assignments</p>
      </article>
      <article class="metric">
        <span>${status.postings}</span>
        <p>Unit postings</p>
      </article>
    </section>
    <section class="summary-grid">
      <article class="metric">
        <span>${status.duty_slots}</span>
        <p>Duty slots</p>
      </article>
      <article class="metric">
        <span>${status.import_batches}</span>
        <p>Import batches</p>
      </article>
      <article class="metric">
        <span>${status.import_warnings}</span>
        <p>Import warnings</p>
      </article>
    </section>
    <section class="panel action-panel">
      <div>
        <h3>Historical Import</h3>
        <p>Uses the current admin mappings to normalize rota and unitwise Excel files into the database.</p>
      </div>
      <button class="primary" id="run-historical-import">Run Historical Import</button>
    </section>
    <section class="panel wide">
      <h3>Last Import Result</h3>
      <pre id="import-result">No import has been run from this screen yet.</pre>
    </section>
  `;
}

function latestDesignation(member: DepartmentMember) {
  return member.designations[member.designations.length - 1] ?? null;
}

function memberPosition(member: DepartmentMember): string {
  return latestDesignation(member)?.designation ?? "Missing position";
}

function memberCallLevel(member: DepartmentMember): string {
  return member.call_level || "Unassigned";
}

function callLevelLabel(value: string | null): string {
  return {
    "": "Unassigned",
    Unassigned: "Unassigned",
    "1ST_CALL": "1st Call",
    "1ST_CALL_PG_2025": "1st Call",
    "2ND_CALL": "2nd Call",
    "2ND_CALL_SR": "2nd Call",
    "2ND_CALL_PG_2022": "2nd Call",
    "2ND_CALL_PG_2023": "2nd Call",
    "2ND_CALL_PG_2024": "2nd Call",
    "3RD_CALL": "3rd Call",
    "3RD_CALL_SR_AP": "3rd Call",
    "3RD_CALL_PG_2023": "3rd Call",
    "DM_PDF": "3rd Call",
    "4TH_CALL": "4th Call",
    "5TH_CALL": "5th Call",
  }[value ?? ""] ?? value ?? "Unassigned";
}

function normalizeCallLevel(value: string | null): string | null {
  if (!value) return null;
  if (value.includes("1ST_CALL")) return "1ST_CALL";
  if (value.includes("2ND_CALL")) return "2ND_CALL";
  if (value.includes("3RD_CALL") || value === "DM_PDF") return "3RD_CALL";
  if (value.includes("4TH_CALL")) return "4TH_CALL";
  if (value.includes("5TH_CALL")) return "5TH_CALL";
  return value;
}

function filteredMembers(): DepartmentMember[] {
  const search = memberSearch.trim().toLocaleLowerCase();
  const direction = memberSortDirection === "asc" ? 1 : -1;
  return [...members]
    .filter((member) => {
      const position = memberPosition(member);
      const callLevel = callLevelLabel(normalizeCallLevel(member.call_level));
      const haystack = `${member.canonical_name} ${position} ${callLevel} ${member.active_status}`.toLocaleLowerCase();
      const matchesSearch = !search || haystack.includes(search);
      const matchesPosition = memberPositionFilter === "all" || position === memberPositionFilter;
      const matchesCallLevel = memberCallLevelFilter === "all" || callLevel === memberCallLevelFilter;
      return matchesSearch && matchesPosition && matchesCallLevel;
    })
    .sort((a, b) => {
      let result = 0;
      if (memberSort === "position") {
        result = memberPosition(a).localeCompare(memberPosition(b));
      } else if (memberSort === "call_level") {
        result = callLevelLabel(normalizeCallLevel(a.call_level)).localeCompare(callLevelLabel(normalizeCallLevel(b.call_level)));
      } else if (memberSort === "status") {
        result = a.active_status.localeCompare(b.active_status);
      } else {
        result = a.canonical_name.localeCompare(b.canonical_name);
      }
      return (result || a.canonical_name.localeCompare(b.canonical_name)) * direction;
    });
}

function sortIndicator(key: string): string {
  if (memberSort !== key) return "";
  return memberSortDirection === "asc" ? " ↑" : " ↓";
}

function ariaSort(key: string): string {
  if (memberSort !== key) return 'aria-sort="none"';
  return `aria-sort="${memberSortDirection === "asc" ? "ascending" : "descending"}"`;
}

function renderMemberRows(rows: DepartmentMember[]): string {
  return rows
    .map((member) => {
      const statusClass = member.active_status === "active" ? "active" : "inactive";
      const aliases = member.aliases?.length ? `<small>Also: ${member.aliases.join(", ")}</small>` : "";
      return `
        <tr>
          <td class="member-name-cell">
            <strong>${member.canonical_name}</strong>
            ${aliases}
          </td>
          <td><span class="status-dot ${statusClass}">${member.active_status}</span></td>
          <td>
            <select class="call-level-select" data-call-level="${member.id}" id="call-level-${member.id}" aria-label="Call level for ${member.canonical_name}">
              ${renderCallLevelChoices(member.call_level)}
            </select>
          </td>
        </tr>
      `;
    })
    .join("");
}

function renderPositionOptions(): string {
  const positions = Array.from(new Set(members.map(memberPosition))).sort();
  return [
    `<option value="all">All positions</option>`,
    ...positions.map((position) => `<option value="${position}" ${memberPositionFilter === position ? "selected" : ""}>${position}</option>`),
  ].join("");
}

function renderCallLevelChoices(selected: string | null): string {
  const normalized = normalizeCallLevel(selected);
  const levels = [
    ["", "Unassigned"],
    ["1ST_CALL", "1st Call"],
    ["2ND_CALL", "2nd Call"],
    ["3RD_CALL", "3rd Call"],
    ["4TH_CALL", "4th Call"],
    ["5TH_CALL", "5th Call"],
  ];
  return levels
    .map(([value, label]) => `<option value="${value}" ${normalized === (value || null) ? "selected" : ""}>${label}</option>`)
    .join("");
}

function callLevelOptions(): string[] {
  return Array.from(new Set(members.map((member) => callLevelLabel(normalizeCallLevel(member.call_level))))).sort();
}

function renderCallLevelFilterOptions(): string {
  return [
    `<option value="all">All call levels</option>`,
    ...callLevelOptions().map((level) => `<option value="${level}" ${memberCallLevelFilter === level ? "selected" : ""}>${level}</option>`),
  ].join("");
}

function renderPositionBreakdown(): string {
  if (!memberAudit) return "";
  return Object.entries(memberAudit.positions)
    .sort((a, b) => b[1] - a[1])
    .map(([position, count]) => `<div class="category-pill"><span>${position}</span><strong>${count}</strong></div>`)
    .join("");
}

function updateMemberResults() {
  saveFocus();
  const rows = filteredMembers();
  const visibleCount = document.querySelector<HTMLSpanElement>("#visible-member-count");
  const tbody = document.querySelector<HTMLTableSectionElement>("#member-table-body");
  if (visibleCount) visibleCount.textContent = String(rows.length);
  if (tbody) {
    tbody.innerHTML = renderMemberRows(rows) || `<tr><td colspan="3" class="empty">No members found.</td></tr>`;
  }
  updateMemberCards(rows);
  restoreFocus();
}

function renderMemberCards(rows: DepartmentMember[]): string {
  return rows
    .map(
      (member) => {
        const aliases = member.aliases?.length ? `<small>Also: ${member.aliases.join(", ")}</small>` : "";
        const statusClass = member.active_status === "active" ? "active" : "inactive";
        return `
        <article class="member-card">
          <div>
            <strong>${member.canonical_name}</strong>
            <small><span class="status-dot ${statusClass}">${member.active_status}</span></small>
            ${aliases}
          </div>
          <select class="call-level-select" data-call-level="${member.id}" aria-label="Call level for ${member.canonical_name}">
            ${renderCallLevelChoices(member.call_level)}
          </select>
        </article>
      `;
      },
    )
    .join("");
}

function updateMemberCards(rows: DepartmentMember[]) {
  const cards = document.querySelector<HTMLDivElement>("#member-card-list");
  if (cards) {
    cards.innerHTML = renderMemberCards(rows) || `<p class="empty">No members found.</p>`;
  }
}

function renderDedupeRows(): string {
  return dedupeCandidates
    .map((candidate, index) => {
      const options = candidate.people
        .map((person) => `<option value="${person.id}">${person.canonical_name}</option>`)
        .join("");
      return `
        <tr>
          <td><strong>${candidate.normalized_name}</strong></td>
          <td>${candidate.people.map((person) => person.canonical_name).join("<br>")}</td>
          <td><select data-dedupe-target="${index}" aria-label="Target for ${candidate.normalized_name}">${options}</select></td>
          <td><button class="icon-button" data-merge-candidate="${index}">Merge</button></td>
        </tr>
      `;
    })
    .join("");
}

function renderDedupeCards(): string {
  return dedupeCandidates
    .map((candidate, index) => {
      const options = candidate.people
        .map((person) => `<option value="${person.id}">${person.canonical_name}</option>`)
        .join("");
      return `
        <article class="data-card">
          <div class="data-card-row"><span class="data-card-label">Key</span><span class="data-card-value">${candidate.normalized_name}</span></div>
          <div class="data-card-row"><span class="data-card-label">People</span><span class="data-card-value">${candidate.people.map((p) => p.canonical_name).join(", ")}</span></div>
          <div class="data-card-row"><span class="data-card-label">Target</span>
            <select data-dedupe-target="${index}" aria-label="Target for ${candidate.normalized_name}">${options}</select>
          </div>
          <div class="data-card-row"><button class="icon-button" data-merge-candidate="${index}">Merge</button></div>
        </article>
      `;
    })
    .join("");
}

async function renderMembers() {
  setHeader("Members", "Department members and deduplication");
  if (!viewRoot) return;
  viewRoot.innerHTML = `<section class="panel"><h3>Loading members...</h3></section>`;
  [members, dedupeCandidates, invalidMembers, memberAudit] = await Promise.all([
    getMembers(),
    getDedupeCandidates(),
    getInvalidMembers(),
    getMemberAudit(),
  ]);
  renderMembersView();
}

function renderMembersView() {
  if (!viewRoot || !memberAudit) return;
  const rows = filteredMembers();

  viewRoot.innerHTML = `
    <section class="roster-command ${memberAudit.status === "clean" ? "quality-ok" : "quality-warning"}">
      <div class="roster-command-header">
        <div>
          <h3>Roster Audit: ${memberAudit.status === "clean" ? "Clean" : "Needs Review"}</h3>
          <p>${memberAudit.status === "clean" ? "One clean row per member. No invalid names or duplicate groups." : "Review the audit counts before using this roster for rota logic."}</p>
        </div>
        <span class="audit-badge">${memberAudit.status === "clean" ? "Clean" : "Review"}</span>
      </div>
      <div class="audit-chip-row">
        <span><strong id="visible-member-count">${rows.length}</strong> visible</span>
        <span><strong>${memberAudit.total_members}</strong> members</span>
        <span><strong>${memberAudit.invalid_members}</strong> invalid</span>
        <span><strong>${memberAudit.duplicate_groups}</strong> duplicates</span>
        <span><strong>${memberAudit.missing_call_levels}</strong> unassigned calls</span>
      </div>
      <div class="member-control-bar">
        <div class="member-filter-row">
          <label for="member-search" class="visually-hidden">Search members</label>
          <input id="member-search" placeholder="Search members or positions" value="${memberSearch}" aria-label="Search members or positions" />
          <label for="member-position-filter" class="visually-hidden">Filter by position</label>
          <select id="member-position-filter" aria-label="Filter by position">${renderPositionOptions()}</select>
          <label for="member-call-filter" class="visually-hidden">Filter by call level</label>
          <select id="member-call-filter" aria-label="Filter by call level">${renderCallLevelFilterOptions()}</select>
          <button class="icon-button" id="clear-member-filters">Clear</button>
        </div>
        <details class="member-tools">
          <summary>Admin tools</summary>
          <div class="member-tool-row">
            <form class="inline-form" id="create-member-form" style="display:contents;">
              <label for="new-member-name" class="visually-hidden">New member name</label>
              <input id="new-member-name" placeholder="New member name" aria-label="New member name" />
              <button class="primary" type="submit" id="create-member">Create Member</button>
            </form>
            <button class="icon-button" id="cleanup-members">Clean Invalid Names</button>
            <button class="icon-button" id="auto-merge-duplicates">Auto-Merge Exact Duplicates</button>
            <button class="icon-button" id="prefill-call-levels">Prefill Call Levels</button>
            <button class="icon-button" id="reconcile-roster">Reconcile Trusted Roster</button>
          </div>
        </details>
      </div>
    </section>
    <details class="panel disclosure-panel">
      <summary>Designation / Position Stats</summary>
      <div class="category-grid">${renderPositionBreakdown()}</div>
    </details>
    <section class="panel table-panel">
      <table class="member-table">
        <colgroup>
          <col class="member-col-name" />
          <col class="member-col-status" />
          <col class="member-col-call" />
        </colgroup>
        <thead>
          <tr>
            <th><button class="table-sort" data-member-sort="name" ${ariaSort("name")}>Member${sortIndicator("name")}</button></th>
            <th><button class="table-sort" data-member-sort="status" ${ariaSort("status")}>Status${sortIndicator("status")}</button></th>
            <th><button class="table-sort" data-member-sort="call_level" ${ariaSort("call_level")}>Call Level${sortIndicator("call_level")}</button></th>
          </tr>
        </thead>
        <tbody id="member-table-body">${renderMemberRows(rows) || `<tr><td colspan="3" class="empty">No members found.</td></tr>`}</tbody>
      </table>
    </section>
    <section class="member-card-list" id="member-card-list">
      ${renderMemberCards(rows)}
    </section>
    <section class="panel table-panel hide-mobile">
      <table class="dedupe-table">
        <thead>
          <tr><th>Candidate Key</th><th>Possible Duplicates</th><th>Canonical Target</th><th></th></tr>
        </thead>
        <tbody>${renderDedupeRows() || `<tr><td colspan="4" class="empty">No duplicate candidates found.</td></tr>`}</tbody>
      </table>
    </section>
    <section class="card-list">
      ${renderDedupeCards() || `<p class="empty">No duplicate candidates found.</p>`}
    </section>
  `;
}

async function renderAccounts() {
  setHeader("Accounts", "Rota team login accounts");
  if (!viewRoot) return;
  if (!currentUser || !["computer_admin", "superadmin"].includes(currentUser.role)) {
    viewRoot.innerHTML = `<section class="panel"><h3>Access denied</h3><p>Computer admin privilege is required.</p></section>`;
    return;
  }
  try {
    accounts = await listUserAccounts();
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Failed to load accounts", "error");
    viewRoot.innerHTML = `<section class="panel"><h3>Error</h3><p>Unable to load accounts.</p></section>`;
    return;
  }
  const accountCards = accounts.map((account) => `
    <article class="data-card">
      <div class="data-card-row"><span class="data-card-label">Username</span><span class="data-card-value">${account.username}</span></div>
      <div class="data-card-row"><span class="data-card-label">Name</span><span class="data-card-value">${account.display_name}</span></div>
      <div class="data-card-row"><span class="data-card-label">Role</span><span class="data-card-value">${account.role_label}</span></div>
      <div class="data-card-row"><span class="data-card-label">Status</span><span class="data-card-value">${account.active_status}</span></div>
    </article>
  `).join("");
  viewRoot.innerHTML = `
    <section class="panel action-panel">
      <div>
        <h3>Create Account</h3>
        <p>Roles: rota board member, computer admin, or superadmin.</p>
      </div>
      <form class="inline-form" id="account-form">
        <label for="account-username" class="visually-hidden">Username</label>
        <input id="account-username" placeholder="Username" aria-label="Username" />
        <label for="account-display" class="visually-hidden">Display name</label>
        <input id="account-display" placeholder="Display name" aria-label="Display name" />
        <label for="account-password" class="visually-hidden">Password</label>
        <input id="account-password" type="password" placeholder="Password" aria-label="Password" />
        <label for="account-role" class="visually-hidden">Role</label>
        <select id="account-role" aria-label="Role">
          <option value="rota_board_member">Rota board member</option>
          <option value="computer_admin">Computer admin</option>
          <option value="superadmin">Superadmin</option>
        </select>
        <button class="primary" type="submit" id="create-account">Create</button>
      </form>
    </section>
    <section class="panel table-panel hide-mobile">
      <table class="accounts-table">
        <thead><tr><th>Username</th><th>Name</th><th>Role</th><th>Status</th></tr></thead>
        <tbody>
          ${accounts.map((account) => `<tr><td>${account.username}</td><td>${account.display_name}</td><td>${account.role_label}</td><td>${account.active_status}</td></tr>`).join("") || `<tr><td colspan="4" class="empty">No accounts found.</td></tr>`}
        </tbody>
      </table>
    </section>
    <section class="card-list">
      ${accountCards || `<p class="empty">No accounts found.</p>`}
    </section>
  `;
}

async function renderDiagnostics() {
  setHeader("Diagnostics", "Software diagnostics");
  if (!viewRoot) return;
  if (!currentUser || !["computer_admin", "superadmin"].includes(currentUser.role)) {
    viewRoot.innerHTML = `<section class="panel"><h3>Access denied</h3><p>Computer admin privilege is required.</p></section>`;
    return;
  }
  try {
    const diagnostics: DiagnosticsSummary = await getDiagnosticsSummary();
    viewRoot.innerHTML = `
      <section class="summary-grid">
        <article class="metric"><span>${diagnostics.database_counts.import_warnings ?? 0}</span><p>Import warnings</p></article>
        <article class="metric"><span>${diagnostics.invalid_member_names}</span><p>Invalid member names</p></article>
        <article class="metric"><span>${diagnostics.database_counts.user_accounts ?? 0}</span><p>Login accounts</p></article>
      </section>
      <section class="panel wide">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <h3 style="margin:0;">Diagnostics Payload</h3>
          <button class="icon-button" id="copy-diagnostics">Copy JSON</button>
        </div>
        <pre id="diagnostics-pre">${JSON.stringify(diagnostics, null, 2)}</pre>
      </section>
    `;
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Failed to load diagnostics", "error");
    viewRoot.innerHTML = `<section class="panel"><h3>Error</h3><p>Unable to load diagnostics.</p></section>`;
  }
}

async function loadMappings() {
  [options, mappings] = await Promise.all([getMappingOptions(), getMappings()]);
}

function bindNavigation() {
  document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      document
        .querySelectorAll<HTMLButtonElement>("[data-view]")
        .forEach((item) => {
          item.classList.remove("active");
          item.removeAttribute("aria-current");
        });
      button.classList.add("active");
      button.setAttribute("aria-current", "page");
      closeSidebarOnMobile();
      if (button.dataset.view === "mappings") {
        renderMappings();
      } else if (button.dataset.view === "imports") {
        void renderImports();
      } else if (button.dataset.view === "analysis") {
        void renderAnalysis();
      } else if (button.dataset.view === "members") {
        void renderMembers();
      } else if (button.dataset.view === "accounts") {
        void renderAccounts();
      } else if (button.dataset.view === "diagnostics") {
        void renderDiagnostics();
      } else {
        renderOverview();
      }
    });
  });
}

function bindViewEvents() {
  viewRoot?.addEventListener("submit", async (event) => {
    const form = event.target as HTMLFormElement;
    if (form.id === "account-form") {
      event.preventDefault();
      const btn = form.querySelector<HTMLButtonElement>("#create-account");
      const username = form.querySelector<HTMLInputElement>("#account-username")?.value ?? "";
      const display_name = form.querySelector<HTMLInputElement>("#account-display")?.value ?? "";
      const password = form.querySelector<HTMLInputElement>("#account-password")?.value ?? "";
      const role = form.querySelector<HTMLSelectElement>("#account-role")?.value ?? "rota_board_member";
      if (!username || !password) {
        showToast("Username and password are required", "warning");
        return;
      }
      setButtonLoading(btn, true, "Create");
      try {
        await createUserAccount({ username, display_name, password, role });
        showToast("Account created", "success");
        await renderAccounts();
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Failed to create account", "error");
        resetButton(btn);
      }
      return;
    }
    if (form.id === "create-member-form") {
      event.preventDefault();
      const input = form.querySelector<HTMLInputElement>("#new-member-name");
      const name = input?.value.trim() ?? "";
      if (!name) {
        showToast("Please enter a member name", "warning");
        return;
      }
      try {
        await createMember(name);
        showToast(`Member "${name}" created`, "success");
        await renderMembers();
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Failed to create member", "error");
      }
      return;
    }
  });

  viewRoot?.addEventListener("click", async (event) => {
    const target = event.target as HTMLElement;
    const personButton = target.closest<HTMLButtonElement>("[data-analysis-person]");
    if (personButton?.dataset.analysisPerson) {
      openAnalysisPersonModal(personButton.dataset.analysisPerson);
      return;
    }

    const analysisTabBtn = target.closest<HTMLButtonElement>("[data-analysis-tab]");
    if (analysisTabBtn?.dataset.analysisTab) {
      analysisTab = analysisTabBtn.dataset.analysisTab;
      refreshAnalysisTabContent();
      return;
    }

    const personSortBtn = target.closest<HTMLButtonElement>("[data-person-sort]");
    if (personSortBtn?.dataset.personSort) {
      const nextSort = personSortBtn.dataset.personSort as keyof AnalysisPerson;
      if (analysisPersonSort === nextSort) {
        analysisPersonSortDir = analysisPersonSortDir === "desc" ? "asc" : "desc";
      } else {
        analysisPersonSort = nextSort;
        analysisPersonSortDir = "desc";
      }
      refreshAnalysisTabContent();
      return;
    }

    const filter = target.closest<HTMLButtonElement>("[data-filter]");
    if (filter?.dataset.filter) {
      activeMappingType = filter.dataset.filter as MappingType | "all";
      renderMappings();
      return;
    }

    if (target.id === "scan-mappings") {
      const btn = target.closest<HTMLButtonElement>("#scan-mappings");
      setButtonLoading(btn, true, "Scan Historical Files");
      try {
        await scanHistoricalMappings();
        await loadMappings();
        showToast("Historical scan complete", "success");
        renderMappings();
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Scan failed", "error");
        resetButton(btn);
      }
      return;
    }

    if (target.id === "run-historical-import") {
      if (!confirmAction("This will run a full historical import and may modify the database. Continue?")) return;
      const btn = target.closest<HTMLButtonElement>("#run-historical-import");
      setButtonLoading(btn, true, "Run Historical Import");
      try {
        const result = await runHistoricalImport();
        const output = document.querySelector<HTMLPreElement>("#import-result");
        if (output) output.textContent = JSON.stringify(result, null, 2);
        showToast(`Import complete: ${result.duty_assignments_created ?? 0} assignments`, "success");
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Import failed", "error");
      } finally {
        resetButton(btn);
      }
      return;
    }

    if (target.id === "clear-member-filters") {
      memberSearch = "";
      memberPositionFilter = "all";
      memberCallLevelFilter = "all";
      memberSort = "name";
      memberSortDirection = "asc";
      saveFocus();
      renderMembersView();
      restoreFocus();
      return;
    }

    const memberSortButton = target.closest<HTMLButtonElement>("[data-member-sort]");
    if (memberSortButton?.dataset.memberSort) {
      const nextSort = memberSortButton.dataset.memberSort;
      if (memberSort === nextSort) {
        memberSortDirection = memberSortDirection === "asc" ? "desc" : "asc";
      } else {
        memberSort = nextSort;
        memberSortDirection = "asc";
      }
      saveFocus();
      renderMembersView();
      restoreFocus();
      return;
    }

    if (target.id === "create-member") {
      return;
    }

    if (target.id === "cleanup-members") {
      if (!confirmAction("Clean invalid member names? This action cannot be undone.")) return;
      const btn = target.closest<HTMLButtonElement>("#cleanup-members");
      setButtonLoading(btn, true, "Clean Invalid Names");
      try {
        await cleanupInvalidMembers();
        showToast("Invalid names cleaned", "success");
        await renderMembers();
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Cleanup failed", "error");
        resetButton(btn);
      }
      return;
    }

    if (target.id === "auto-merge-duplicates") {
      if (!confirmAction("Auto-merge exact duplicates? This action cannot be undone.")) return;
      const btn = target.closest<HTMLButtonElement>("#auto-merge-duplicates");
      setButtonLoading(btn, true, "Auto-Merge Exact Duplicates");
      try {
        const result = await autoMergeDuplicates();
        await renderMembers();
        const output = document.createElement("section");
        output.className = "panel wide";
        output.innerHTML = `<h3>Duplicate Merge Result</h3><pre>${JSON.stringify(result, null, 2)}</pre>`;
        viewRoot?.prepend(output);
        showToast("Duplicates merged", "success");
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Merge failed", "error");
        resetButton(btn);
      }
      return;
    }

    if (target.id === "prefill-call-levels") {
      const btn = target.closest<HTMLButtonElement>("#prefill-call-levels");
      setButtonLoading(btn, true, "Prefill Call Levels");
      try {
        const result = await prefillCallLevels();
        await renderMembers();
        const output = document.createElement("section");
        output.className = "panel wide";
        output.innerHTML = `<h3>Call Level Prefill Result</h3><pre>${JSON.stringify(result, null, 2)}</pre>`;
        viewRoot?.prepend(output);
        showToast("Call levels prefilled", "success");
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Prefill failed", "error");
        resetButton(btn);
      }
      return;
    }

    if (target.id === "reconcile-roster") {
      if (!confirmAction("Reconcile with trusted roster? This may modify member records.")) return;
      const btn = target.closest<HTMLButtonElement>("#reconcile-roster");
      setButtonLoading(btn, true, "Reconcile Trusted Roster");
      try {
        const result = await reconcileTrustedRoster();
        await renderMembers();
        const output = document.createElement("section");
        output.className = "panel wide";
        output.innerHTML = `<h3>Trusted Roster Result</h3><pre>${JSON.stringify(result, null, 2)}</pre>`;
        viewRoot?.prepend(output);
        showToast("Roster reconciled", "success");
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Reconciliation failed", "error");
        resetButton(btn);
      }
      return;
    }

    if (target.id === "create-account") {
      return;
    }

    if (target.id === "sign-out") {
      clearAuthToken();
      currentUser = null;
      renderLogin();
      showToast("Signed out", "info");
      return;
    }

    if (target.id === "copy-diagnostics") {
      const pre = document.querySelector<HTMLPreElement>("#diagnostics-pre");
      if (pre) {
        navigator.clipboard.writeText(pre.textContent || "").then(() => {
          showToast("Diagnostics copied to clipboard", "success");
        }).catch(() => {
          showToast("Failed to copy", "error");
        });
      }
      return;
    }

    const designationButton = target.closest<HTMLButtonElement>("[data-add-designation]");
    if (designationButton?.dataset.addDesignation) {
      const personId = designationButton.dataset.addDesignation;
      const designation = document.querySelector<HTMLInputElement>(
        `[data-designation="${personId}"]`,
      )?.value;
      const effectiveFrom = document.querySelector<HTMLInputElement>(
        `[data-designation-date="${personId}"]`,
      )?.value;
      if (!designation || !effectiveFrom) {
        showToast("Please enter designation and effective date", "warning");
        return;
      }
      try {
        await addMemberDesignation(personId, designation, effectiveFrom);
        showToast("Designation added", "success");
        await renderMembers();
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Failed to add designation", "error");
      }
      return;
    }

    const mergeButton = target.closest<HTMLButtonElement>("[data-merge-candidate]");
    if (mergeButton?.dataset.mergeCandidate) {
      if (!confirmAction("Merge these duplicates? This action cannot be undone.")) return;
      const index = Number(mergeButton.dataset.mergeCandidate);
      const candidate = dedupeCandidates[index];
      const select = document.querySelector<HTMLSelectElement>(`[data-dedupe-target="${index}"]`);
      const targetPersonId = select?.value;
      if (!candidate || !targetPersonId) return;
      const sourceIds = candidate.people
        .map((person) => person.id)
        .filter((personId) => personId !== targetPersonId);
      const btn = mergeButton;
      setButtonLoading(btn, true, "Merge");
      try {
        await mergeMembers(targetPersonId, sourceIds);
        showToast("Members merged", "success");
        await renderMembers();
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Merge failed", "error");
        resetButton(btn);
      }
      return;
    }

    const save = target.closest<HTMLButtonElement>("[data-save]");
    if (save?.dataset.save) {
      const mapping = mappings.find((item) => item.id === save.dataset.save);
      if (!mapping) return;
      setButtonLoading(save, true, "Save");
      try {
        const saved = await updateMapping(mapping);
        updateLocalMapping(saved.id, saved);
        showToast("Mapping saved", "success");
        renderMappings();
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Save failed", "error");
        resetButton(save);
      }
    }
  });

  document.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (target.matches("[data-close-person-modal]") || target.id === "analysis-person-modal") {
      closeAnalysisPersonModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeAnalysisPersonModal();
      if (sidebarOpen) toggleSidebar(false);
    }
  });

  viewRoot?.addEventListener("change", async (event) => {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    if (target.id === "member-position-filter") {
      memberPositionFilter = target.value;
      saveFocus();
      renderMembersView();
      restoreFocus();
      return;
    }
    if (target.id === "member-call-filter") {
      memberCallLevelFilter = target.value;
      saveFocus();
      renderMembersView();
      restoreFocus();
      return;
    }
    if (target.dataset.callLevel) {
      const member = members.find((item) => item.id === target.dataset.callLevel);
      if (!member) return;
      member.call_level = target.value || null;
      saveFocus();
      try {
        await updateMember(member);
        memberAudit = await getMemberAudit();
        showToast("Call level updated", "success");
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Update failed", "error");
      }
      updateMemberResults();
      restoreFocus();
      return;
    }

    const id = target.dataset.id;
    const field = target.dataset.field as keyof AdminMapping | undefined;
    if (!id || !field) return;

    const patch: Partial<AdminMapping> = { [field]: target.value || null };
    if (field === "target_key") {
      patch.target_label = targetLabelForKey(target.value);
      patch.status = target.value ? "reviewed" : "needs_review";
    }
    updateLocalMapping(id, patch);
    const row = target.closest("tr");
    if (row) row.classList.add("dirty");
  });

  viewRoot?.addEventListener("input", (event) => {
    const target = event.target as HTMLInputElement;
    if (target.id === "analysis-person-search") {
      analysisPersonSearch = target.value;
      refreshPersonnelResultsInPlace();
      return;
    }
    if (target.id === "mapping-search") {
      mappingSearch = target.value;
      renderMappings();
      return;
    }
    if (target.id !== "member-search") return;
    memberSearch = target.value;
    updateMemberResults();
  });
}

async function bootApp() {
  renderShell();
  refreshShellRefs();
  try {
    await healthCheck();
    currentUser = currentUser ?? await getCurrentUser();
    setApiStatus("API online", "ok");
    await loadMappings();
    renderOverview();
  } catch (error) {
    setApiStatus("API offline", "error");
    if (viewRoot) {
      viewRoot.innerHTML = `
        <section class="panel">
          <h3>Connection</h3>
          <p>${error instanceof Error ? error.message : "Unable to load admin data"}</p>
        </section>
      `;
    }
  }

  bindNavigation();
  bindViewEvents();
}

async function boot() {
  try {
    currentUser = await getCurrentUser();
    await bootApp();
  } catch {
    renderLogin();
  }
}

boot();
