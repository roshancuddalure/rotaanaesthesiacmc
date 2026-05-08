import "./styles.css";
import {
  type AdminMapping,
  type AnalysisDashboard,
  type AnalysisManualReview,
  type AnalysisPerson,
  type AnalysisPreflight,
  type DepartmentMember,
  type DiagnosticsSummary,
  type InvalidMembersResult,
  type LeaveCalendar,
  type LeaveDayEntry,
  type LeaveImportPreview,
  type LeavePressure,
  type LeaveRequest,
  type MappingOptions,
  type MappingType,
  type MemberAudit,
  type RotaAutoFillMonth,
  type RotaCandidate,
  type RotaCandidateMonth,
  type RotaPhaseOneRules,
  type RotaPublishChecklistItem,
  type RotaPublishMonth,
  type RotaReviewMonth,
  type RotaSafetyPerson,
  type RotaSafetyMonth,
  type RotaSetupMonth,
  type RotaTemplateMonth,
  type UnitAssignment,
  type UnitManagementMonth,
  type UnitRead,
  type UserAccount,
  addMemberDesignation,
  approveRotaExchange,
  assignRotaSlot,
  cleanupInvalidMembers,
  clearRotaAssignment,
  clearAuthToken,
  cancelLeaveRequest,
  clonePreviousRotaSetupScope,
  createMember,
  createLeaveRequest,
  createUnitAssignment,
  createUserAccount,
  deleteUnitAssignment,
  downloadRotaExport,
  forgotPassword,
  getAnalysisDashboard,
  getAnalysisManualReview,
  getAnalysisPreflight,
  getCurrentUser,
  getDiagnosticsSummary,
  getInvalidMembers,
  getLeaveCalendar,
  getLeavePressure,
  getLeaveRequests,
  getMappingOptions,
  getMappings,
  getRotaAutoFillMonth,
  getRotaCandidateMonth,
  getRotaPhaseOneRules,
  getRotaPublishMonth,
  getRotaReviewMonth,
  getRotaSafetyMonth,
  getRotaSetupMonth,
  getRotaTemplateMonth,
  getHistoricalImportStatus,
  getMemberAudit,
  getMembers,
  getUnitManagementMonth,
  getUnits,
  healthCheck,
  listUserAccounts,
  prefillCallLevels,
  previewLeaveImport,
  resetPassword,
  reconcileTrustedRoster,
  runHistoricalImport,
  runRotaAutoFillDraft,
  scanHistoricalMappings,
  signIn,
  updateLeaveRequest,
  updateMapping,
  updateMember,
  updateRotaPhaseOneRules,
  updateRotaSetupScope,
  updateUnitAssignment,
  applyLeaveImport,
  generateRotaTemplate,
  publishRotaMonth,
  rejectRotaExchange,
  requestRotaExchange,
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
let invalidMembers: InvalidMembersResult = { count: 0, people: [] };
let memberAudit: MemberAudit | null = null;
let memberSearch = "";
let memberStatusFilter: "all" | "active" | "historical" = "active";
let memberPositionFilter = "all";
let memberCallLevelFilter = "all";
let memberSort = "name";
let memberSortDirection: "asc" | "desc" = "asc";
let leaveMonth = new Date().toISOString().slice(0, 7);
let leaveCalendar: LeaveCalendar | null = null;
let leaveRequests: LeaveRequest[] = [];
let leavePressure: LeavePressure | null = null;
let leaveImportPreview: LeaveImportPreview | null = null;
let leaveImportFile: File | null = null;
let unitMonth = new Date().toISOString().slice(0, 7);
let unitManagement: UnitManagementMonth | null = null;
let units: UnitRead[] = [];
let unitAssignments: UnitAssignment[] = [];
let unitModalUnitId: string | null = null;
let unitEditingAssignmentId: string | null = null;
let rotaPhaseOneRules: RotaPhaseOneRules | null = null;
let rotaSetupMonth = new Date().toISOString().slice(0, 7);
let rotaSetup: RotaSetupMonth | null = null;
let rotaTemplateMonth = new Date().toISOString().slice(0, 7);
let rotaTemplate: RotaTemplateMonth | null = null;
let rotaSafety: RotaSafetyMonth | null = null;
let rotaCandidates: RotaCandidateMonth | null = null;
let rotaAutoFill: RotaAutoFillMonth | null = null;
let rotaReviewMonth = new Date().toISOString().slice(0, 7);
let rotaReview: RotaReviewMonth | null = null;
let rotaPublishMonth = new Date().toISOString().slice(0, 7);
let rotaPublish: RotaPublishMonth | null = null;
const rejectedRotaCandidates = new Set<string>();
let currentUser: UserAccount | null = null;
let accounts: UserAccount[] = [];

function isAdminUser(): boolean {
  return currentUser?.role === "computer_admin" || currentUser?.role === "superadmin";
}

function renderShell() {
  sidebarOpen = false;
  const adminNav = isAdminUser()
    ? `
        <div class="nav-section-label">Admin tools</div>
        <button data-view="rota-rules">Rota Rules</button>
        <button data-view="mappings">Mappings</button>
        <button data-view="imports">Historical Import</button>
        <button data-view="accounts">Login Accounts</button>
        <button data-view="diagnostics">Diagnostics</button>
      `
    : "";
  app.innerHTML = `
  <a href="#view-root" class="skip-link">Skip to content</a>
  <div class="sidebar-overlay" id="sidebar-overlay"></div>
  <main class="shell">
    <aside class="sidebar" id="sidebar">
      <div class="brand">
        <span class="brand-mark">DR</span>
        <div>
          <h1>Duty Rota</h1>
          <p>Rota board</p>
        </div>
        <button class="sidebar-close" id="sidebar-close" aria-label="Close menu">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <nav class="nav" aria-label="Main navigation">
        <button data-view="overview" class="active" aria-current="page">Overview</button>
        <button data-view="analysis">Duty Analysis</button>
        <button data-view="members">Department Members</button>
        <button data-view="leave">Leave</button>
        <button data-view="units">Unit Management</button>
        <button data-view="rota-setup">Rota Setup</button>
        <button data-view="rota-template">Rota Template</button>
        <button data-view="rota-review">Rota Review</button>
        <button data-view="rota-publish">Publish & Export</button>
        <button disabled title="Coming soon">Rota Board</button>
        <button disabled title="Coming soon">Exports</button>
        ${adminNav}
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
            <h2 id="section-title">CMC Anaesthesia rota board</h2>
          </div>
        </div>
        <div class="topbar-actions">
          <span id="api-status" class="status">Checking API...</span>
          <button class="icon-button" id="sign-out">Sign Out</button>
        </div>
      </header>
      <div id="view-root"></div>
    </section>
    <nav class="mobile-bottom-nav" aria-label="Mobile section navigation">
      <button data-view="overview" class="active" aria-current="page">Overview</button>
      <button data-view="analysis">Analysis</button>
      <button data-view="members">Members</button>
      <button data-view="leave">Leave</button>
      <button data-view="units">Units</button>
    </nav>
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
  document.getElementById("sign-out")?.addEventListener("click", () => {
    clearAuthToken();
    currentUser = null;
    renderLogin();
    showToast("Signed out", "info");
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

async function renderOverview() {
  setHeader("Overview", "CMC Anaesthesia rota board");
  if (!viewRoot) return;
  viewRoot.innerHTML = `<section class="panel"><h3>Loading overview...</h3></section>`;
  try {
    analysis = analysis ?? await getAnalysisDashboard();
  } catch (error) {
    viewRoot.innerHTML = `
      <section class="panel">
        <h3>Analysis unavailable</h3>
        <p>${error instanceof Error ? error.message : "Unable to load duty analysis."}</p>
      </section>
    `;
    return;
  }
  const topTotal = topPeople("total_24hr", 6);
  const topWeekend = topPeople("total_weekend_24hr", 6);
  const firstMonth = analysis.months[0];
  const lastMonth = analysis.months[analysis.months.length - 1];
  const periodLabel = [analysis.month_labels[firstMonth], analysis.month_labels[lastMonth]]
    .filter(Boolean)
    .join(" to ");
  const totalLeader = topTotal[0];
  const weekendLeader = topWeekend[0];
  viewRoot.innerHTML = `
    <section class="board-hero">
      <div>
        <span class="board-kicker">${escapeHtml(periodLabel || "Current duty analysis")}</span>
        <h3>Duty workload at a glance</h3>
        <p>Review the main 24hr duty load, weekend burden, and people who may need balancing attention.</p>
      </div>
      <div class="board-hero-actions">
        <button class="primary" data-view-shortcut="analysis">Open Duty Analysis</button>
        <button class="icon-button" data-view-shortcut="members">Find Member</button>
      </div>
    </section>
    <section class="summary-grid four-col board-metrics">
      ${metricCard(analysis.summary.total_24hr.toLocaleString(), "Total 24hr duties", undefined, "metric-primary")}
      ${metricCard(analysis.summary.total_weekend_24hr.toLocaleString(), "Weekend 24hr", undefined, "metric-weekend")}
      ${metricCard(`${analysis.summary.weekend_percent}%`, "Weekend share")}
      ${metricCard(analysis.summary.avg_24hr_per_active_person, "Avg per active person")}
    </section>
    <section class="board-insight-grid">
      <article class="board-insight">
        <span>Highest total load</span>
        <button class="person-link" data-analysis-person="${escapeHtml(totalLeader?.name ?? "")}">${escapeHtml(totalLeader?.name ?? "No data")}</button>
        <strong>${totalLeader?.total_24hr ?? 0} duties</strong>
      </article>
      <article class="board-insight">
        <span>Highest weekend load</span>
        <button class="person-link" data-analysis-person="${escapeHtml(weekendLeader?.name ?? "")}">${escapeHtml(weekendLeader?.name ?? "No data")}</button>
        <strong>${weekendLeader?.total_weekend_24hr ?? 0} duties</strong>
      </article>
      <article class="board-insight">
        <span>People active</span>
        <strong>${analysis.summary.active_personnel} of ${analysis.summary.personnel}</strong>
        <small>${analysis.summary.months} months reviewed</small>
      </article>
    </section>
    <section class="analytics-grid">
      <article class="panel">
        <h3>Highest 24hr Duty Load</h3>
        ${renderMiniRank(topTotal, "total_24hr")}
      </article>
      <article class="panel">
        <h3>Highest Weekend Load</h3>
        ${renderMiniRank(topWeekend, "total_weekend_24hr")}
      </article>
    </section>
  `;
}

// ── Analysis dashboard state ─────────────────────────────────────────────────
let analysisTab: string = "overview";
let analysisPersonSearch: string = "";
let analysisPersonSort: keyof AnalysisPerson = "total_24hr";
let analysisPersonSortDir: "asc" | "desc" = "desc";

// Pagination state — one page index per table, keyed by a stable table id
const PAGE_SIZE = 25;
const analysisPagination: Record<string, number> = {};

function getPage(tableId: string): number {
  return analysisPagination[tableId] ?? 0;
}

function setPage(tableId: string, page: number): void {
  analysisPagination[tableId] = page;
}

function resetPages(): void {
  for (const key of Object.keys(analysisPagination)) {
    analysisPagination[key] = 0;
  }
}

function paginate<T>(items: T[], tableId: string, pageSize = PAGE_SIZE): T[] {
  const page = getPage(tableId);
  return items.slice(page * pageSize, (page + 1) * pageSize);
}

function renderPaginator(tableId: string, totalItems: number, pageSize = PAGE_SIZE): string {
  const totalPages = Math.ceil(totalItems / pageSize);
  if (totalPages <= 1) return "";
  const page = getPage(tableId);
  const start = page * pageSize + 1;
  const end = Math.min((page + 1) * pageSize, totalItems);
  const prev = page > 0
    ? `<button class="page-btn" data-set-page="${tableId}:${page - 1}">&#8592; Prev</button>`
    : `<button class="page-btn" disabled>&#8592; Prev</button>`;
  const next = page < totalPages - 1
    ? `<button class="page-btn" data-set-page="${tableId}:${page + 1}">Next &#8594;</button>`
    : `<button class="page-btn" disabled>Next &#8594;</button>`;
  return `
    <div class="paginator">
      <span class="page-label">Page ${page + 1} of ${totalPages}</span>
      <div class="paginator-controls">
        ${prev}
        <span class="page-info">${start}–${end} of ${totalItems}</span>
        ${next}
      </div>
    </div>`;
}

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

const STAT_HELP: Record<string, string> = {
  "Total 24hr duties": "All 24-hour duty assignments counted in the selected historical period.",
  "Weekend 24hr": "24-hour duties that happened on Saturdays or Sundays.",
  "Weekend share": "The percentage of all 24-hour duties that fell on weekends.",
  "Avg per active person": "Average 24-hour duty load among people active in the analysed period.",
  "Personnel in list": "Total department members currently included in the database.",
  "Active personnel": "Members marked active and expected to be considered for planning.",
  "Months analysed": "Historical months included in this analysis.",
  "Assignments reviewed": "Duty assignment records read from the imported historical rota data.",
  People: "Department members stored in the system.",
  "Duty assignments": "Imported or saved records linking a person to a duty slot.",
  "Unit postings": "Records linking members to units or call levels for a month.",
  "Duty slots": "Duty positions stored in the system before a person is assigned.",
  "Import batches": "Historical import runs saved by the software.",
  "Import warnings": "Rows or labels that need review after import or diagnostics.",
  "Leave requests": "Leave records for the selected month, including approved and pending review leave.",
  "People on leave": "Unique department members who have leave recorded in this month.",
  "Total leave days": "Total calendar days covered by active leave records in this month.",
  "Highest day pressure": "The largest number of people on leave on any one day in this month.",
  "By Call Level": "Leave totals grouped by the member's department call level.",
  "By Unit": "Leave totals grouped by the unit assigned in Unit Management.",
  "Pressure By Call Level": "Generator-facing leave pressure grouped by call level.",
  "Pressure By Unit": "Generator-facing leave pressure grouped by assigned unit.",
  Assignments: "Current monthly unit assignment records.",
  "Active units": "Units currently marked active in Unit Management.",
  "Unit leave days": "Total leave days affecting members assigned to units this month.",
  "Errors / warnings": "Unit setup issues found before rota generation.",
  "Duty types": "Configurable duty categories available to the rota generator.",
  "Rest hours": "Minimum rest gap after a 24-hour duty.",
  "Warning threshold": "Leave pressure level where the software asks for review but still allows planning.",
  "Hard block threshold": "Leave pressure level where adjustable slots are blocked or skipped.",
  "Included units": "Units selected to participate in this month's rota generation.",
  "Excluded units": "Units deliberately excluded from this month's rota generation.",
  "Ready included": "Included units with enough basic setup to proceed.",
  "Need review": "Items that can proceed only after board review or explanation.",
  "Template slots": "Empty duty slots generated for the month before people are assigned.",
  "Ready slots": "Generated empty slots that passed the current leave-pressure checks.",
  "Blocked/skipped": "Adjustable slots skipped because rules or leave pressure made them unsafe.",
  "Safety checked": "Generated slots checked against current leave, unit membership, same-day duties, and rest rules.",
  "Safe slots": "Slots with enough eligible available members under the current rules.",
  "Needs review": "Slots that can still be planned, but have pending leave or staffing pressure that needs board review.",
  "Hard blocked": "Slots where confirmed blockers or staffing thresholds make assignment unsafe without rule changes or override.",
  "Minimum available": "Lowest available eligible member count found across unit-day safety checks.",
  "Assigned slots": "Generated slots that already have a saved member assignment.",
  "Open slots": "Generated slots that still need a member assignment.",
  "Suggestion slots": "Generated slots where the software found at least one candidate from Unit Management.",
  "Safe suggestions": "Candidates with no person-specific leave, rest, or validation blocker.",
  "Review suggestions": "Candidates that may be usable but need board review or an override reason.",
  "Blocked suggestions": "Candidates with hard blockers such as approved leave, rest conflict, or rule-limit problems.",
  "Auto-filled slots": "Slots assigned automatically using only top safe suggestions with clear validation.",
  "Left open": "Slots auto-fill deliberately did not assign, usually because they need review or have no safe candidate.",
  "Review left open": "Slots left open because the best candidate still needs board review.",
  "Blocked left open": "Slots left open because no safe candidate was available.",
  "Review items": "Open slots, warning slots, hard-blocked slots, and override assignments needing board attention.",
  "Hard-blocked items": "Review items with hard safety blockers under the current rule and leave data.",
  "Override assignments": "Saved assignments that include a board override reason.",
  "Exchange requests": "Requested member swaps recorded for this rota month.",
  "Pending exchanges": "Exchange requests still waiting for approval or override review.",
  "People assigned": "People who currently have at least one saved duty assignment in this rota month.",
  "Checklist blockers": "Publish checklist items that must be fixed before final approval.",
  "Checklist warnings": "Remaining warnings that can be published only with board confirmation.",
  "Invalid member names": "Member names that still need cleanup before reliable matching.",
  "Login accounts": "User accounts that can sign in to this website.",
  total: "People with leave recorded on this date.",
  approved: "Leave already marked approved.",
  "requested/review": "Leave requested or imported and still needing review.",
  "call groups": "Number of call-level groups represented in this day's leave list.",
};

function helpIcon(help: string): string {
  return `<span class="help-icon" tabindex="0" title="${escapeHtml(help)}" aria-label="${escapeHtml(help)}">?</span>`;
}

function statLabel(label: string, help?: string): string {
  const description = help ?? STAT_HELP[label];
  return `<span class="stat-label">${escapeHtml(label)}${description ? helpIcon(description) : ""}</span>`;
}

function metricCard(value: string | number, label: string, help?: string, className = ""): string {
  const classes = `metric${className ? ` ${className}` : ""}`;
  return `<article class="${classes}"><span>${escapeHtml(String(value))}</span><p>${statLabel(label, help)}</p></article>`;
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
  return `<article class="person-metric"><strong>${value}</strong><span>${statLabel(label, `Count for ${label} in the selected historical period.`)}</span></article>`;
}

function renderPersonMetricGroup(title: string, metrics: Array<[string, number]>): string {
  const cards = metrics.map(([label, value]) => renderPersonMetric(label, value)).join("");
  return `
    <section class="person-metric-section">
      <h4>${title}</h4>
      <div class="person-metric-grid">${cards}</div>
    </section>
  `;
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

function renderAnalysisDataCard(
  title: string,
  rows: Array<[string, string | number]>,
  personName?: string,
): string {
  const heading = personName
    ? `<button class="person-link" data-analysis-person="${escapeHtml(personName)}">${escapeHtml(title)}</button>`
    : escapeHtml(title);
  return `
    <article class="data-card analysis-data-card">
      <div class="data-card-title">${heading}</div>
      ${rows
        .map(
          ([label, value]) => `
            <div class="data-card-row">
              <span class="data-card-label">${escapeHtml(label)}</span>
              <span class="data-card-value">${value}</span>
            </div>
          `,
        )
        .join("")}
    </article>
  `;
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
    <div class="summary-grid four-col board-metrics">
      ${metricCard(analysis.summary.total_24hr.toLocaleString(), "Total 24hr duties", undefined, "metric-primary")}
      ${metricCard(analysis.summary.total_weekend_24hr.toLocaleString(), "Weekend 24hr", undefined, "metric-weekend")}
      ${metricCard(`${analysis.summary.weekend_percent}%`, "Weekend share")}
      ${metricCard(analysis.summary.avg_24hr_per_active_person, "Avg per active person")}
    </div>
    <div class="summary-grid four-col">
      ${metricCard(analysis.summary.personnel, "Personnel in list")}
      ${metricCard(analysis.summary.active_personnel, "Active personnel")}
      ${metricCard(analysis.summary.months, "Months analysed")}
      ${metricCard(analysis.summary.total_records.toLocaleString(), "Assignments reviewed")}
    </div>
    <div class="analytics-grid">
      <article class="panel chart-panel">
        <h3>Monthly 24hr Load</h3>
        <div class="chart-legend">
          <span class="legend-dot weekend-dot"></span>Weekend &nbsp;
          <span class="legend-dot weekday-dot"></span>Weekday
        </div>
        <div class="bar-chart">${renderMonthBars()}</div>
      </article>
      <article class="panel chart-panel">
        <h3>Day of Week Pattern</h3>
        <div class="bar-chart">${renderDayBars()}</div>
      </article>
    </div>
    <div class="analytics-grid">
      <article class="panel chart-panel">
        <h3>People Active by Month</h3>
        <div class="bar-chart">${renderBarChart(monthPersonEntries)}</div>
      </article>
      <article class="panel">
        <h3>Duty Mix</h3>
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
  const TID = "personnel";
  const tbody = document.getElementById("analysis-person-tbody");
  const cards = document.getElementById("analysis-person-cards");
  const count = document.getElementById("analysis-person-count");
  if (!tbody || !cards || !count) return false;

  const people = filteredSortedPeople();
  const pageItems = paginate(people, TID);
  const offset = getPage(TID) * PAGE_SIZE;
  const rows = pageItems.map((person, index) => `
        <tr>
          <td>
            <button class="person-link" data-analysis-person="${escapeHtml(person.name)}">${offset + index + 1}. ${escapeHtml(person.name)}</button>
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
  const cardHtml = pageItems.map((person, index) => `
    <article class="data-card">
      <div class="data-card-row">
        <span class="data-card-label">Name</span>
        <span class="data-card-value"><button class="person-link" data-analysis-person="${escapeHtml(person.name)}">${offset + index + 1}. ${escapeHtml(person.name)}</button></span>
      </div>
      <div class="data-card-row"><span class="data-card-label">Total 24hr</span><span class="data-card-value">${person.total_24hr}</span></div>
      <div class="data-card-row"><span class="data-card-label">Weekend</span><span class="data-card-value">${person.total_weekend_24hr}</span></div>
      <div class="data-card-row"><span class="data-card-label">Main</span><span class="data-card-value">${person.main_24hr}</span></div>
      <div class="data-card-row"><span class="data-card-label">CB</span><span class="data-card-value">${person.cb_24hr}</span></div>
      <div class="data-card-row"><span class="data-card-label">RC</span><span class="data-card-value">${person.rc_24hr}</span></div>
      <div class="data-card-row"><span class="data-card-label">Schell</span><span class="data-card-value">${person.schell}</span></div>
    </article>
  `).join("");

  const paginatorHtml = renderPaginator(TID, people.length);
  tbody.innerHTML = rows || `<tr><td colspan="13" class="empty">No results.</td></tr>`;
  const tablePaginator = document.getElementById("personnel-table-paginator");
  if (tablePaginator) tablePaginator.innerHTML = paginatorHtml;
  cards.innerHTML = (cardHtml || `<p class="empty">No results.</p>`) + paginatorHtml;
  count.textContent = `${people.length} of ${analysis?.people.length ?? 0} people`;
  return true;
}

function renderAnalysisPersonnelTab(): string {
  const TID = "personnel";
  const people = filteredSortedPeople();
  const pageItems = paginate(people, TID);
  const offset = getPage(TID) * PAGE_SIZE;
  const rows = pageItems
    .map(
      (person, index) => `
        <tr>
          <td>
            <button class="person-link" data-analysis-person="${escapeHtml(person.name)}">${offset + index + 1}. ${escapeHtml(person.name)}</button>
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

  const cards = paginate(people, TID).map((person, index) => `
    <article class="data-card">
      <div class="data-card-row">
        <span class="data-card-label">Name</span>
        <span class="data-card-value"><button class="person-link" data-analysis-person="${escapeHtml(person.name)}">${offset + index + 1}. ${escapeHtml(person.name)}</button></span>
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
      <div id="personnel-table-paginator">${renderPaginator(TID, people.length)}</div>
    </section>
    <section id="analysis-person-cards" class="card-list">
      ${cards || `<p class="empty">No results.</p>`}
      ${renderPaginator(TID, people.length)}
    </section>
  `;
}

// ── Tab: Weekend ──────────────────────────────────────────────────────────────
function renderAnalysisWeekendTab(): string {
  if (!analysis) return "";
  const TID = "weekend";
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

  const pageItems = paginate(weekendPeople, TID);
  const offset = getPage(TID) * PAGE_SIZE;
  const rows = pageItems
    .map(
      (p, i) => `
        <tr>
          <td><button class="person-link" data-analysis-person="${escapeHtml(p.name)}">${offset + i + 1}. ${escapeHtml(p.name)}</button></td>
          <td class="num">${p.total_weekend_24hr}</td>
          <td class="num">${p.day_breakdown["Saturday"] ?? 0}</td>
          <td class="num">${p.day_breakdown["Sunday"] ?? 0}</td>
          <td class="num">${p.total_24hr > 0 ? Math.round((p.total_weekend_24hr / p.total_24hr) * 100) : 0}%</td>
        </tr>
      `,
    )
    .join("");
  const cards = weekendPeople
    .map((p, i) =>
      renderAnalysisDataCard(`${i + 1}. ${p.name}`, [
        ["Total Weekend", p.total_weekend_24hr],
        ["Saturdays", p.day_breakdown["Saturday"] ?? 0],
        ["Sundays", p.day_breakdown["Sunday"] ?? 0],
        ["Share of Total", `${p.total_24hr > 0 ? Math.round((p.total_weekend_24hr / p.total_24hr) * 100) : 0}%`],
      ], p.name),
    )
    .join("");

  return `
    <div class="analytics-grid">
      <article class="panel chart-panel">
        <h3>Weekend 24hr Duties per Month</h3>
        <div class="bar-chart">${renderBarChart(weekendMonthEntries)}</div>
      </article>
      <div class="weekend-rank-grid">
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
    <section class="panel table-panel hide-mobile" style="margin-top:16px">
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
      ${renderPaginator(TID, weekendPeople.length)}
    </section>
    <section class="card-list analysis-card-list">${cards || `<p class="empty">No weekend duties.</p>`}</section>
  `;
}

// ── Tab: Duty Types ───────────────────────────────────────────────────────────
function renderAnalysisDutyTypesTab(): string {
  if (!analysis) return "";
  const TID = "duty-types";
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
  const allDutyPeople = [...analysis.people]
    .filter((p) => p.total_24hr > 0)
    .sort((a, b) => b.total_24hr - a.total_24hr);
  const pageItems = paginate(allDutyPeople, TID);
  const offset = getPage(TID) * PAGE_SIZE;
  const dutyTypeRows = pageItems
    .map((p, i) => ({
      person: p,
      row: `
        <tr>
          <td><button class="person-link" data-analysis-person="${escapeHtml(p.name)}">${offset + i + 1}. ${escapeHtml(p.name)}</button></td>
          <td class="num">${p.total_24hr}</td>
          <td class="num">${p.main_24hr}</td>
          <td class="num">${p.cb_24hr}</td>
          <td class="num">${p.rc_24hr}</td>
          <td class="num">${p.schell}</td>
          <td class="num">${p.floating}</td>
          <td class="num">${p.caesar_b}</td>
        </tr>
      `,
    }));
  const dutyTypeCards = dutyTypeRows
    .map(({ person }, i) =>
      renderAnalysisDataCard(`${offset + i + 1}. ${person.name}`, [
        ["Total 24hr", person.total_24hr],
        ["Main", person.main_24hr],
        ["CB", person.cb_24hr],
        ["RC", person.rc_24hr],
        ["Schell", person.schell],
        ["Floating", person.floating],
        ["Caesar B", person.caesar_b],
      ], person.name),
    )
    .join("");
  return `
    <div class="analysis-duty-grid">${rankSections}</div>
    <section class="panel table-panel hide-mobile" style="margin-top:16px">
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
        <tbody>${dutyTypeRows.map((item) => item.row).join("") || `<tr><td colspan="8" class="empty">No data.</td></tr>`}</tbody>
      </table>
      ${renderPaginator(TID, allDutyPeople.length)}
    </section>
    <section class="card-list analysis-card-list">${dutyTypeCards || `<p class="empty">No data.</p>`}</section>
  `;
}

// ── Tab: CART & Schell ────────────────────────────────────────────────────────
function renderAnalysisCartSchellTab(): string {
  if (!analysis) return "";
  const CART_TID = "cart-performers";
  const allCartPeople = [...analysis.people]
    .filter((p) => p.cart > 0)
    .sort((a, b) => b.cart - a.cart);
  const cartOffset = getPage(CART_TID) * PAGE_SIZE;
  const cartRows = paginate(allCartPeople, CART_TID)
    .map((p, i) => ({
      person: p,
      row: `
        <tr>
          <td><button class="person-link" data-analysis-person="${escapeHtml(p.name)}">${cartOffset + i + 1}. ${escapeHtml(p.name)}</button></td>
          <td class="num">${p.cart}</td>
          <td class="num">${p.schell}</td>
          <td class="num">${p.floating}</td>
        </tr>
      `,
    }));
  const schellOnlyRows = [...analysis.people]
    .filter((p) => p.schell > 0 && p.cart === 0)
    .sort((a, b) => b.schell - a.schell)
    .slice(0, 15)
    .map((p, i) => ({
      person: p,
      row: `
        <tr>
          <td><button class="person-link" data-analysis-person="${escapeHtml(p.name)}">${i + 1}. ${escapeHtml(p.name)}</button></td>
          <td class="num">${p.schell}</td>
          <td class="num">${p.floating}</td>
        </tr>
      `,
    }));
  const cartCards = cartRows
    .map(({ person }, i) =>
      renderAnalysisDataCard(`${cartOffset + i + 1}. ${person.name}`, [
        ["CART", person.cart],
        ["Schell", person.schell],
        ["Floating", person.floating],
      ], person.name),
    )
    .join("");
  const schellCards = schellOnlyRows
    .map(({ person }, i) =>
      renderAnalysisDataCard(`${i + 1}. ${person.name}`, [
        ["Schell", person.schell],
        ["Floating", person.floating],
      ], person.name),
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
      <section class="panel table-panel hide-mobile">
        <h3 style="padding:14px 16px 0">CART Performers</h3>
        <table class="analysis-table">
          <thead><tr><th>Name</th><th class="num">CART</th><th class="num">Schell</th><th class="num">Floating</th></tr></thead>
          <tbody>${cartRows.map((item) => item.row).join("") || `<tr><td colspan="4" class="empty">No CART duties.</td></tr>`}</tbody>
        </table>
        ${renderPaginator(CART_TID, allCartPeople.length)}
      </section>
      <section class="panel table-panel hide-mobile">
        <h3 style="padding:14px 16px 0">Schell Only (No CART)</h3>
        <table class="analysis-table">
          <thead><tr><th>Name</th><th class="num">Schell</th><th class="num">Floating</th></tr></thead>
          <tbody>${schellOnlyRows.map((item) => item.row).join("") || `<tr><td colspan="3" class="empty">No data.</td></tr>`}</tbody>
        </table>
      </section>
    </div>
    <section class="mobile-section card-list analysis-card-list">
      <h3>CART Performers</h3>
      ${cartCards || `<p class="empty">No CART duties.</p>`}
    </section>
    <section class="mobile-section card-list analysis-card-list">
      <h3>Schell Only (No CART)</h3>
      ${schellCards || `<p class="empty">No data.</p>`}
    </section>
  `;
}

// ── Tab: 5th Call ─────────────────────────────────────────────────────────────
function renderAnalysisFifthCallTab(): string {
  if (!analysis) return "";
  const TID = "fifth-call";
  const fifthPeople = [...analysis.people]
    .filter((p) => p.fifth_call > 0)
    .sort((a, b) => b.fifth_call - a.fifth_call);
  const monthTotals = analysis.months.map((month) => ({
    label: analysis!.month_labels[month],
    total: analysis!.people.reduce((sum, p) => sum + (p.fifth_call_monthly[month] ?? 0), 0),
  }));
  const pageItems = paginate(fifthPeople, TID);
  const offset = getPage(TID) * PAGE_SIZE;
  const rows = pageItems
    .map((p, i) => ({
      person: p,
      row: `
        <tr>
          <td><button class="person-link" data-analysis-person="${escapeHtml(p.name)}">${offset + i + 1}. ${escapeHtml(p.name)}</button></td>
          <td class="num">${p.fifth_call}</td>
          <td class="num">${p.fifth_call_weekend}</td>
          <td class="num">${p.fifth_call - p.fifth_call_weekend}</td>
          ${analysis!.months.map((m) => `<td class="num">${p.fifth_call_monthly[m] ?? 0}</td>`).join("")}
        </tr>
      `,
    }));
  const cards = rows
    .map(({ person }, i) => {
      const activeMonths = analysis!.months
        .filter((m) => (person.fifth_call_monthly[m] ?? 0) > 0)
        .map((m) => `${analysis!.month_labels[m]}: ${person.fifth_call_monthly[m]}`)
        .join(", ");
      return renderAnalysisDataCard(`${offset + i + 1}. ${person.name}`, [
        ["Total", person.fifth_call],
        ["Weekend", person.fifth_call_weekend],
        ["Weekday", person.fifth_call - person.fifth_call_weekend],
        ["Active Months", activeMonths || "-"],
      ], person.name);
    })
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
    <section class="panel table-panel hide-mobile" style="margin-top:16px">
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
        <tbody>${rows.map((item) => item.row).join("") || `<tr><td colspan="${4 + analysis.months.length}" class="empty">No 5th call duties.</td></tr>`}</tbody>
      </table>
      ${renderPaginator(TID, fifthPeople.length)}
    </section>
    <section class="card-list analysis-card-list">${cards || `<p class="empty">No 5th call duties.</p>`}</section>
  `;
}

// ── Tab: Shifts & PAC ─────────────────────────────────────────────────────────
function renderAnalysisShiftsPacTab(): string {
  if (!analysis) return "";
  const TID = "shifts-pac";
  const allShiftsPac = [...analysis.people]
    .filter((p) => p.pac > 0 || p.shift > 0 || p.caesar_a > 0 || p.rc12hr > 0 || p.cb_co12hr > 0)
    .sort((a, b) => b.pac + b.shift - (a.pac + a.shift));
  const pageItems = paginate(allShiftsPac, TID);
  const offset = getPage(TID) * PAGE_SIZE;
  const rows = pageItems
    .map((p, i) => ({
      person: p,
      row: `
        <tr>
          <td><button class="person-link" data-analysis-person="${escapeHtml(p.name)}">${offset + i + 1}. ${escapeHtml(p.name)}</button></td>
          <td class="num">${p.pac}</td>
          <td class="num">${p.shift}</td>
          <td class="num">${p.caesar_a}</td>
          <td class="num">${p.rc12hr}</td>
          <td class="num">${p.cb_co12hr}</td>
        </tr>
      `,
    }));
  const cards = rows
    .map(({ person }, i) =>
      renderAnalysisDataCard(`${offset + i + 1}. ${person.name}`, [
        ["PAC", person.pac],
        ["Shifts", person.shift],
        ["Caesar A", person.caesar_a],
        ["RC 12hr", person.rc12hr],
        ["CB Co 12hr", person.cb_co12hr],
      ], person.name),
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
    <section class="panel table-panel hide-mobile" style="margin-top:16px">
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
        <tbody>${rows.map((item) => item.row).join("") || `<tr><td colspan="6" class="empty">No shift/PAC data.</td></tr>`}</tbody>
      </table>
      ${renderPaginator(TID, allShiftsPac.length)}
    </section>
    <section class="card-list analysis-card-list">${cards || `<p class="empty">No shift/PAC data.</p>`}</section>
  `;
}

// ── Tab: Postings ─────────────────────────────────────────────────────────────
function renderAnalysisPostingsTab(): string {
  if (!analysis) return "";
  const buckets: Array<[string, "pain_months" | "sicu_months" | "drp_months" | "neuro_icu_months", string]> = [
    ["Pain Call", "pain_months", "postings-pain"],
    ["SICU / ICU", "sicu_months", "postings-sicu"],
    ["DRP", "drp_months", "postings-drp"],
    ["Neuro ICU", "neuro_icu_months", "postings-neuro"],
  ];
  const sections = buckets
    .map(([label, key, tid]) => {
      const people = [...analysis!.people]
        .filter((p) => p[key].length > 0)
        .sort((a, b) => b[key].length - a[key].length);
      if (!people.length) return "";
      const pageItems = paginate(people, tid);
      const offset = getPage(tid) * PAGE_SIZE;
      const rows = pageItems
        .map((p, i) => ({
          person: p,
          row: `
            <tr>
              <td><button class="person-link" data-analysis-person="${escapeHtml(p.name)}">${offset + i + 1}. ${escapeHtml(p.name)}</button></td>
              <td class="num">${p[key].length} mo</td>
              <td>${p[key].map((m) => analysis!.month_labels[m] ?? m).join(", ")}</td>
            </tr>
          `,
        }));
      const cards = rows
        .map(({ person }, i) =>
          renderAnalysisDataCard(`${offset + i + 1}. ${person.name}`, [
            ["Months", `${person[key].length} mo`],
            ["Period", person[key].map((m) => analysis!.month_labels[m] ?? m).join(", ")],
          ], person.name),
        )
        .join("");
      return `
        <section class="panel table-panel hide-mobile" style="margin-bottom:16px">
          <h3 style="padding:14px 16px 0">${label} <span class="posting-count">${people.length} people</span></h3>
          <table class="analysis-table">
            <thead><tr><th>Name</th><th class="num">Months</th><th>Period</th></tr></thead>
            <tbody>${rows.map((item) => item.row).join("")}</tbody>
          </table>
          ${renderPaginator(tid, people.length)}
        </section>
        <section class="mobile-section card-list analysis-card-list">
          <h3>${label} <span class="posting-count">${people.length} people</span></h3>
          ${cards}
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

  const TL_TID = "promotions-timeline";
  const PP_TID = "promotions-by-person";
  const PROMO_PAGE = 15;

  const allTimelineItems = analysis.months.flatMap((m) => {
    const label = analysis!.month_labels[m];
    return (timelineMap[label] ?? []).map((c) => ({ label, c }));
  });
  const tlOffset = getPage(TL_TID) * PROMO_PAGE;
  const timelineRows = paginate(allTimelineItems, TL_TID, PROMO_PAGE)
    .map(({ label, c }) => `
          <tr>
            <td>${label}</td>
            <td><button class="person-link" data-analysis-person="${escapeHtml(c.name)}">${escapeHtml(c.name)}</button></td>
            <td>${analysisCallLevelLabel(c.from)}</td>
            <td>→</td>
            <td><strong>${analysisCallLevelLabel(c.to)}</strong></td>
          </tr>
        `)
    .join("");
  const timelineCards = paginate(allTimelineItems, TL_TID, PROMO_PAGE)
    .map(({ label, c }) =>
      renderAnalysisDataCard(c.name, [
        ["Month", label],
        ["From", analysisCallLevelLabel(c.from)],
        ["To", analysisCallLevelLabel(c.to)],
      ], c.name),
    )
    .join("");

  const ppOffset = getPage(PP_TID) * PROMO_PAGE;
  const personRows = paginate(promoted, PP_TID, PROMO_PAGE)
    .map(
      (p, i) => `
        <tr>
          <td><button class="person-link" data-analysis-person="${escapeHtml(p.name)}">${ppOffset + i + 1}. ${escapeHtml(p.name)}</button></td>
          <td>${p.promotions.map((pr) => `${analysis!.month_labels[pr.month] ?? pr.month}: ${analysisCallLevelLabel(pr.from)} → ${analysisCallLevelLabel(pr.to)}`).join("<br>")}</td>
        </tr>
      `,
    )
    .join("");
  const personCards = paginate(promoted, PP_TID, PROMO_PAGE)
    .map((p, i) =>
      renderAnalysisDataCard(`${ppOffset + i + 1}. ${p.name}`, [
        [
          "Changes",
          p.promotions
            .map((pr) => `${analysis!.month_labels[pr.month] ?? pr.month}: ${analysisCallLevelLabel(pr.from)} -> ${analysisCallLevelLabel(pr.to)}`)
            .join("<br>"),
        ],
      ], p.name),
    )
    .join("");

  return `
    <div class="analytics-grid">
      <section class="panel table-panel hide-mobile">
        <h3 style="padding:14px 16px 0">Promotion Timeline</h3>
        <table class="analysis-table">
          <thead><tr><th>Month</th><th>Person</th><th>From</th><th></th><th>To</th></tr></thead>
          <tbody>${timelineRows || `<tr><td colspan="5" class="empty">No promotions detected.</td></tr>`}</tbody>
        </table>
        ${renderPaginator(TL_TID, allTimelineItems.length, PROMO_PAGE)}
      </section>
      <section class="panel table-panel hide-mobile">
        <h3 style="padding:14px 16px 0">Promotions by Person</h3>
        <table class="analysis-table">
          <thead><tr><th>Name</th><th>Call Level Changes</th></tr></thead>
          <tbody>${personRows || `<tr><td colspan="2" class="empty">No promotions.</td></tr>`}</tbody>
        </table>
        ${renderPaginator(PP_TID, promoted.length, PROMO_PAGE)}
      </section>
    </div>
    <section class="mobile-section card-list analysis-card-list">
      <h3>Promotion Timeline</h3>
      ${timelineCards || `<p class="empty">No promotions detected.</p>`}
    </section>
    <section class="mobile-section card-list analysis-card-list">
      <h3>Promotions by Person</h3>
      ${personCards || `<p class="empty">No promotions.</p>`}
    </section>
  `;
}

// ── Person Modal ──────────────────────────────────────────────────────────────
function renderAnalysisPersonModal(person: AnalysisPerson): string {
  if (!analysis) return "";
  const allLevels = Object.values(person.call_levels);
  const uniqueLevels = Array.from(new Set(allLevels)).map(analysisCallLevelLabel);
  const units = Array.from(new Set(Object.values(person.units).filter(Boolean)));
  const popupSubtitle = [uniqueLevels.join(" -> "), units.join(", ")].filter(Boolean).join(" | ");

  const dutyLoadMetrics: Array<[string, number]> = [
    ["Total 24hr", person.total_24hr],
    ["Weekend 24hr", person.total_weekend_24hr],
    ["Weekday 24hr", person.total_weekday_24hr],
    ["5th Call", person.fifth_call],
    ["5th Wknd", person.fifth_call_weekend],
  ];
  const campusMetrics: Array<[string, number]> = [
    ["Main Calls", person.main_24hr],
    ["CB Calls", person.cb_24hr],
    ["RC Calls", person.rc_24hr],
    ["RC 12hr", person.rc12hr],
  ];
  const specialMetrics: Array<[string, number]> = [
    ["Schell", person.schell],
    ["Floating", person.floating],
    ["Caesar A", person.caesar_a],
    ["Caesar B", person.caesar_b],
    ["CART", person.cart],
    ["PAC", person.pac],
    ["Shifts", person.shift],
  ];

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
            <p>${escapeHtml(popupSubtitle || `${person.months_active.length} active months`)}</p>
          </div>
          <button class="modal-close" data-close-person-modal aria-label="Close">x</button>
        </header>
        <div class="person-modal-body">
          ${renderPersonMetricGroup("Duty Load", dutyLoadMetrics)}
          ${renderPersonMetricGroup("Campus Calls", campusMetrics)}
          ${renderPersonMetricGroup("Special Duties", specialMetrics)}
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
  { id: "overview", label: "Board Summary" },
  { id: "personnel", label: "People" },
  { id: "weekend", label: "Weekend Load" },
  { id: "duty-types", label: "Duty Mix" },
  { id: "cart-schell", label: "CART / Schell" },
  { id: "fifth-call", label: "5th Call" },
  { id: "shifts-pac", label: "PAC / Shifts" },
  { id: "postings", label: "Postings" },
  { id: "promotions", label: "Call Changes" },
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
  if (!isAdminUser()) {
    void renderOverview();
    return;
  }

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
  if (!isAdminUser()) {
    await renderOverview();
    return;
  }

  const status = await getHistoricalImportStatus();
  viewRoot.innerHTML = `
    <section class="summary-grid">
      ${metricCard(status.people, "People")}
      ${metricCard(status.duty_assignments, "Duty assignments")}
      ${metricCard(status.postings, "Unit postings")}
    </section>
    <section class="summary-grid">
      ${metricCard(status.duty_slots, "Duty slots")}
      ${metricCard(status.import_batches, "Import batches")}
      ${metricCard(status.import_warnings, "Import warnings")}
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
    "CO_4TH_CALL": "Co 4th Call",
    "4TH_CALL": "4th Call",
    "5TH_CALL": "5th Call",
    "PAIN": "Pain",
    "SICU": "SICU",
    "DRP": "DRP",
    "NEURO_ICU": "Neuro ICU",
    "PAC": "PAC",
    "OTHER_SPECIAL": "Other Special",
  }[value ?? ""] ?? value ?? "Unassigned";
}

function normalizeCallLevel(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  if (normalized.includes("1ST_CALL") || normalized.includes("1ST")) return "1ST_CALL";
  if (normalized.includes("2ND_CALL") || normalized.includes("2ND")) return "2ND_CALL";
  if (normalized.includes("3RD_CALL") || normalized.includes("3RD") || normalized === "DM_PDF") return "3RD_CALL";
  if (normalized.includes("CO_4TH") || normalized.includes("CO4TH")) return "CO_4TH_CALL";
  if (normalized.includes("4TH_CALL") || normalized.includes("4TH")) return "4TH_CALL";
  if (normalized.includes("5TH_CALL") || normalized.includes("5TH")) return "5TH_CALL";
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
      const matchesStatus = memberStatusFilter === "all" || member.active_status === memberStatusFilter;
      return matchesSearch && matchesPosition && matchesCallLevel && matchesStatus;
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
      const position = memberPosition(member);
      const callLevel = callLevelLabel(normalizeCallLevel(member.call_level));
      const callLevelCell = isAdminUser()
        ? `
            <select class="call-level-select" data-call-level="${member.id}" id="call-level-${member.id}" aria-label="Call level for ${member.canonical_name}">
              ${renderCallLevelChoices(member.call_level)}
            </select>
          `
        : `<span class="call-level-readonly">${callLevel}</span>`;
      return `
        <tr>
          <td class="member-name-cell">
            <strong>${member.canonical_name}</strong>
            <small>${position}</small>
          </td>
          <td><span class="status-dot ${statusClass}">${member.active_status}</span></td>
          <td>${callLevelCell}</td>
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
  const counts = members.reduce<Record<string, number>>((acc, member) => {
    const position = memberPosition(member);
    acc[position] = (acc[position] ?? 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts)
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
        const statusClass = member.active_status === "active" ? "active" : "inactive";
        const callLevel = callLevelLabel(normalizeCallLevel(member.call_level));
        const callLevelControl = isAdminUser()
          ? `
              <select class="call-level-select" data-call-level="${member.id}" aria-label="Call level for ${member.canonical_name}">
                ${renderCallLevelChoices(member.call_level)}
              </select>
            `
          : `<small>${callLevel}</small>`;
        return `
        <article class="member-card">
          <div>
            <strong>${member.canonical_name}</strong>
            <small><span class="status-dot ${statusClass}">${member.active_status}</span></small>
            <small>${memberPosition(member)}</small>
          </div>
          ${callLevelControl}
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


function addDaysIso(dateIso: string, offset: number): string {
  const [year, month, day] = dateIso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + offset));
  return date.toISOString().slice(0, 10);
}

function formatIsoDay(dateIso: string): string {
  return new Date(`${dateIso}T00:00:00Z`).toLocaleDateString(undefined, {
    day: "numeric",
    timeZone: "UTC",
    weekday: "short",
  });
}

function leaveTypeLabel(value: string): string {
  return value.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}

function leaveStatusLabel(value: string): string {
  return (
    ({
      approved: "Approved",
      requested: "Requested",
      imported_pending_review: "Imported, Pending Review",
      rejected: "Rejected",
      cancelled: "Cancelled",
      canceled: "Cancelled",
    } as Record<string, string>)[value] ?? leaveTypeLabel(value)
  );
}

function displayUnitName(value: string | null): string {
  if (!value) return "Unit not assigned";
  return value
    .replace(/\bUNIT\b/g, "Unit")
    .replace(/\s+/g, " ")
    .trim();
}

function displayPostingLabel(value: string | null): string {
  if (!value) return "No unit posting";
  return callLevelLabel(normalizeCallLevel(value));
}

function previewStatusLabel(value: string): string {
  return (
    ({
      matched: "Matched",
      needs_review: "Needs Review",
    } as Record<string, string>)[value] ?? leaveTypeLabel(value)
  );
}

function matchMethodLabel(value: string | null | undefined): string {
  return (
    ({
      normalized_exact: "Exact name match",
      ambiguous_exact: "Ambiguous name",
    } as Record<string, string>)[value ?? ""] ?? leaveTypeLabel(value ?? "")
  );
}

function renderLeaveMemberOptions(selected = ""): string {
  return members
    .map(
      (member) =>
        `<option value="${member.id}" ${member.id === selected ? "selected" : ""}>${escapeHtml(member.canonical_name)}</option>`,
    )
    .join("");
}

function renderLeaveBreakdown(title: string, values: Record<string, number>): string {
  const rows = Object.entries(values)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([label, value]) => {
      const displayLabel = title.toLowerCase().includes("call level")
        ? callLevelLabel(normalizeCallLevel(label))
        : displayUnitName(label);
      return `<div class="category-pill"><span>${escapeHtml(displayLabel)}</span><strong>${value}</strong></div>`;
    })
    .join("");
  return `
    <article class="panel">
      <h3>${statLabel(title)}</h3>
      <div class="category-grid">${rows || `<p class="empty-state">No data.</p>`}</div>
    </article>
  `;
}

const CALL_LEVEL_ORDER = [
  "1ST_CALL",
  "2ND_CALL",
  "3RD_CALL",
  "4TH_CALL",
  "CO_4TH_CALL",
  "5TH_CALL",
  "Unassigned",
];

function callLevelSortValue(callLevel: string): number {
  const normalized = normalizeCallLevel(callLevel) ?? "Unassigned";
  const index = CALL_LEVEL_ORDER.indexOf(normalized);
  return index >= 0 ? index : CALL_LEVEL_ORDER.length;
}

function leaveDayEntries(day: string): LeaveDayEntry[] {
  return leaveCalendar?.days[day] ?? [];
}

function renderLeaveCalendarDays(): string {
  if (!leaveCalendar) return "";
  const start = leaveCalendar.summary.starts_on;
  const end = leaveCalendar.summary.ends_on;
  const days: string[] = [];
  for (let day = start; day <= end; day = addDaysIso(day, 1)) {
    days.push(day);
  }
  return days
    .map((day) => {
      const entries = leaveCalendar!.days[day] ?? [];
      const pressure = entries.length >= 6 ? "high" : entries.length >= 3 ? "watch" : entries.length ? "normal" : "";
      return `
        <button class="leave-day-card ${pressure ? `leave-pressure-${pressure}` : ""}" type="button" data-leave-day="${day}" aria-label="${entries.length} leave request${entries.length === 1 ? "" : "s"} on ${day}">
          <span>${formatIsoDay(day)}</span>
          <strong>${entries.length}</strong>
          <small>${entries.slice(0, 3).map((entry) => escapeHtml(entry.person_name)).join(", ") || "No leave"}</small>
        </button>
      `;
    })
    .join("");
}

function renderLeaveDayCallGroups(day: string): string {
  const entries = leaveDayEntries(day);
  if (!entries.length) {
    return `<p class="empty">No leave requests recorded for this day.</p>`;
  }
  const groups = entries.reduce<Record<string, LeaveDayEntry[]>>((acc, entry) => {
    const key = entry.call_level || "Unassigned";
    acc[key] = acc[key] ?? [];
    acc[key].push(entry);
    return acc;
  }, {});
  return Object.entries(groups)
    .sort(([a], [b]) => callLevelSortValue(a) - callLevelSortValue(b) || a.localeCompare(b))
    .map(([callLevel, groupEntries]) => `
      <section class="leave-day-call-group">
        <header>
          <h4>${escapeHtml(callLevelLabel(normalizeCallLevel(callLevel)))}</h4>
          <span>${groupEntries.length}</span>
        </header>
        <div class="leave-day-person-list">
          ${groupEntries
            .sort((a, b) => a.person_name.localeCompare(b.person_name))
            .map((entry) => `
              <article class="leave-day-person">
                <strong>${escapeHtml(entry.person_name)}</strong>
                <small>${escapeHtml(displayUnitName(entry.unit))} / ${escapeHtml(displayPostingLabel(entry.posting_type))}</small>
                <small>${escapeHtml(leaveTypeLabel(entry.leave_type))} / ${escapeHtml(leaveTypeLabel(entry.leave_slot))} / ${escapeHtml(leaveStatusLabel(entry.status))}</small>
              </article>
            `)
            .join("")}
        </div>
      </section>
    `)
    .join("");
}

function renderLeaveDayModal(day: string): string {
  const entries = leaveDayEntries(day);
  const approved = entries.filter((entry) => entry.status === "approved").length;
  const requested = entries.filter((entry) => entry.status === "requested" || entry.status === "imported_pending_review").length;
  return `
    <div class="modal-backdrop" id="leave-day-modal">
      <section class="person-modal leave-day-modal" role="dialog" aria-modal="true" aria-labelledby="leave-day-modal-title">
        <header class="person-modal-header">
          <div>
            <h3 id="leave-day-modal-title">${escapeHtml(formatIsoDay(day))} Leave Requests</h3>
            <p>${escapeHtml(day)} / grouped by department call level</p>
          </div>
          <button class="modal-close" data-close-leave-day-modal aria-label="Close">x</button>
        </header>
        <div class="person-modal-body leave-day-modal-body">
          <div class="audit-chip-row">
            <span><strong>${entries.length}</strong> ${statLabel("total")}</span>
            <span><strong>${approved}</strong> ${statLabel("approved")}</span>
            <span><strong>${requested}</strong> ${statLabel("requested/review")}</span>
            <span><strong>${new Set(entries.map((entry) => entry.call_level || "Unassigned")).size}</strong> ${statLabel("call groups")}</span>
          </div>
          ${renderLeaveDayCallGroups(day)}
        </div>
      </section>
    </div>
  `;
}

function openLeaveDayModal(day: string) {
  document.querySelector("#leave-day-modal")?.remove();
  document.body.insertAdjacentHTML("beforeend", renderLeaveDayModal(day));
}

function closeLeaveDayModal() {
  document.querySelector("#leave-day-modal")?.remove();
}

function renderLeaveRows(): string {
  return leaveRequests
    .map(
      (leave) => `
        <tr>
          <td><strong>${escapeHtml(leave.person.canonical_name)}</strong><small>${escapeHtml(callLevelLabel(normalizeCallLevel(leave.person.call_level)))}</small></td>
          <td>${leave.starts_on}${leave.starts_on !== leave.ends_on ? ` to ${leave.ends_on}` : ""}</td>
          <td>${escapeHtml(leaveTypeLabel(leave.leave_slot))}</td>
          <td>${escapeHtml(leaveTypeLabel(leave.leave_type))}</td>
          <td><span class="status-dot ${leave.status === "approved" ? "active" : "inactive"}">${escapeHtml(leaveStatusLabel(leave.status))}</span></td>
          <td class="num">${leave.days}</td>
          <td><button class="icon-button" data-cancel-leave="${leave.id}" ${leave.status === "cancelled" ? "disabled" : ""}>Cancel</button></td>
        </tr>
      `,
    )
    .join("");
}

function renderLeaveCards(): string {
  return leaveRequests
    .map(
      (leave) => `
        <article class="data-card">
          <div class="data-card-title">${escapeHtml(leave.person.canonical_name)}</div>
          <div class="data-card-row"><span class="data-card-label">Dates</span><span class="data-card-value">${leave.starts_on}${leave.starts_on !== leave.ends_on ? ` to ${leave.ends_on}` : ""}</span></div>
          <div class="data-card-row"><span class="data-card-label">Slot</span><span class="data-card-value">${escapeHtml(leaveTypeLabel(leave.leave_slot))}</span></div>
          <div class="data-card-row"><span class="data-card-label">Type</span><span class="data-card-value">${escapeHtml(leaveTypeLabel(leave.leave_type))}</span></div>
          <div class="data-card-row"><span class="data-card-label">Status</span><span class="data-card-value">${escapeHtml(leaveStatusLabel(leave.status))}</span></div>
          <div class="data-card-row"><button class="icon-button" data-cancel-leave="${leave.id}" ${leave.status === "cancelled" ? "disabled" : ""}>Cancel</button></div>
        </article>
      `,
    )
    .join("");
}

function renderLeaveImportPreview(): string {
  if (!leaveImportPreview) {
    return `<p class="empty">Upload a CSV or XLSX leave file to preview name matching and date parsing before importing.</p>`;
  }
  const rows = leaveImportPreview.rows.slice(0, 25).map((row) => `
    <tr>
      <td>${row.row_number}</td>
      <td><strong>${escapeHtml(row.raw_person_name)}</strong><small>${escapeHtml(row.person_name ?? row.suggested_person_name ?? "Unresolved")}</small></td>
      <td>${row.starts_on ?? ""} to ${row.ends_on ?? ""}</td>
      <td>${escapeHtml(row.leave_type)} / ${escapeHtml(row.leave_slot)}</td>
      <td><small>${escapeHtml(row.sheet_name ?? "")}</small><small>${escapeHtml(row.source_format ? leaveTypeLabel(row.source_format) : "")}${row.match_method ? ` / ${escapeHtml(matchMethodLabel(row.match_method))}` : ""}</small></td>
      <td><span class="status ${row.preview_status === "matched" ? "ok" : "error"}">${escapeHtml(previewStatusLabel(row.preview_status))}</span></td>
      <td>${row.issues.map((issue) => `<small>${escapeHtml(issue)}</small>`).join("") || "<small>None</small>"}</td>
    </tr>
  `).join("");
  const canApply = leaveImportPreview.matched_rows > 0 && leaveImportFile;
  return `
    <div class="audit-chip-row">
      <span><strong>${leaveImportPreview.total_rows}</strong> rows</span>
      <span><strong>${leaveImportPreview.matched_rows}</strong> matched</span>
      <span><strong>${leaveImportPreview.unresolved_rows}</strong> unresolved</span>
      <span><strong>${leaveImportPreview.invalid_rows}</strong> invalid</span>
      <span><strong>${leaveImportPreview.sheets?.length ?? 0}</strong> sheets</span>
    </div>
    ${leaveImportPreview.parser_warnings?.length ? `<div class="issue-list">${leaveImportPreview.parser_warnings.map((warning) => `<p>${escapeHtml(warning)}</p>`).join("")}</div>` : ""}
    <div class="topbar-actions" style="margin:12px 0;">
      <button class="primary" id="apply-leave-import" ${canApply ? "" : "disabled"}>Apply Matched Rows</button>
    </div>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Row</th><th>Member</th><th>Dates</th><th>Type / Slot</th><th>Source</th><th>Status</th><th>Issues</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="7" class="empty">No preview rows.</td></tr>`}</tbody>
      </table>
    </div>
  `;
}

function renderLeavePressurePanel(): string {
  if (!leavePressure) return "";
  const busiest = [...leavePressure.days].sort((a, b) => b.total_people - a.total_people).slice(0, 7);
  return `
    <section class="panel">
      <h3>Generator Leave Pressure</h3>
      <div class="analytics-grid">
        ${renderLeaveBreakdown("Pressure By Call Level", leavePressure.call_level_totals)}
        ${renderLeaveBreakdown("Pressure By Unit", leavePressure.unit_totals)}
      </div>
      <div class="card-list compact-card-list">
        ${busiest.map((day) => `
          <article class="data-card">
            <div class="data-card-row"><span class="data-card-label">Date</span><span class="data-card-value">${day.date}</span></div>
            <div class="data-card-row"><span class="data-card-label">People</span><span class="data-card-value">${day.total_people}</span></div>
            <div class="data-card-row"><span class="data-card-label">Blocking</span><span class="data-card-value">${day.blocking_people}</span></div>
          </article>
        `).join("") || `<p class="empty">No active leave pressure for this month.</p>`}
      </div>
    </section>
  `;
}

async function renderLeave() {
  setHeader("Leave", "Leave calendar and availability");
  if (!viewRoot) return;
  viewRoot.innerHTML = `<section class="panel"><h3>Loading leave...</h3></section>`;
  try {
    if (!members.length) members = await getMembers();
    [leaveCalendar, leaveRequests, leavePressure] = await Promise.all([
      getLeaveCalendar(leaveMonth),
      getLeaveRequests(leaveMonth),
      getLeavePressure(leaveMonth),
    ]);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Failed to load leave", "error");
    viewRoot.innerHTML = `<section class="panel"><h3>Leave unavailable</h3><p>Unable to load leave calendar.</p></section>`;
    return;
  }
  const summary = leaveCalendar.summary;
  viewRoot.innerHTML = `
    <section class="roster-command">
      <div class="roster-command-header">
        <div>
          <h3>Leave Management</h3>
          <p>First layer: manually add approved/requested leave and review monthly leave pressure.</p>
        </div>
        <span class="audit-badge">${summary.month}</span>
      </div>
      <div class="member-filter-row">
        <label for="leave-month" class="visually-hidden">Leave month</label>
        <input id="leave-month" type="month" value="${leaveMonth}" aria-label="Leave month" />
      </div>
    </section>
    <section class="summary-grid four-col board-metrics">
      ${metricCard(summary.total_requests, "Leave requests", undefined, "metric-primary")}
      ${metricCard(summary.people_on_leave, "People on leave")}
      ${metricCard(summary.total_leave_days, "Total leave days")}
      ${metricCard(summary.busiest_day?.count ?? 0, "Highest day pressure", undefined, "metric-weekend")}
    </section>
    <section class="analytics-grid">
      ${renderLeaveBreakdown("By Call Level", summary.call_level_counts)}
      ${renderLeaveBreakdown("By Unit", summary.unit_counts)}
    </section>
    ${renderLeavePressurePanel()}
    <section class="panel leave-form-panel">
      <h3>Import Preview</h3>
      <form class="leave-form" id="leave-import-form">
        <label class="leave-notes">
          <span>CSV / XLSX file</span>
          <input id="leave-import-file" type="file" accept=".csv,.xls,.xlsx" />
        </label>
        <button class="primary" type="submit">Preview File</button>
      </form>
      ${renderLeaveImportPreview()}
    </section>
    <section class="panel leave-form-panel">
      <h3>Add Leave</h3>
      <form class="leave-form" id="leave-form">
        <label>
          <span>Member</span>
          <select id="leave-person" required>${renderLeaveMemberOptions()}</select>
        </label>
        <label>
          <span>Starts</span>
          <input id="leave-start" type="date" value="${summary.starts_on}" required />
        </label>
        <label>
          <span>Ends</span>
          <input id="leave-end" type="date" value="${summary.starts_on}" required />
        </label>
        <label>
          <span>Slot</span>
          <select id="leave-slot">
            <option value="FULL_DAY">Full day</option>
            <option value="AM">AM</option>
            <option value="PM">PM</option>
            <option value="NIGHT">Night</option>
            <option value="CUSTOM">Custom</option>
          </select>
        </label>
        <label>
          <span>Type</span>
          <select id="leave-type">
            <option value="ANNUAL_LEAVE">Annual leave</option>
            <option value="ACADEMIC_LEAVE">Academic leave</option>
            <option value="CONFERENCE">Conference</option>
            <option value="EXAM">Exam</option>
            <option value="SICK_LEAVE">Sick leave</option>
            <option value="OTHER">Other</option>
          </select>
        </label>
        <label>
          <span>Status</span>
          <select id="leave-status">
            <option value="approved">Approved</option>
            <option value="requested">Requested</option>
          </select>
        </label>
        <label class="leave-notes">
          <span>Notes</span>
          <input id="leave-notes" placeholder="Optional note" />
        </label>
        <button class="primary" type="submit">Add Leave</button>
      </form>
    </section>
    <section class="panel">
      <h3>Month Calendar</h3>
      <div class="leave-calendar-grid">${renderLeaveCalendarDays()}</div>
    </section>
    <section class="panel table-panel hide-mobile" style="margin-top:16px">
      <table>
        <thead><tr><th>Member</th><th>Dates</th><th>Slot</th><th>Type</th><th>Status</th><th class="num">Days</th><th></th></tr></thead>
        <tbody>${renderLeaveRows() || `<tr><td colspan="7" class="empty">No leave recorded for this month.</td></tr>`}</tbody>
      </table>
    </section>
    <section class="card-list">
      ${renderLeaveCards() || `<p class="empty">No leave recorded for this month.</p>`}
    </section>
  `;
}

const UNIT_POSTING_TYPES = [
  ["1ST_CALL", "1st Call"],
  ["2ND_CALL", "2nd Call"],
  ["3RD_CALL", "3rd Call"],
  ["4TH_CALL", "4th Call"],
  ["CO_4TH_CALL", "Co 4th Call"],
  ["5TH_CALL", "5th Call"],
  ["PAIN", "Pain"],
  ["SICU", "SICU"],
  ["DRP", "DRP"],
  ["NEURO_ICU", "Neuro ICU"],
  ["PAC", "PAC"],
  ["OTHER_SPECIAL", "Other Special"],
];

function renderUnitOptions(selected = ""): string {
  return units
    .map((unit) => `<option value="${unit.id}" ${unit.id === selected ? "selected" : ""}>${escapeHtml(unit.name)}</option>`)
    .join("");
}

function renderUnitPostingTypeOptions(selected = ""): string {
  return UNIT_POSTING_TYPES
    .map(([value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`)
    .join("");
}

function unitSummary(unitId: string) {
  return unitManagement?.unit_summaries.find((summary) => summary.unit_id === unitId) ?? null;
}

function unitAssignmentsFor(unitId: string): UnitAssignment[] {
  return unitAssignments.filter((assignment) => assignment.unit?.id === unitId);
}

function validationIssuesForUnit(unitId: string) {
  const assignmentIds = new Set(unitAssignmentsFor(unitId).map((assignment) => assignment.id));
  return (unitManagement?.validation_issues ?? []).filter(
    (issue) => issue.unit_id === unitId || (issue.posting_id ? assignmentIds.has(issue.posting_id) : false),
  );
}

function renderUnitAssignmentsByUnit(): string {
  if (!unitManagement) return "";
  if (!unitManagement.units.length) {
    return `<section class="panel"><p class="empty-state">No active units found. Add units through historical import or admin seed before assigning members.</p></section>`;
  }
  return unitManagement.units
    .map((unit) => {
      const assignments = unitAssignmentsFor(unit.id);
      const grouped = UNIT_POSTING_TYPES
        .map(([postingType, label]) => {
          const people = assignments.filter((assignment) => assignment.posting_type === postingType);
          if (!people.length) return "";
          return `
            <div class="unit-call-group">
              <span>${label}</span>
              <div class="unit-chip-row">
                ${people
                  .map(
                    (assignment) => `
                      <span class="unit-member-chip">
                        ${escapeHtml(assignment.person.canonical_name)}
                      </span>
                    `,
                  )
                  .join("")}
              </div>
            </div>
          `;
        })
        .join("");
      const summary = unitSummary(unit.id);
      const assigned = summary?.assigned_members ?? 0;
      const onLeave = summary?.people_with_leave ?? 0;
      const available = Math.max(0, assigned - onLeave);
      const unitIssues = validationIssuesForUnit(unit.id);
      return `
        <article class="unit-card" role="button" tabindex="0" data-open-unit-modal="${unit.id}" aria-label="Manage ${escapeHtml(unit.name)} unit">
          <header>
            <div>
              <h3>${escapeHtml(unit.name)}</h3>
              <p>${escapeHtml(unit.campus ?? unit.code)}</p>
            </div>
            <strong>${assignments.length}</strong>
          </header>
          <div class="audit-chip-row">
            <span><strong>${assigned}</strong> assigned</span>
            <span><strong>${onLeave}</strong> on leave</span>
            <span><strong>${available}</strong> roughly available</span>
            <span><strong>${summary?.leave_days ?? 0}</strong> leave days</span>
          </div>
          ${unitIssues.length ? `<span class="unit-warning-strip">${unitIssues.length} validation ${unitIssues.length === 1 ? "item" : "items"}</span>` : ""}
          ${grouped || `<p class="empty-state">No members assigned for this month.</p>`}
        </article>
      `;
    })
    .join("");
}

function renderUnitAssignmentRows(): string {
  return unitAssignments
    .map(
      (assignment) => `
        <tr>
          <td><strong>${escapeHtml(assignment.person.canonical_name)}</strong><small>${escapeHtml(assignment.person.call_level ?? "Unassigned")}</small></td>
          <td>${escapeHtml(assignment.unit?.name ?? "No unit")}</td>
          <td>${escapeHtml(callLevelLabel(assignment.posting_type))}</td>
          <td>${assignment.starts_on}${assignment.ends_on ? ` to ${assignment.ends_on}` : ""}</td>
          <td>${escapeHtml(assignment.notes ?? "")}</td>
          <td>
            <button class="icon-button" data-open-unit-modal="${assignment.unit?.id ?? ""}">Manage Unit</button>
          </td>
        </tr>
      `,
    )
    .join("");
}

function renderUnitValidationIssues(): string {
  const issues = unitManagement?.validation_issues ?? [];
  if (!issues.length) {
    return `<details class="panel quality-ok unit-validation-panel"><summary><span>Validation</span><span class="quality-status-badge">Clear</span></summary><p>No basic unit assignment issues found.</p></details>`;
  }
  const rows = issues
    .map(
      (issue) => `
        <div class="validation-row ${issue.severity}">
          <strong>${escapeHtml(issue.severity.toUpperCase())}</strong>
          <span>${escapeHtml(issue.message)}</span>
        </div>
      `,
    )
    .join("");
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.filter((issue) => issue.severity === "warning").length;
  return `
    <details class="panel quality-warning unit-validation-panel">
      <summary>
        <span>Validation warnings</span>
        <span class="quality-status-badge">${errors} errors / ${warnings} warnings</span>
      </summary>
      <div class="validation-list">${rows}</div>
    </details>
  `;
}

function renderUnitIssueDetails(unitId: string): string {
  const issues = validationIssuesForUnit(unitId);
  if (!issues.length) {
    return `
      <details class="unit-modal-validation">
        <summary>Validation <span>Clear</span></summary>
        <p>No issues found for this unit.</p>
      </details>
    `;
  }
  return `
    <details class="unit-modal-validation">
      <summary>Validation <span>${issues.length}</span></summary>
      <div class="validation-list">
        ${issues
          .map(
            (issue) => `
              <div class="validation-row ${issue.severity}">
                <strong>${escapeHtml(issue.severity.toUpperCase())}</strong>
                <span>${escapeHtml(issue.message)}</span>
              </div>
            `,
          )
          .join("")}
      </div>
    </details>
  `;
}

function renderUnitAssignmentEditors(unitId: string): string {
  const assignments = unitAssignmentsFor(unitId);
  if (!assignments.length) {
    return `<p class="empty-state">No members assigned yet. Add the first member below.</p>`;
  }
  return assignments
    .map(
      (assignment) => `
        <form class="unit-assignment-editor" data-unit-row-form="${assignment.id}">
          <label>
            <span>Member</span>
            <select name="person_id" required>${renderLeaveMemberOptions(assignment.person.id)}</select>
          </label>
          <label>
            <span>Unit</span>
            <select name="unit_id" required>${renderUnitOptions(assignment.unit?.id ?? unitId)}</select>
          </label>
          <label>
            <span>Posting</span>
            <select name="posting_type" required>${renderUnitPostingTypeOptions(assignment.posting_type)}</select>
          </label>
          <label>
            <span>Starts</span>
            <input name="starts_on" type="date" value="${assignment.starts_on}" required />
          </label>
          <label>
            <span>Ends</span>
            <input name="ends_on" type="date" value="${assignment.ends_on ?? ""}" />
          </label>
          <label class="unit-editor-notes">
            <span>Notes</span>
            <input name="notes" value="${escapeHtml(assignment.notes ?? "")}" placeholder="Optional note" />
          </label>
          <div class="unit-editor-actions">
            <button class="primary" type="submit">Save</button>
            <button class="icon-button" type="button" data-delete-unit-assignment="${assignment.id}">Remove</button>
          </div>
        </form>
      `,
    )
    .join("");
}

function renderUnitModal(unit: UnitRead): string {
  if (!unitManagement) return "";
  const assignments = unitAssignmentsFor(unit.id);
  const summary = unitSummary(unit.id);
  const assigned = summary?.assigned_members ?? 0;
  const onLeave = summary?.people_with_leave ?? 0;
  const available = Math.max(0, assigned - onLeave);
  return `
    <div class="modal-backdrop" id="unit-management-modal">
      <section class="person-modal unit-modal" role="dialog" aria-modal="true" aria-labelledby="unit-modal-title">
        <header class="person-modal-header">
          <div>
            <h3 id="unit-modal-title">${escapeHtml(unit.name)}</h3>
            <p>${escapeHtml(unitManagement.month)} unit assignment workspace</p>
          </div>
          <button class="modal-close" data-close-unit-modal aria-label="Close">x</button>
        </header>
        <div class="person-modal-body unit-modal-body">
          <div class="audit-chip-row">
            <span><strong>${assigned}</strong> assigned</span>
            <span><strong>${onLeave}</strong> on leave</span>
            <span><strong>${available}</strong> roughly available</span>
            <span><strong>${summary?.leave_days ?? 0}</strong> leave days</span>
          </div>
          ${renderUnitIssueDetails(unit.id)}
          <h4>Assigned Members</h4>
          <div class="unit-editor-list">${renderUnitAssignmentEditors(unit.id)}</div>
          <h4>Add Member</h4>
          <form class="leave-form unit-modal-form" id="unit-assignment-form" data-modal-unit-id="${unit.id}">
            <label>
              <span>Member</span>
              <select id="unit-person" required>${renderLeaveMemberOptions()}</select>
            </label>
            <label>
              <span>Unit</span>
              <select id="unit-select" required>${renderUnitOptions(unit.id)}</select>
            </label>
            <label>
              <span>Call level / posting</span>
              <select id="unit-posting-type" required>${renderUnitPostingTypeOptions()}</select>
            </label>
            <label>
              <span>Starts</span>
              <input id="unit-start" type="date" value="${unitManagement.starts_on}" required />
            </label>
            <label>
              <span>Ends</span>
              <input id="unit-end" type="date" value="${unitManagement.ends_on}" />
            </label>
            <label class="leave-notes">
              <span>Notes</span>
              <input id="unit-notes" placeholder="Optional note" />
            </label>
            <button class="primary" type="submit">Add Assignment</button>
          </form>
        </div>
      </section>
    </div>
  `;
}

function openUnitModal(unitId: string) {
  document.querySelector("#unit-management-modal")?.remove();
  const unit = units.find((item) => item.id === unitId);
  if (!unit || !viewRoot) return;
  unitModalUnitId = unitId;
  unitEditingAssignmentId = null;
  viewRoot.insertAdjacentHTML("beforeend", renderUnitModal(unit));
}

function closeUnitModal() {
  unitModalUnitId = null;
  unitEditingAssignmentId = null;
  document.querySelector("#unit-management-modal")?.remove();
}

function unitAssignmentPayloadFromForm(form: HTMLFormElement) {
  return {
    person_id:
      form.querySelector<HTMLSelectElement>("[name='person_id']")?.value ??
      form.querySelector<HTMLSelectElement>("#unit-person")?.value ??
      "",
    unit_id:
      form.querySelector<HTMLSelectElement>("[name='unit_id']")?.value ??
      form.querySelector<HTMLSelectElement>("#unit-select")?.value ??
      "",
    posting_type:
      form.querySelector<HTMLSelectElement>("[name='posting_type']")?.value ??
      form.querySelector<HTMLSelectElement>("#unit-posting-type")?.value ??
      "",
    starts_on:
      form.querySelector<HTMLInputElement>("[name='starts_on']")?.value ??
      form.querySelector<HTMLInputElement>("#unit-start")?.value ??
      "",
    ends_on:
      form.querySelector<HTMLInputElement>("[name='ends_on']")?.value ??
      form.querySelector<HTMLInputElement>("#unit-end")?.value ??
      "",
    notes:
      form.querySelector<HTMLInputElement>("[name='notes']")?.value ??
      form.querySelector<HTMLInputElement>("#unit-notes")?.value ??
      "",
  };
}

async function renderUnitManagement() {
  setHeader("Unit Management", "Monthly unit assignments");
  if (!viewRoot) return;
  viewRoot.innerHTML = `<section class="panel"><h3>Loading unit management...</h3></section>`;
  try {
    if (!members.length) members = await getMembers();
    [units, unitManagement] = await Promise.all([getUnits(), getUnitManagementMonth(unitMonth)]);
    unitAssignments = unitManagement.assignments;
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Failed to load unit management", "error");
    viewRoot.innerHTML = `<section class="panel"><h3>Unit Management unavailable</h3><p>Unable to load monthly unit assignments.</p></section>`;
    return;
  }
  const errors = unitManagement.validation_issues.filter((issue) => issue.severity === "error").length;
  const warnings = unitManagement.validation_issues.filter((issue) => issue.severity === "warning").length;
  const leaveDays = unitManagement.unit_summaries.reduce((sum, item) => sum + item.leave_days, 0);
  viewRoot.innerHTML = `
    <section class="roster-command">
      <div class="roster-command-header">
        <div>
          <h3>Unit Management</h3>
          <p>Assign members to monthly units by call level. Leave-aware summaries are shown for planning.</p>
        </div>
        <span class="audit-badge">${unitManagement.month}</span>
      </div>
      <div class="member-filter-row">
        <label for="unit-month" class="visually-hidden">Unit month</label>
        <input id="unit-month" type="month" value="${unitMonth}" aria-label="Unit month" />
      </div>
    </section>
    <section class="summary-grid four-col board-metrics">
      ${metricCard(unitAssignments.length, "Assignments", undefined, "metric-primary")}
      ${metricCard(unitManagement.units.length, "Active units")}
      ${metricCard(leaveDays, "Unit leave days")}
      ${metricCard(`${errors}/${warnings}`, "Errors / warnings", undefined, "metric-weekend")}
    </section>
    ${renderUnitValidationIssues()}
    <section class="unit-card-grid">${renderUnitAssignmentsByUnit()}</section>
    <section class="panel table-panel hide-mobile" style="margin-top:16px">
      <table>
        <thead><tr><th>Member</th><th>Unit</th><th>Call level/posting</th><th>Dates</th><th>Notes</th><th></th></tr></thead>
        <tbody>${renderUnitAssignmentRows() || `<tr><td colspan="6" class="empty">No unit assignments for this month.</td></tr>`}</tbody>
      </table>
    </section>
  `;
  if (unitModalUnitId) {
    openUnitModal(unitModalUnitId);
  }
}

async function renderMembers() {
  setHeader("Members", "Department members");
  if (!viewRoot) return;
  viewRoot.innerHTML = `<section class="panel"><h3>Loading members...</h3></section>`;
  if (isAdminUser()) {
    [members, invalidMembers, memberAudit] = await Promise.all([
      getMembers(),
      getInvalidMembers(),
      getMemberAudit(),
    ]);
  } else {
    members = await getMembers();
    invalidMembers = { count: 0, people: [] };
    memberAudit = null;
  }
  renderMembersView();
}

function renderMembersView() {
  if (!viewRoot) return;
  const rows = filteredMembers();
  const activeMembers = members.filter((member) => member.active_status === "active").length;
  const historicalMembers = members.length - activeMembers;
  const callLevelOrder: [string, string][] = [
    ["1ST_CALL", "1st"],
    ["2ND_CALL", "2nd"],
    ["3RD_CALL", "3rd"],
    ["4TH_CALL", "4th"],
    ["5TH_CALL", "5th"],
  ];
  const callLevelCounts = callLevelOrder.map(([key, label]) => ({
    key,
    label,
    count: members.filter((m) => normalizeCallLevel(m.call_level) === key).length,
  }));
  const unassignedCount = members.filter((m) => !m.call_level).length;
  const adminTools = isAdminUser() && memberAudit
    ? `
        <details class="member-tools">
          <summary>Admin tools</summary>
          <div class="member-tool-row">
            <form class="inline-form" id="create-member-form" style="display:contents;">
              <label for="new-member-name" class="visually-hidden">New member name</label>
              <input id="new-member-name" placeholder="New member name" aria-label="New member name" />
              <button class="primary" type="submit" id="create-member">Create Member</button>
            </form>
            <button class="icon-button" id="cleanup-members">Clean Invalid Names</button>
            <button class="icon-button" id="prefill-call-levels">Prefill Call Levels</button>
            <button class="icon-button" id="reconcile-roster">Reconcile Trusted Roster</button>
          </div>
        </details>
      `
    : "";
  const adminAudit = isAdminUser() && memberAudit
    ? `
        <div class="audit-chip-row admin-only-inline">
          <span><strong>${memberAudit.invalid_members}</strong> invalid</span>
          <span><strong>${memberAudit.duplicate_groups}</strong> duplicates</span>
          <span><strong>${memberAudit.missing_call_levels}</strong> unassigned calls</span>
        </div>
      `
    : "";

  viewRoot.innerHTML = `
    <section class="roster-command">
      <div class="roster-command-header">
        <div>
          <h3>Department Members</h3>
          <p>Search the department list by name, position, or call level.</p>
        </div>
        <span class="audit-badge">${rows.length} shown</span>
      </div>
      <div class="audit-chip-row">
        <span><strong id="visible-member-count">${rows.length}</strong> shown</span>
        <span><strong>${members.length}</strong> total</span>
        <span><strong>${activeMembers}</strong> active</span>
        <span><strong>${historicalMembers}</strong> historical</span>
      </div>
      <div class="call-level-chip-row">
        ${callLevelCounts.map(({ key, label, count }) => `
          <button class="call-chip ${memberCallLevelFilter === callLevelLabel(key) ? "selected" : ""}" data-call-chip="${callLevelLabel(key)}" title="Filter to ${label} Call members">
            <span class="call-chip-label">${label}</span>
            <strong class="call-chip-count">${count}</strong>
          </button>`).join("")}
        <span class="call-chip unassigned-chip" title="Members with no call level assigned">
          <span class="call-chip-label">Unassigned</span>
          <strong class="call-chip-count">${unassignedCount}</strong>
        </span>
      </div>
      ${adminAudit}
      <div class="member-control-bar">
        <div class="member-filter-row">
          <div class="status-toggle-group" role="group" aria-label="Filter by status">
            <button class="status-toggle ${memberStatusFilter === "active" ? "active" : ""}" data-member-status="active">Active</button>
            <button class="status-toggle ${memberStatusFilter === "all" ? "active" : ""}" data-member-status="all">All</button>
            <button class="status-toggle ${memberStatusFilter === "historical" ? "active" : ""}" data-member-status="historical">Historical</button>
          </div>
          <label for="member-search" class="visually-hidden">Search members</label>
          <input id="member-search" class="member-search-input" placeholder="Search members or positions" value="${memberSearch}" aria-label="Search members or positions" />
          <label for="member-position-filter" class="visually-hidden">Filter by position</label>
          <select id="member-position-filter" aria-label="Filter by position">${renderPositionOptions()}</select>
          <label for="member-call-filter" class="visually-hidden">Filter by call level</label>
          <select id="member-call-filter" aria-label="Filter by call level">${renderCallLevelFilterOptions()}</select>
          <button class="filter-clear-btn" id="clear-member-filters" aria-label="Clear all filters">Clear</button>
        </div>
        ${adminTools}
      </div>
    </section>
    <details class="panel disclosure-panel">
      <summary>Position Mix</summary>
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
  `;
}

function parseNumberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCsv(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

async function renderRotaRules() {
  setHeader("Rota Rules", "Rule foundation and duty dictionary");
  if (!viewRoot) return;
  if (!isAdminUser()) {
    await renderOverview();
    return;
  }
  viewRoot.innerHTML = `<section class="panel"><h3>Loading rota rules...</h3></section>`;
  try {
    rotaPhaseOneRules = await getRotaPhaseOneRules();
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Failed to load rota rules", "error");
    viewRoot.innerHTML = `<section class="panel"><h3>Rota rules unavailable</h3><p>Unable to load Phase 1 rule settings.</p></section>`;
    return;
  }

  const rules = rotaPhaseOneRules;
  const dutyRows = rules.duty_rules.map((rule, index) => `
    <tr>
      <td><strong>${escapeHtml(rule.label)}</strong><small>${escapeHtml(rule.key)}</small></td>
      <td><input data-rule-index="${index}" data-rule-field="label" value="${escapeHtml(rule.label)}" /></td>
      <td><input data-rule-index="${index}" data-rule-field="group" value="${escapeHtml(rule.group)}" /></td>
      <td><input data-rule-index="${index}" data-rule-field="duration_hours" type="number" min="0" max="48" value="${rule.duration_hours}" /></td>
      <td class="checkbox-cell"><input data-rule-index="${index}" data-rule-field="is_mandatory" type="checkbox" ${rule.is_mandatory ? "checked" : ""} /></td>
      <td class="checkbox-cell"><input data-rule-index="${index}" data-rule-field="is_adjustable" type="checkbox" ${rule.is_adjustable ? "checked" : ""} /></td>
      <td class="checkbox-cell"><input data-rule-index="${index}" data-rule-field="blocks_elective_same_day" type="checkbox" ${rule.blocks_elective_same_day ? "checked" : ""} /></td>
      <td class="checkbox-cell"><input data-rule-index="${index}" data-rule-field="blocks_elective_next_day" type="checkbox" ${rule.blocks_elective_next_day ? "checked" : ""} /></td>
      <td class="checkbox-cell"><input data-rule-index="${index}" data-rule-field="active" type="checkbox" ${rule.active ? "checked" : ""} /></td>
      <td><input data-rule-index="${index}" data-rule-field="allowed_call_levels" value="${escapeHtml(rule.allowed_call_levels.join(", "))}" placeholder="1ST_CALL, 2ND_CALL" /></td>
    </tr>
  `).join("");

  viewRoot.innerHTML = `
    <form id="rota-rules-form">
      <section class="panel action-panel">
        <div>
          <h3>Phase 1 Rule Version</h3>
          <p>${escapeHtml(rules.rule_version.name)}. These settings drive duty eligibility, rest, unit pressure, and future leave-aware slot generation.</p>
        </div>
        <button class="primary" type="submit" id="save-rota-rules">Save Rules</button>
      </section>
      <section class="summary-grid four-col">
        ${metricCard(rules.duty_rules.length, "Duty types")}
        ${metricCard(rules.rest_rules.minimum_gap_after_24hr_hours, "Rest hours")}
        ${metricCard(`${rules.unit_staffing_rules.warning_unavailable_percent}%`, "Warning threshold")}
        ${metricCard(`${rules.unit_staffing_rules.hard_block_unavailable_percent}%`, "Hard block threshold")}
      </section>
      <section class="panel">
        <h3>Guardrails</h3>
        <div class="form-grid">
          <label>Minimum gap after 24hr duty<input id="rule-rest-hours" type="number" min="0" max="168" value="${rules.rest_rules.minimum_gap_after_24hr_hours}" /></label>
          <label>Minimum available per unit<input id="rule-min-available" type="number" min="0" value="${rules.unit_staffing_rules.minimum_available_count}" /></label>
          <label>Warning unavailable %<input id="rule-warning-percent" type="number" min="0" max="100" value="${rules.unit_staffing_rules.warning_unavailable_percent}" /></label>
          <label>Hard block unavailable %<input id="rule-hard-percent" type="number" min="0" max="100" value="${rules.unit_staffing_rules.hard_block_unavailable_percent}" /></label>
          <label>Max 24hr duties/month<input id="rule-max-24hr" type="number" min="0" value="${rules.duty_count_limits.max_24hr_per_month ?? ""}" placeholder="Unset" /></label>
          <label>Max weekend 24hr/month<input id="rule-max-weekend" type="number" min="0" value="${rules.duty_count_limits.max_weekend_24hr_per_month ?? ""}" placeholder="Unset" /></label>
        </div>
        <label class="checkbox-line"><input id="rule-post-blocks" type="checkbox" ${rules.rest_rules.post_24hr_blocks_next_day_elective ? "checked" : ""} /> Post-24hr duty blocks next-day elective availability</label>
        <label class="checkbox-line"><input id="rule-small-unit" type="checkbox" ${rules.unit_staffing_rules.small_unit_uses_absolute_minimum ? "checked" : ""} /> Small units use absolute minimum availability</label>
      </section>
      <section class="panel table-panel">
        <h3>Duty Dictionary</h3>
        <table>
          <thead>
            <tr>
              <th>Duty</th>
              <th>Label</th>
              <th>Group</th>
              <th>Hours</th>
              <th>Mandatory</th>
              <th>Adjustable</th>
              <th>Same Day</th>
              <th>Next Day</th>
              <th>Active</th>
              <th>Allowed Calls</th>
            </tr>
          </thead>
          <tbody>${dutyRows}</tbody>
        </table>
      </section>
    </form>
  `;
}

async function renderRotaSetup() {
  setHeader("Rota Setup", "Monthly rota period and unit scope");
  if (!viewRoot) return;
  viewRoot.innerHTML = `<section class="panel"><h3>Loading rota setup...</h3></section>`;
  try {
    rotaSetup = await getRotaSetupMonth(rotaSetupMonth);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Failed to load rota setup", "error");
    viewRoot.innerHTML = `<section class="panel"><h3>Rota setup unavailable</h3><p>Unable to load monthly rota setup.</p></section>`;
    return;
  }

  const included = new Set(rotaSetup.scope.units.filter((item) => item.status === "included").map((item) => item.unit_id));
  const excluded = new Set(rotaSetup.scope.units.filter((item) => item.status === "excluded").map((item) => item.unit_id));
  const readyCount = rotaSetup.unit_readiness.filter((item) => item.scope_status === "included" && item.readiness === "ready").length;
  const reviewCount = rotaSetup.unit_readiness.filter((item) => item.scope_status === "included" && item.readiness !== "ready").length;
  const rows = rotaSetup.unit_readiness.map((unit) => {
    const callMix = Object.entries(unit.call_level_counts).map(([key, count]) => `${escapeHtml(callLevelLabel(normalizeCallLevel(key)))}: ${count}`).join(", ") || "No members";
    return `
      <tr>
        <td><strong>${escapeHtml(unit.unit_name)}</strong><small>${escapeHtml(unit.unit_code)}${unit.campus ? ` / ${escapeHtml(unit.campus)}` : ""}</small></td>
        <td>
          <select data-scope-unit="${unit.unit_id}">
            <option value="unselected" ${unit.scope_status === "unselected" ? "selected" : ""}>Not selected</option>
            <option value="included" ${included.has(unit.unit_id) ? "selected" : ""}>Included</option>
            <option value="excluded" ${excluded.has(unit.unit_id) ? "selected" : ""}>Excluded</option>
          </select>
        </td>
        <td>${unit.assigned_members}</td>
        <td>${callMix}</td>
        <td>${unit.people_with_leave} people / ${unit.leave_days} days</td>
        <td><span class="status ${unit.readiness === "ready" ? "ok" : "error"}">${unit.readiness === "ready" ? "Ready" : "Needs review"}</span></td>
        <td>${unit.warnings.map((warning) => `<small>${escapeHtml(warning)}</small>`).join("") || "<small>None</small>"}</td>
      </tr>
    `;
  }).join("");

  viewRoot.innerHTML = `
    <form id="rota-setup-form">
      <section class="panel action-panel">
        <div>
          <h3>${escapeHtml(rotaSetup.rota_period.name)}</h3>
          <p>${rotaSetup.rota_period.starts_on} to ${rotaSetup.rota_period.ends_on}. Select the units that should participate in this month's rota generation.</p>
        </div>
        <div class="topbar-actions">
          <label for="rota-setup-month" class="visually-hidden">Rota setup month</label>
          <input id="rota-setup-month" type="month" value="${rotaSetupMonth}" />
          <button class="icon-button" type="button" id="clone-rota-scope">Clone Previous</button>
          <button class="primary" type="submit" id="save-rota-setup">Save Scope</button>
        </div>
      </section>
      <section class="summary-grid four-col">
        ${metricCard(included.size, "Included units")}
        ${metricCard(excluded.size, "Excluded units")}
        ${metricCard(readyCount, "Ready included")}
        ${metricCard(reviewCount, "Need review")}
      </section>
      <section class="panel">
        <h3>Generation Scope</h3>
        <label class="checkbox-line"><input id="scope-safety-excluded" type="checkbox" ${rotaSetup.scope.include_excluded_units_in_safety ? "checked" : ""} /> Show excluded units in safety calculations</label>
        <label class="checkbox-line"><input id="scope-locked" type="checkbox" ${rotaSetup.scope.is_locked ? "checked" : ""} /> Lock this unit scope before generation</label>
        <label>Lock or unlock reason
          <input id="scope-lock-reason" value="${escapeHtml(rotaSetup.scope.lock_reason ?? "")}" placeholder="Reason required when unlocking" />
        </label>
      </section>
      <section class="panel table-panel">
        <h3>Units For This Month</h3>
        <table>
          <thead>
            <tr>
              <th>Unit</th>
              <th>Scope</th>
              <th>Members</th>
              <th>Call Mix</th>
              <th>Leave Pressure</th>
              <th>Readiness</th>
              <th>Warnings</th>
            </tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="7" class="empty">No units found.</td></tr>`}</tbody>
        </table>
      </section>
    </form>
  `;
}

function latestTemplateDutyKeys(template: RotaTemplateMonth): Set<string> {
  const rawKeys = template.latest_run?.summary?.duty_keys;
  if (Array.isArray(rawKeys)) {
    return new Set(rawKeys.map((item) => String(item)));
  }
  return new Set(template.duty_options.filter((duty) => duty.is_mandatory).map((duty) => duty.key));
}

function renderTemplateDutyOptions(template: RotaTemplateMonth): string {
  const selectedKeys = latestTemplateDutyKeys(template);
  return template.duty_options.map((duty) => `
    <label class="template-duty-option">
      <input type="checkbox" data-template-duty="${escapeHtml(duty.key)}" ${selectedKeys.has(duty.key) ? "checked" : ""} />
      <span>
        <strong>${escapeHtml(duty.label)}</strong>
        <small>${escapeHtml(duty.group)}${duty.is_mandatory ? " / mandatory" : ""}${duty.is_adjustable ? " / adjustable" : ""}</small>
      </span>
    </label>
  `).join("");
}

function safetyStatusLabel(status?: string): string {
  if (status === "safe") return "Safe";
  if (status === "needs_review") return "Needs Review";
  if (status === "hard_blocked") return "Hard Blocked";
  return status ? leaveTypeLabel(status) : "Not Checked";
}

function safetyStatusClass(status?: string): string {
  if (status === "safe") return "ok";
  if (status === "needs_review") return "warning";
  if (status === "hard_blocked") return "error";
  return "";
}

function templateSafetyBySlot(): Map<string, RotaSafetyMonth["slots"][number]> {
  return new Map((rotaSafety?.slots ?? []).map((slot) => [slot.slot_id, slot]));
}

function templateCandidatesBySlot(): Map<string, RotaCandidateMonth["slots"][number]> {
  return new Map((rotaCandidates?.slots ?? []).map((slot) => [slot.slot_id, slot]));
}

function renderSlotSafetyCell(safety?: RotaSafetyMonth["slots"][number]): string {
  if (!safety) {
    return `<span class="status">Not Checked</span><small>Run the safety check with the current template.</small>`;
  }
  const reason = safety.reasons.slice(0, 1).join(" ");
  return `
    <div class="safety-cell">
      <span class="status ${safetyStatusClass(safety.safety_status)}">${escapeHtml(safetyStatusLabel(safety.safety_status))}</span>
      <small>${safety.available_members}/${safety.eligible_members} eligible available</small>
      ${reason ? `<small>${escapeHtml(reason)}</small>` : ""}
    </div>
  `;
}

function assignmentSourceLabel(source: string): string {
  if (source === "manual_rota_board") return "Manual assignment";
  if (source === "historical_analysis_import") return "Historical import";
  if (source === "safe_auto_fill_draft") return "Safe auto-fill";
  if (source === "exchange_approved") return "Approved exchange";
  return leaveTypeLabel(source);
}

function candidateStatusLabel(status: string): string {
  if (status === "eligible") return "Safe";
  if (status === "needs_review") return "Needs Review";
  if (status === "blocked") return "Blocked";
  return leaveTypeLabel(status);
}

function candidateStatusClass(status: string): string {
  if (status === "eligible") return "ok";
  if (status === "needs_review") return "warning";
  if (status === "blocked") return "error";
  return "";
}

function rejectedCandidateKey(slotId: string, personId: string): string {
  return `${slotId}:${personId}`;
}

function renderCandidateSuggestion(
  slot: RotaTemplateMonth["slots"][number],
  candidate: RotaCandidate,
): string {
  const key = rejectedCandidateKey(slot.id, candidate.person_id);
  if (rejectedRotaCandidates.has(key)) return "";
  const topReasons = candidate.reasons.slice(0, 3);
  const canAccept = candidate.candidate_status === "eligible" && !candidate.requires_override;
  return `
    <article class="candidate-card" data-candidate-card="${escapeHtml(key)}">
      <div>
        <strong>${escapeHtml(candidate.person_name)}</strong>
        <small>${escapeHtml(callLevelLabel(candidate.call_level ?? ""))} / score ${candidate.rank_score}</small>
      </div>
      <span class="status ${candidateStatusClass(candidate.candidate_status)}">${escapeHtml(candidateStatusLabel(candidate.candidate_status))}</span>
      <div class="candidate-reasons">
        ${topReasons.map((reason) => `<small>${escapeHtml(reason)}</small>`).join("")}
      </div>
      <div class="candidate-actions">
        <button class="icon-button" type="button" data-${canAccept ? "accept" : "select"}-candidate="${escapeHtml(key)}">${canAccept ? "Use" : "Review"}</button>
        <button class="icon-button" type="button" data-reject-candidate="${escapeHtml(key)}">Reject</button>
      </div>
    </article>
  `;
}

function renderCandidateSuggestions(
  slot: RotaTemplateMonth["slots"][number],
  candidateSlot?: RotaCandidateMonth["slots"][number],
): string {
  const candidates = (candidateSlot?.candidates ?? [])
    .filter((candidate) => !rejectedRotaCandidates.has(rejectedCandidateKey(slot.id, candidate.person_id)))
    .slice(0, 3);
  if (!candidates.length) {
    return `<span class="empty-state compact-empty">No suggestions</span>`;
  }
  return `<div class="candidate-list">${candidates.map((candidate) => renderCandidateSuggestion(slot, candidate)).join("")}</div>`;
}

function assignmentCandidatesForSlot(safety?: RotaSafetyMonth["slots"][number]): Array<{
  person: RotaSafetyPerson;
  status: "available" | "review" | "blocked";
  label: string;
}> {
  if (!safety) return [];
  const candidates = new Map<string, { person: RotaSafetyPerson; status: "available" | "review" | "blocked"; label: string }>();
  safety.available_people.forEach((person) => {
    candidates.set(person.person_id, { person, status: "available", label: "Available" });
  });
  safety.warning_people.forEach((person) => {
    candidates.set(person.person_id, { person, status: "review", label: "Needs Review" });
  });
  safety.hard_blocked_people.forEach((person) => {
    candidates.set(person.person_id, { person, status: "blocked", label: "Blocked" });
  });
  const rank = { available: 0, review: 1, blocked: 2 };
  return Array.from(candidates.values()).sort((a, b) => {
    const statusDiff = rank[a.status] - rank[b.status];
    if (statusDiff !== 0) return statusDiff;
    return a.person.person_name.localeCompare(b.person.person_name);
  });
}

function renderSlotAssignments(slot: RotaTemplateMonth["slots"][number]): string {
  if (!slot.assignments.length) {
    return `<span class="empty-state compact-empty">Open</span>`;
  }
  return `
    <div class="assigned-list">
      ${slot.assignments.map((assignment) => `
        <div class="assigned-person">
          <strong>${escapeHtml(assignment.person_name)}</strong>
          <small>${escapeHtml(callLevelLabel(assignment.call_level ?? ""))} / ${escapeHtml(assignmentSourceLabel(assignment.source))}</small>
          ${assignment.override_reason ? `<small>Override: ${escapeHtml(assignment.override_reason)}</small>` : ""}
          <button class="icon-button" type="button" data-clear-rota-assignment="${escapeHtml(assignment.id)}">Clear</button>
        </div>
      `).join("")}
    </div>
  `;
}

function renderManualAssignmentControls(
  slot: RotaTemplateMonth["slots"][number],
  safety?: RotaSafetyMonth["slots"][number],
): string {
  const candidates = assignmentCandidatesForSlot(safety);
  if (!candidates.length) {
    return `<div class="manual-assignment-cell"><span class="empty-state compact-empty">No eligible candidates from Unit Management.</span></div>`;
  }
  const hasAssignments = slot.assignments.length > 0;
  return `
    <div class="manual-assignment-cell">
      <label class="visually-hidden" for="assign-person-${escapeHtml(slot.id)}">Assign member</label>
      <select id="assign-person-${escapeHtml(slot.id)}" data-assign-person="${escapeHtml(slot.id)}">
        <option value="">Select member</option>
        ${candidates.map((candidate) => `
          <option value="${escapeHtml(candidate.person.person_id)}">
            ${escapeHtml(candidate.person.person_name)} - ${escapeHtml(callLevelLabel(candidate.person.call_level))} (${escapeHtml(candidate.label)})
          </option>
        `).join("")}
      </select>
      <input data-assign-override="${escapeHtml(slot.id)}" placeholder="Override reason if needed" />
      <label class="checkbox-line compact-checkbox">
        <input type="checkbox" data-assign-replace="${escapeHtml(slot.id)}" ${hasAssignments ? "checked" : ""} />
        Replace current
      </label>
      <button class="primary" type="button" data-assign-slot="${escapeHtml(slot.id)}">${hasAssignments ? "Replace" : "Assign"}</button>
    </div>
  `;
}

type RotaTemplateSlot = RotaTemplateMonth["slots"][number];
type RotaSlotSafety = RotaSafetyMonth["slots"][number];
type RotaSlotCandidates = RotaCandidateMonth["slots"][number];

function rotaTemplateSlotsByDay(template: RotaTemplateMonth): Map<string, RotaTemplateSlot[]> {
  const byDay = new Map<string, RotaTemplateSlot[]>();
  template.slots.forEach((slot) => {
    const slots = byDay.get(slot.duty_date) ?? [];
    slots.push(slot);
    byDay.set(slot.duty_date, slots);
  });
  return byDay;
}

function sortRotaSlots(slots: RotaTemplateSlot[]): RotaTemplateSlot[] {
  return [...slots].sort((a, b) => (
    (a.unit_name ?? "Unassigned unit").localeCompare(b.unit_name ?? "Unassigned unit")
    || leaveTypeLabel(a.duty_type).localeCompare(leaveTypeLabel(b.duty_type))
    || a.slot_label.localeCompare(b.slot_label)
  ));
}

function rotaCalendarSafetyClass(slots: RotaTemplateSlot[], safetyBySlot: Map<string, RotaSlotSafety>): string {
  if (!slots.length) return "rota-day-empty";
  const hasHardBlock = slots.some((slot) => safetyBySlot.get(slot.id)?.safety_status === "hard_blocked");
  if (hasHardBlock) return "rota-day-hard";
  const hasReview = slots.some((slot) => (
    safetyBySlot.get(slot.id)?.safety_status === "needs_review"
    || (slot.template_status !== "ready" && slot.template_status !== "safe")
  ));
  if (hasReview) return "rota-day-review";
  const allAssigned = slots.every((slot) => slot.assignments.length > 0);
  return allAssigned ? "rota-day-assigned" : "rota-day-ready";
}

function renderRotaTemplateCalendarDays(template: RotaTemplateMonth): string {
  if (!template.slots.length) return "";
  const safetyBySlot = templateSafetyBySlot();
  const slotsByDay = rotaTemplateSlotsByDay(template);
  const days: string[] = [];
  for (let day = template.rota_period.starts_on; day <= template.rota_period.ends_on; day = addDaysIso(day, 1)) {
    days.push(day);
  }
  return days.map((day) => {
    const slots = slotsByDay.get(day) ?? [];
    const assignedSlots = slots.filter((slot) => slot.assignments.length > 0).length;
    const openSlots = Math.max(0, slots.length - assignedSlots);
    const assignedNames = Array.from(new Set(slots.flatMap((slot) => slot.assignments.map((assignment) => assignment.person_name))));
    const summary = slots.length
      ? `${assignedSlots}/${slots.length} assigned${assignedNames.length ? `. ${assignedNames.slice(0, 2).map(escapeHtml).join(", ")}` : openSlots ? ". Open duties" : ". Complete"}`
      : "No generated slots";
    return `
      <button class="leave-day-card rota-day-card ${rotaCalendarSafetyClass(slots, safetyBySlot)}" type="button" data-rota-day="${day}" aria-label="${slots.length} rota slot${slots.length === 1 ? "" : "s"} on ${day}, ${assignedSlots} assigned">
        <span>${formatIsoDay(day)}</span>
        <strong>${slots.length ? `${assignedSlots}/${slots.length}` : "0"}</strong>
        <small>${summary}</small>
      </button>
    `;
  }).join("");
}

function rotaDaySlots(day: string): RotaTemplateSlot[] {
  if (!rotaTemplate) return [];
  return sortRotaSlots(rotaTemplate.slots.filter((slot) => slot.duty_date === day));
}

function renderRotaSlotDetailCard(
  slot: RotaTemplateSlot,
  safety?: RotaSlotSafety,
  candidateSlot?: RotaSlotCandidates,
): string {
  return `
    <article class="rota-slot-card">
      <header>
        <div>
          <h4>${escapeHtml(slot.unit_name ?? "Unassigned unit")}</h4>
          <p>${escapeHtml(slot.unit_code ?? "No unit code")} / ${escapeHtml(slot.slot_label || leaveTypeLabel(slot.duty_type))}</p>
        </div>
        <span class="status ${slot.template_status === "ready" ? "ok" : "warning"}">${escapeHtml(leaveTypeLabel(slot.template_status))}</span>
      </header>
      <div class="rota-slot-card-grid">
        <div>
          <span>Duty</span>
          <strong>${escapeHtml(leaveTypeLabel(slot.duty_type))}</strong>
          <small>${slot.is_24hr ? "24-hour duty" : `${escapeHtml(slot.starts_at)} to ${escapeHtml(slot.ends_at)}`}</small>
        </div>
        <div>
          <span>Required call</span>
          <strong>${escapeHtml(callLevelLabel(slot.call_level ?? ""))}</strong>
          <small>Maximum ${slot.max_assignees} assignee${slot.max_assignees === 1 ? "" : "s"}</small>
        </div>
        <div>
          <span>Template reason</span>
          <strong>${escapeHtml(slot.template_reason || "Ready for assignment")}</strong>
          <small>${escapeHtml(slot.source ? assignmentSourceLabel(slot.source) : "Generated template")}</small>
        </div>
      </div>
      <div class="rota-slot-detail-section">
        <h5>Safety check</h5>
        ${renderSlotSafetyCell(safety)}
      </div>
      <div class="rota-slot-detail-section">
        <h5>Assigned member</h5>
        ${renderSlotAssignments(slot)}
      </div>
      <div class="rota-slot-detail-section">
        <h5>Suggested members</h5>
        ${renderCandidateSuggestions(slot, candidateSlot)}
      </div>
      <div class="rota-slot-detail-section">
        <h5>Manual assignment</h5>
        ${renderManualAssignmentControls(slot, safety)}
      </div>
    </article>
  `;
}

function renderRotaDayUnitGroups(day: string): string {
  const slots = rotaDaySlots(day);
  if (!slots.length) {
    return `<p class="empty">No generated rota slots recorded for this day.</p>`;
  }
  const safetyBySlot = templateSafetyBySlot();
  const candidatesBySlot = templateCandidatesBySlot();
  const groups = slots.reduce<Record<string, RotaTemplateSlot[]>>((acc, slot) => {
    const key = slot.unit_name ?? "Unassigned unit";
    acc[key] = acc[key] ?? [];
    acc[key].push(slot);
    return acc;
  }, {});
  return Object.entries(groups)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([unitName, unitSlots]) => `
      <section class="leave-day-call-group rota-day-unit-group">
        <header>
          <h4>${escapeHtml(unitName)}</h4>
          <span>${unitSlots.length}</span>
        </header>
        <div class="rota-slot-card-list">
          ${unitSlots.map((slot) => renderRotaSlotDetailCard(slot, safetyBySlot.get(slot.id), candidatesBySlot.get(slot.id))).join("")}
        </div>
      </section>
    `)
    .join("");
}

function renderRotaDayModal(day: string): string {
  const slots = rotaDaySlots(day);
  const safetyBySlot = templateSafetyBySlot();
  const assignedSlots = slots.filter((slot) => slot.assignments.length > 0).length;
  const openSlots = Math.max(0, slots.length - assignedSlots);
  const safeSlots = slots.filter((slot) => safetyBySlot.get(slot.id)?.safety_status === "safe").length;
  const reviewSlots = slots.filter((slot) => safetyBySlot.get(slot.id)?.safety_status === "needs_review").length;
  const hardBlockedSlots = slots.filter((slot) => safetyBySlot.get(slot.id)?.safety_status === "hard_blocked").length;
  return `
    <div class="modal-backdrop" id="rota-day-modal">
      <section class="person-modal rota-day-modal" role="dialog" aria-modal="true" aria-labelledby="rota-day-modal-title">
        <header class="person-modal-header">
          <div>
            <h3 id="rota-day-modal-title">${escapeHtml(formatIsoDay(day))} Rota Slots</h3>
            <p>${escapeHtml(day)} / generated duty slots with assignment controls</p>
          </div>
          <button class="modal-close" data-close-rota-day-modal aria-label="Close">x</button>
        </header>
        <div class="person-modal-body rota-day-modal-body">
          <div class="audit-chip-row">
            <span><strong>${slots.length}</strong> ${statLabel("Slots", "Generated duty slots on this date.")}</span>
            <span><strong>${assignedSlots}</strong> ${statLabel("Assigned", "Slots on this date that already have a saved member assignment.")}</span>
            <span><strong>${openSlots}</strong> ${statLabel("Open", "Slots on this date that still need a member assignment.")}</span>
            <span><strong>${safeSlots}</strong> ${statLabel("Safe", "Slots where the current safety check found clear available candidates.")}</span>
            <span><strong>${reviewSlots}</strong> ${statLabel("Review", "Slots that can be planned only after board review or override.")}</span>
            <span><strong>${hardBlockedSlots}</strong> ${statLabel("Hard Blocked", "Slots with hard blockers under the current rules and leave data.")}</span>
          </div>
          ${renderRotaDayUnitGroups(day)}
        </div>
      </section>
    </div>
  `;
}

function openRotaDayModal(day: string) {
  document.querySelector("#rota-day-modal")?.remove();
  (viewRoot ?? document.body).insertAdjacentHTML("beforeend", renderRotaDayModal(day));
}

function closeRotaDayModal() {
  document.querySelector("#rota-day-modal")?.remove();
}

function renderUnitDaySafetyRows(safety: RotaSafetyMonth): string {
  return safety.unit_day_safety.slice(0, 100).map((row) => `
    <tr>
      <td>${escapeHtml(row.date)}</td>
      <td><strong>${escapeHtml(row.unit_name ?? "Unassigned unit")}</strong><small>${escapeHtml(row.unit_code ?? "")}</small></td>
      <td><span class="status ${safetyStatusClass(row.safety_status)}">${escapeHtml(safetyStatusLabel(row.safety_status))}</span></td>
      <td>${row.slots}</td>
      <td>${row.safe_slots}</td>
      <td>${row.needs_review_slots}</td>
      <td>${row.hard_blocked_slots}</td>
      <td>${row.minimum_available_members}</td>
    </tr>
  `).join("");
}

function renderTemplateEvents(template: RotaTemplateMonth): string {
  const events = template.latest_run?.events ?? [];
  return events.slice(0, 80).map((event) => `
    <tr>
      <td>${escapeHtml(event.duty_date ?? "")}</td>
      <td>${escapeHtml(event.unit_name ?? "Unit")}</td>
      <td>${escapeHtml(event.duty_type ? leaveTypeLabel(event.duty_type) : "")}</td>
      <td><span class="status ${event.severity === "error" ? "error" : "ok"}">${escapeHtml(leaveTypeLabel(event.action))}</span></td>
      <td>${escapeHtml(event.reason)}</td>
    </tr>
  `).join("");
}

function autoFillActionLabel(action: string): string {
  if (action === "assigned") return "Assigned";
  if (action === "skipped") return "Left Open";
  if (action === "blocked") return "Blocked";
  return leaveTypeLabel(action);
}

function renderAutoFillEvents(run: NonNullable<RotaAutoFillMonth["latest_run"]>): string {
  return run.events.slice(0, 100).map((event) => `
    <tr>
      <td>${escapeHtml(event.duty_date ?? "")}</td>
      <td><strong>${escapeHtml(event.unit_name ?? "Unit")}</strong><small>${escapeHtml(event.unit_code ?? "")}</small></td>
      <td>${escapeHtml(event.duty_type ? leaveTypeLabel(event.duty_type) : "")}</td>
      <td>${escapeHtml(event.person_name ?? "")}</td>
      <td><span class="status ${event.severity === "error" ? "error" : event.severity === "warning" ? "warning" : "ok"}">${escapeHtml(autoFillActionLabel(event.action))}</span></td>
      <td>${escapeHtml(event.reason)}</td>
    </tr>
  `).join("");
}

function renderAutoFillReport(autoFill: RotaAutoFillMonth | null): string {
  const run = autoFill?.latest_run;
  if (!run) {
    return `
      <section class="panel table-panel">
        <h3>Safe Auto-Fill Report</h3>
        <p class="empty-state">No safe auto-fill draft has been run for this month yet.</p>
      </section>
    `;
  }
  return `
    <section class="summary-grid four-col">
      ${metricCard(run.assigned_slots, "Auto-filled slots", undefined, "metric-primary")}
      ${metricCard(run.skipped_slots, "Left open")}
      ${metricCard(run.review_slots, "Review left open", undefined, "metric-weekend")}
      ${metricCard(run.blocked_slots, "Blocked left open")}
    </section>
    <section class="panel table-panel">
      <h3>Safe Auto-Fill Report</h3>
      <table>
        <thead><tr><th>Date</th><th>Unit</th><th>Duty</th><th>Member</th><th>Action</th><th>Reason</th></tr></thead>
        <tbody>${renderAutoFillEvents(run) || `<tr><td colspan="6" class="empty">No auto-fill decisions recorded.</td></tr>`}</tbody>
      </table>
      ${run.events.length > 100 ? `<p class="empty">Showing first 100 of ${run.events.length} auto-fill decisions.</p>` : ""}
    </section>
  `;
}

async function renderRotaTemplate() {
  setHeader("Rota Template", "Leave-aware empty slot generation and staffing safety");
  if (!viewRoot) return;
  viewRoot.innerHTML = `<section class="panel"><h3>Loading rota template...</h3></section>`;
  try {
    [rotaTemplate, rotaSafety, rotaCandidates, rotaAutoFill] = await Promise.all([
      getRotaTemplateMonth(rotaTemplateMonth),
      getRotaSafetyMonth(rotaTemplateMonth),
      getRotaCandidateMonth(rotaTemplateMonth),
      getRotaAutoFillMonth(rotaTemplateMonth),
    ]);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Failed to load rota template", "error");
    viewRoot.innerHTML = `<section class="panel"><h3>Rota template unavailable</h3><p>Unable to load leave-aware template and safety controls.</p></section>`;
    return;
  }

  const template = rotaTemplate;
  const safety = rotaSafety;
  const candidates = rotaCandidates;
  const autoFill = rotaAutoFill;
  const locked = template.scope.is_locked;
  const latest = template.latest_run;
  const includedUnitNames = template.scope.included_units.map((unit) => unit.name).join(", ");
  const minimumAvailable = safety.unit_day_safety.length
    ? Math.min(...safety.unit_day_safety.map((row) => row.minimum_available_members))
    : 0;
  const assignedSlotCount = template.slots.filter((slot) => slot.assignments.length > 0).length;
  const openSlotCount = Math.max(0, template.slots.length - assignedSlotCount);
  const selectedDutyKeys = latestTemplateDutyKeys(template);
  const selectedDutyCount = selectedDutyKeys.size;
  const selectedMandatoryCount = template.duty_options.filter((duty) => selectedDutyKeys.has(duty.key) && duty.is_mandatory).length;
  const selectedAdjustableCount = template.duty_options.filter((duty) => selectedDutyKeys.has(duty.key) && duty.is_adjustable).length;

  viewRoot.innerHTML = `
    <form id="rota-template-form">
      <section class="panel action-panel">
        <div>
          <h3>${escapeHtml(template.rota_period.name)}</h3>
          <p>${template.rota_period.starts_on} to ${template.rota_period.ends_on}. ${template.scope.included_units.length} included unit(s): ${escapeHtml(includedUnitNames || "none")}.</p>
        </div>
        <div class="topbar-actions">
          <label for="rota-template-month" class="visually-hidden">Rota template month</label>
          <input id="rota-template-month" type="month" value="${rotaTemplateMonth}" />
          <button class="primary" type="submit" id="generate-rota-template" ${locked ? "" : "disabled"}>Generate Template</button>
          <button class="icon-button" type="button" id="run-safe-auto-fill" ${openSlotCount ? "" : "disabled"}>Safe Auto-Fill</button>
        </div>
      </section>
      <section class="summary-grid four-col">
        ${metricCard(template.summary.total_slots, "Template slots")}
        ${metricCard(template.summary.ready_slots, "Ready slots")}
        ${metricCard(template.summary.needs_review_slots, "Need review")}
        ${metricCard(latest?.blocked_slots ?? 0, "Blocked/skipped")}
      </section>
      <section class="summary-grid four-col">
        ${metricCard(safety.summary.total_slots, "Safety checked")}
        ${metricCard(safety.summary.safe_slots, "Safe slots", undefined, "metric-primary")}
        ${metricCard(safety.summary.needs_review_slots, "Needs review", undefined, "metric-weekend")}
        ${metricCard(safety.summary.hard_blocked_slots, "Hard blocked")}
      </section>
      <section class="summary-grid four-col">
        ${metricCard(minimumAvailable, "Minimum available")}
        ${metricCard(safety.unit_day_safety.length, "Unit-day checks", "Distinct unit and date combinations checked for staffing safety.")}
        ${metricCard(assignedSlotCount, "Assigned slots")}
        ${metricCard(openSlotCount, "Open slots")}
      </section>
      <section class="summary-grid four-col">
        ${metricCard(candidates.summary.slots_with_candidates, "Suggestion slots")}
        ${metricCard(candidates.summary.eligible_candidates, "Safe suggestions", undefined, "metric-primary")}
        ${metricCard(candidates.summary.needs_review_candidates, "Review suggestions", undefined, "metric-weekend")}
        ${metricCard(candidates.summary.blocked_candidates, "Blocked suggestions")}
      </section>
      ${locked ? "" : `<section class="panel quality-panel"><h3>Scope Not Locked</h3><p>Lock the monthly unit scope in Rota Setup before generating the empty template.</p></section>`}
      <details class="panel template-settings-panel">
        <summary>
          <div>
            <h3>Template Generation Settings</h3>
            <p>${selectedDutyCount} of ${template.duty_options.length} duty types selected. ${selectedMandatoryCount} mandatory and ${selectedAdjustableCount} adjustable duties included.</p>
          </div>
          <span class="settings-disclosure-badge">Edit settings</span>
        </summary>
        <div class="template-settings-body">
          <div class="template-settings-group">
            <h4>Generation Window</h4>
            <div class="form-grid">
              <label>Start date<input id="template-start" type="date" value="${template.rota_period.starts_on}" /></label>
              <label>End date<input id="template-end" type="date" value="${template.rota_period.ends_on}" /></label>
            </div>
            <div class="settings-check-row">
              <label class="checkbox-line"><input id="template-weekdays" type="checkbox" checked /> Include weekdays</label>
              <label class="checkbox-line"><input id="template-weekends" type="checkbox" checked /> Include weekends</label>
              <label class="checkbox-line"><input id="template-replace" type="checkbox" checked /> Replace existing generated empty slots</label>
            </div>
          </div>
          <div class="template-settings-group">
            <div class="settings-group-title">
              <h4>Duty Template Editor</h4>
              <span>${selectedDutyCount}/${template.duty_options.length} selected</span>
            </div>
            <div class="template-duty-grid">${renderTemplateDutyOptions(template)}</div>
          </div>
        </div>
      </details>
    </form>
    <section class="panel table-panel">
      <h3>Unit-Day Safety</h3>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Unit</th>
            <th>Safety</th>
            <th>Slots</th>
            <th>Safe</th>
            <th>Review</th>
            <th>Hard Blocked</th>
            <th>Minimum Available</th>
          </tr>
        </thead>
        <tbody>${renderUnitDaySafetyRows(safety) || `<tr><td colspan="8" class="empty">No safety checks yet. Generate empty slots first.</td></tr>`}</tbody>
      </table>
      ${safety.unit_day_safety.length > 100 ? `<p class="empty">Showing first 100 of ${safety.unit_day_safety.length} unit-day checks.</p>` : ""}
    </section>
    <section class="panel rota-calendar-panel">
      <h3>Rota Calendar</h3>
      <p class="panel-note">Click a day to review generated slots, current assignments, safety notes, suggested members, and manual assignment controls.</p>
      ${template.slots.length
        ? `<div class="leave-calendar-grid rota-calendar-grid">${renderRotaTemplateCalendarDays(template)}</div>`
        : `<p class="empty-state">No generated slots yet. Generate the template after locking the monthly unit scope.</p>`}
    </section>
    ${renderAutoFillReport(autoFill)}
    <section class="panel table-panel">
      <h3>Latest Generation Decisions</h3>
      <table>
        <thead><tr><th>Date</th><th>Unit</th><th>Duty</th><th>Action</th><th>Reason</th></tr></thead>
        <tbody>${renderTemplateEvents(template) || `<tr><td colspan="5" class="empty">No generation decisions recorded yet.</td></tr>`}</tbody>
      </table>
    </section>
  `;
}

function exchangeStatusLabel(status: string): string {
  if (status === "pending_approval") return "Pending Approval";
  if (status === "needs_override") return "Needs Override";
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  if (status === "blocked") return "Blocked";
  return leaveTypeLabel(status);
}

function exchangeStatusClass(status: string): string {
  if (status === "approved") return "ok";
  if (status === "pending_approval") return "warning";
  if (status === "needs_override") return "warning";
  if (status === "blocked" || status === "rejected") return "error";
  return "";
}

function renderReviewCandidateSummary(candidates: RotaCandidate[]): string {
  if (!candidates.length) return `<span class="empty-state compact-empty">No suggestions</span>`;
  return `
    <div class="review-candidate-stack">
      ${candidates.slice(0, 3).map((candidate) => `
        <span>
          <strong>${escapeHtml(candidate.person_name)}</strong>
          <small>${escapeHtml(candidateStatusLabel(candidate.candidate_status))} / score ${candidate.rank_score}</small>
        </span>
      `).join("")}
    </div>
  `;
}

function renderReviewItemRows(review: RotaReviewMonth): string {
  return review.review_items.slice(0, 120).map((item) => `
    <tr>
      <td>${escapeHtml(item.slot.duty_date)}</td>
      <td><strong>${escapeHtml(item.slot.unit_name ?? "Unassigned unit")}</strong><small>${escapeHtml(item.slot.unit_code ?? "")}</small></td>
      <td>${escapeHtml(leaveTypeLabel(item.slot.duty_type))}</td>
      <td><span class="status ${item.severity === "error" ? "error" : "warning"}">${escapeHtml(item.severity === "error" ? "Hard Blocked" : "Needs Review")}</span></td>
      <td>
        <div class="review-issue-stack">
          ${item.issues.map((issue) => `<small>${escapeHtml(issue.message)}</small>`).join("")}
        </div>
      </td>
      <td>${renderSlotAssignments({ assignments: item.assignments } as RotaTemplateMonth["slots"][number])}</td>
      <td>${renderReviewCandidateSummary(item.candidates)}</td>
      <td>${escapeHtml(item.recommended_action)}</td>
    </tr>
  `).join("");
}

function renderWorkloadRows(review: RotaReviewMonth): string {
  return review.person_workload.slice(0, 120).map((row) => `
    <tr>
      <td><strong>${escapeHtml(row.person_name)}</strong><small>${escapeHtml(callLevelLabel(row.call_level))}</small></td>
      <td>${row.total_assignments}</td>
      <td>${row.total_24hr}</td>
      <td>${row.weekend_24hr}</td>
      <td>${row.override_assignments}</td>
      <td>${row.assignments.slice(0, 3).map((assignment) => `${escapeHtml(assignment.duty_date)} / ${escapeHtml(leaveTypeLabel(assignment.duty_type))}`).join("<br>")}</td>
    </tr>
  `).join("");
}

function renderExchangeAssignmentOptions(review: RotaReviewMonth): string {
  return review.assignment_options.map((option) => `
    <option value="${escapeHtml(option.assignment.id)}">
      ${escapeHtml(option.label)}
    </option>
  `).join("");
}

function renderExchangeTargetOptions(): string {
  return members
    .filter((member) => member.active_status === "active")
    .sort((a, b) => a.canonical_name.localeCompare(b.canonical_name))
    .map((member) => `
      <option value="${escapeHtml(member.id)}">
        ${escapeHtml(member.canonical_name)} - ${escapeHtml(callLevelLabel(member.call_level))}
      </option>
    `)
    .join("");
}

function renderExchangeRows(review: RotaReviewMonth): string {
  return review.exchange_requests.slice(0, 80).map((exchange) => {
    const canDecide = !["approved", "rejected", "blocked"].includes(exchange.status);
    return `
      <tr>
        <td><span class="status ${exchangeStatusClass(exchange.status)}">${escapeHtml(exchangeStatusLabel(exchange.status))}</span></td>
        <td>${escapeHtml(exchange.from_slot?.duty_date ?? "")}<small>${escapeHtml(exchange.from_slot?.unit_name ?? "Unit")}</small></td>
        <td><strong>${escapeHtml(exchange.from_person?.canonical_name ?? "Current member")}</strong><small>to ${escapeHtml(exchange.to_person?.canonical_name ?? "Target member")}</small></td>
        <td>${escapeHtml(exchange.request_reason)}${exchange.decision_reason ? `<small>Decision: ${escapeHtml(exchange.decision_reason)}</small>` : ""}</td>
        <td>${escapeHtml(exchange.requested_by ?? "")}${exchange.approved_by ? `<small>Decided by ${escapeHtml(exchange.approved_by)}</small>` : ""}</td>
        <td>
          ${canDecide ? `
            <div class="exchange-decision-cell">
              <input data-exchange-decision="${escapeHtml(exchange.id)}" placeholder="${exchange.status === "needs_override" ? "Approval reason required" : "Optional decision note"}" />
              <button class="primary" type="button" data-approve-exchange="${escapeHtml(exchange.id)}">Approve</button>
              <button class="icon-button" type="button" data-reject-exchange="${escapeHtml(exchange.id)}">Reject</button>
            </div>
          ` : `<span class="empty-state compact-empty">Closed</span>`}
        </td>
      </tr>
    `;
  }).join("");
}

async function renderRotaReview() {
  setHeader("Rota Review", "Warnings, overrides, workload, and exchange approvals");
  if (!viewRoot) return;
  viewRoot.innerHTML = `<section class="panel"><h3>Loading rota review...</h3></section>`;
  try {
    [rotaReview, members] = await Promise.all([
      getRotaReviewMonth(rotaReviewMonth),
      getMembers(),
    ]);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Failed to load rota review", "error");
    viewRoot.innerHTML = `<section class="panel"><h3>Rota review unavailable</h3><p>Unable to load review dashboard and exchange controls.</p></section>`;
    return;
  }
  const review = rotaReview;
  viewRoot.innerHTML = `
    <section class="panel action-panel">
      <div>
        <h3>${escapeHtml(review.rota_period.name)}</h3>
        <p>${review.rota_period.starts_on} to ${review.rota_period.ends_on}. Review open slots, overrides, workload, and exchange requests before final publish.</p>
      </div>
      <div class="topbar-actions">
        <label for="rota-review-month" class="visually-hidden">Rota review month</label>
        <input id="rota-review-month" type="month" value="${rotaReviewMonth}" />
        <button class="icon-button" type="button" data-view-shortcut="rota-template">Open Template</button>
      </div>
    </section>
    <section class="summary-grid four-col">
      ${metricCard(review.summary.review_items, "Review items", undefined, "metric-weekend")}
      ${metricCard(review.summary.hard_blocked_items, "Hard-blocked items")}
      ${metricCard(review.summary.override_assignments, "Override assignments")}
      ${metricCard(review.summary.pending_exchange_requests, "Pending exchanges")}
    </section>
    <section class="summary-grid four-col">
      ${metricCard(review.summary.total_slots, "Template slots")}
      ${metricCard(review.summary.assigned_slots, "Assigned slots", undefined, "metric-primary")}
      ${metricCard(review.summary.open_slots, "Open slots")}
      ${metricCard(review.person_workload.length, "People assigned")}
    </section>
    <section class="panel table-panel">
      <h3>Warnings And Open Slots</h3>
      <table>
        <thead><tr><th>Date</th><th>Unit</th><th>Duty</th><th>Status</th><th>Reason</th><th>Assigned</th><th>Suggestions</th><th>Action</th></tr></thead>
        <tbody>${renderReviewItemRows(review) || `<tr><td colspan="8" class="empty">No review items found for this month.</td></tr>`}</tbody>
      </table>
    </section>
    <section class="panel table-panel">
      <h3>Person-Wise Duty Load</h3>
      <table>
        <thead><tr><th>Member</th><th>Total</th><th>24hr</th><th>Weekend 24hr</th><th>Overrides</th><th>Recent Duties</th></tr></thead>
        <tbody>${renderWorkloadRows(review) || `<tr><td colspan="6" class="empty">No saved assignments yet.</td></tr>`}</tbody>
      </table>
    </section>
    <section class="panel">
      <h3>Request Exchange</h3>
      <form class="leave-form exchange-form" id="rota-exchange-form">
        <label>Current assignment<select id="exchange-assignment" required><option value="">Select assignment</option>${renderExchangeAssignmentOptions(review)}</select></label>
        <label>New member<select id="exchange-target" required><option value="">Select member</option>${renderExchangeTargetOptions()}</select></label>
        <label class="leave-notes">Reason<input id="exchange-reason" placeholder="Why this exchange is needed" required /></label>
        <button class="primary" type="submit">Request Exchange</button>
      </form>
    </section>
    <section class="panel table-panel">
      <h3>Exchange Requests</h3>
      <table>
        <thead><tr><th>Status</th><th>Slot</th><th>Exchange</th><th>Reason</th><th>Audit</th><th>Decision</th></tr></thead>
        <tbody>${renderExchangeRows(review) || `<tr><td colspan="6" class="empty">No exchange requests yet.</td></tr>`}</tbody>
      </table>
    </section>
  `;
}

function checklistStatusClass(status: string): string {
  if (status === "clear") return "ok";
  if (status === "warning") return "warning";
  if (status === "blocked") return "error";
  return "";
}

function renderChecklistCards(items: RotaPublishChecklistItem[], empty: string): string {
  if (!items.length) return `<p class="empty-state">${escapeHtml(empty)}</p>`;
  return `
    <div class="publish-checklist-grid">
      ${items.map((item) => `
        <article class="publish-checklist-card">
          <header>
            <span class="status ${checklistStatusClass(item.status)}">${escapeHtml(leaveTypeLabel(item.status))}</span>
            <strong>${escapeHtml(item.title)}</strong>
          </header>
          <p>${escapeHtml(item.detail)}</p>
        </article>
      `).join("")}
    </div>
  `;
}

function renderLatestPublish(publish: RotaPublishMonth): string {
  const latest = publish.latest_publish;
  if (!latest) {
    return `<p class="empty-state">This rota has not been published yet.</p>`;
  }
  return `
    <div class="audit-chip-row">
      <span><strong>${escapeHtml(exchangeStatusLabel(latest.status))}</strong> status</span>
      <span><strong>${escapeHtml(latest.approved_by ?? "Unknown")}</strong> approved by</span>
      <span><strong>${escapeHtml(new Date(latest.created_at).toLocaleString())}</strong> approved at</span>
      <span><strong>${latest.confirmed_warnings ? "Yes" : "No"}</strong> warnings confirmed</span>
    </div>
    <p>${escapeHtml(latest.approval_note)}</p>
  `;
}

async function renderRotaPublish() {
  setHeader("Publish & Export", "Final checklist, board approval, and Excel export");
  if (!viewRoot) return;
  viewRoot.innerHTML = `<section class="panel"><h3>Loading publish checklist...</h3></section>`;
  try {
    rotaPublish = await getRotaPublishMonth(rotaPublishMonth);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Failed to load publish checklist", "error");
    viewRoot.innerHTML = `<section class="panel"><h3>Publish unavailable</h3><p>Unable to load final checklist and export controls.</p></section>`;
    return;
  }
  const publish = rotaPublish;
  viewRoot.innerHTML = `
    <section class="panel action-panel">
      <div>
        <h3>${escapeHtml(publish.rota_period.name)}</h3>
        <p>${publish.rota_period.starts_on} to ${publish.rota_period.ends_on}. Rule version: ${escapeHtml(publish.rule_version.name)}.</p>
      </div>
      <div class="topbar-actions">
        <label for="rota-publish-month" class="visually-hidden">Publish month</label>
        <input id="rota-publish-month" type="month" value="${rotaPublishMonth}" />
        <button class="icon-button" type="button" data-view-shortcut="rota-review">Open Review</button>
      </div>
    </section>
    <section class="summary-grid four-col">
      ${metricCard(publish.summary.total_slots, "Template slots")}
      ${metricCard(publish.summary.assigned_slots, "Assigned slots", undefined, "metric-primary")}
      ${metricCard(publish.summary.open_slots, "Open slots")}
      ${metricCard(publish.blockers.length, "Checklist blockers")}
    </section>
    <section class="summary-grid four-col">
      ${metricCard(publish.summary.review_items, "Review items", undefined, "metric-weekend")}
      ${metricCard(publish.summary.hard_blocked_items, "Hard-blocked items")}
      ${metricCard(publish.summary.override_assignments, "Override assignments")}
      ${metricCard(publish.warnings.length, "Checklist warnings")}
    </section>
    <section class="panel publish-status-panel ${publish.can_publish ? "quality-ok" : "quality-warning"}">
      <h3>${publish.can_publish ? "Ready For Board Approval" : "Not Ready To Publish"}</h3>
      <p>${publish.can_publish ? "No blocking checklist items remain. Confirm warnings if present, then publish." : "Resolve every blocker before final approval can be recorded."}</p>
    </section>
    <section class="analytics-grid">
      <article class="panel">
        <h3>Clear Checks</h3>
        ${renderChecklistCards(publish.checks, "No clear checks yet.")}
      </article>
      <article class="panel">
        <h3>Blockers</h3>
        ${renderChecklistCards(publish.blockers, "No blockers.")}
      </article>
    </section>
    <section class="panel">
      <h3>Warnings To Confirm</h3>
      ${renderChecklistCards(publish.warnings, "No remaining warnings need confirmation.")}
    </section>
    <section class="panel">
      <h3>Publish Approval</h3>
      <form class="publish-form" id="rota-publish-form">
        <label class="checkbox-line">
          <input id="publish-confirm-warnings" type="checkbox" ${publish.requires_warning_confirmation ? "" : "checked"} />
          Confirm remaining warnings and override assignments
        </label>
        <label>Approval note<textarea id="publish-approval-note" rows="3" placeholder="Record who approved this rota and any board note"></textarea></label>
        <button class="primary" type="submit" ${publish.can_publish ? "" : "disabled"}>Publish Final Rota</button>
      </form>
    </section>
    <section class="panel action-panel">
      <div>
        <h3>Final Excel Export</h3>
        ${renderLatestPublish(publish)}
      </div>
      <button class="primary" type="button" id="download-rota-export" ${publish.latest_publish ? "" : "disabled"}>Download Excel</button>
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
        ${metricCard(diagnostics.database_counts.import_warnings ?? 0, "Import warnings")}
        ${metricCard(diagnostics.invalid_member_names, "Invalid member names")}
        ${metricCard(diagnostics.database_counts.user_accounts ?? 0, "Login accounts")}
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
      const selectedView = button.dataset.view ?? "overview";
      document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((item) => {
        const isSelected = item.dataset.view === selectedView;
        item.classList.toggle("active", isSelected);
        if (isSelected) {
          item.setAttribute("aria-current", "page");
        } else {
          item.removeAttribute("aria-current");
        }
      });
      closeSidebarOnMobile();
      if (selectedView === "mappings") {
        renderMappings();
      } else if (selectedView === "imports") {
        void renderImports();
      } else if (selectedView === "analysis") {
        void renderAnalysis();
      } else if (selectedView === "members") {
        void renderMembers();
      } else if (selectedView === "leave") {
        void renderLeave();
      } else if (selectedView === "units") {
        void renderUnitManagement();
      } else if (selectedView === "rota-setup") {
        void renderRotaSetup();
      } else if (selectedView === "rota-template") {
        void renderRotaTemplate();
      } else if (selectedView === "rota-review") {
        void renderRotaReview();
      } else if (selectedView === "rota-publish") {
        void renderRotaPublish();
      } else if (selectedView === "rota-rules") {
        void renderRotaRules();
      } else if (selectedView === "accounts") {
        void renderAccounts();
      } else if (selectedView === "diagnostics") {
        void renderDiagnostics();
      } else {
        void renderOverview();
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
    if (form.id === "rota-rules-form") {
      event.preventDefault();
      if (!rotaPhaseOneRules) return;
      const btn = form.querySelector<HTMLButtonElement>("#save-rota-rules");
      const nextRules = JSON.parse(JSON.stringify(rotaPhaseOneRules)) as RotaPhaseOneRules;
      nextRules.rest_rules.minimum_gap_after_24hr_hours = Number(form.querySelector<HTMLInputElement>("#rule-rest-hours")?.value ?? 24);
      nextRules.rest_rules.post_24hr_blocks_next_day_elective = Boolean(form.querySelector<HTMLInputElement>("#rule-post-blocks")?.checked);
      nextRules.unit_staffing_rules.minimum_available_count = Number(form.querySelector<HTMLInputElement>("#rule-min-available")?.value ?? 1);
      nextRules.unit_staffing_rules.warning_unavailable_percent = Number(form.querySelector<HTMLInputElement>("#rule-warning-percent")?.value ?? 30);
      nextRules.unit_staffing_rules.hard_block_unavailable_percent = Number(form.querySelector<HTMLInputElement>("#rule-hard-percent")?.value ?? 40);
      nextRules.unit_staffing_rules.small_unit_uses_absolute_minimum = Boolean(form.querySelector<HTMLInputElement>("#rule-small-unit")?.checked);
      nextRules.duty_count_limits.max_24hr_per_month = parseNumberOrNull(form.querySelector<HTMLInputElement>("#rule-max-24hr")?.value ?? "");
      nextRules.duty_count_limits.max_weekend_24hr_per_month = parseNumberOrNull(form.querySelector<HTMLInputElement>("#rule-max-weekend")?.value ?? "");
      form.querySelectorAll<HTMLInputElement>("[data-rule-index]").forEach((input) => {
        const index = Number(input.dataset.ruleIndex);
        const field = input.dataset.ruleField;
        const rule = nextRules.duty_rules[index];
        if (!rule || !field) return;
        if (field === "duration_hours") rule.duration_hours = Number(input.value || 0);
        else if (field === "allowed_call_levels") rule.allowed_call_levels = parseCsv(input.value);
        else if (input.type === "checkbox") {
          (rule as unknown as Record<string, boolean>)[field] = input.checked;
        } else {
          (rule as unknown as Record<string, string>)[field] = input.value.trim();
        }
      });
      setButtonLoading(btn, true, "Save Rules");
      try {
        const { rule_version: _ruleVersion, ...payload } = nextRules;
        rotaPhaseOneRules = await updateRotaPhaseOneRules(payload);
        showToast("Rota rules saved", "success");
        await renderRotaRules();
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Failed to save rota rules", "error");
        resetButton(btn);
      }
      return;
    }
    if (form.id === "rota-setup-form") {
      event.preventDefault();
      const btn = form.querySelector<HTMLButtonElement>("#save-rota-setup");
      const includedUnitIds: string[] = [];
      const excludedUnitIds: string[] = [];
      form.querySelectorAll<HTMLSelectElement>("[data-scope-unit]").forEach((select) => {
        const unitId = select.dataset.scopeUnit;
        if (!unitId) return;
        if (select.value === "included") includedUnitIds.push(unitId);
        if (select.value === "excluded") excludedUnitIds.push(unitId);
      });
      setButtonLoading(btn, true, "Save Scope");
      try {
        rotaSetup = await updateRotaSetupScope(rotaSetupMonth, {
          included_unit_ids: includedUnitIds,
          excluded_unit_ids: excludedUnitIds,
          include_excluded_units_in_safety: Boolean(form.querySelector<HTMLInputElement>("#scope-safety-excluded")?.checked),
          is_locked: Boolean(form.querySelector<HTMLInputElement>("#scope-locked")?.checked),
          lock_reason: form.querySelector<HTMLInputElement>("#scope-lock-reason")?.value || null,
        });
        showToast("Rota setup saved", "success");
        await renderRotaSetup();
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Failed to save rota setup", "error");
        resetButton(btn);
      }
      return;
    }
    if (form.id === "rota-template-form") {
      event.preventDefault();
      const btn = form.querySelector<HTMLButtonElement>("#generate-rota-template");
      const dutyKeys = Array.from(form.querySelectorAll<HTMLInputElement>("[data-template-duty]"))
        .filter((input) => input.checked)
        .map((input) => input.dataset.templateDuty)
        .filter((value): value is string => Boolean(value));
      if (!dutyKeys.length) {
        showToast("Select at least one duty type", "warning");
        return;
      }
      if (!confirmAction("Generate the leave-aware empty slot template for this month?")) return;
      setButtonLoading(btn, true, "Generate Template");
      try {
        rotaTemplate = await generateRotaTemplate(rotaTemplateMonth, {
          duty_keys: dutyKeys,
          starts_on: form.querySelector<HTMLInputElement>("#template-start")?.value || null,
          ends_on: form.querySelector<HTMLInputElement>("#template-end")?.value || null,
          include_weekdays: Boolean(form.querySelector<HTMLInputElement>("#template-weekdays")?.checked),
          include_weekends: Boolean(form.querySelector<HTMLInputElement>("#template-weekends")?.checked),
          replace_existing: Boolean(form.querySelector<HTMLInputElement>("#template-replace")?.checked),
        });
        showToast(`Generated ${rotaTemplate.latest_run?.created_slots ?? 0} empty slot(s)`, "success");
        rejectedRotaCandidates.clear();
        await renderRotaTemplate();
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Failed to generate rota template", "error");
        resetButton(btn);
      }
      return;
    }
    if (form.id === "rota-exchange-form") {
      event.preventDefault();
      const btn = form.querySelector<HTMLButtonElement>("button[type='submit']");
      const assignmentId = form.querySelector<HTMLSelectElement>("#exchange-assignment")?.value ?? "";
      const toPersonId = form.querySelector<HTMLSelectElement>("#exchange-target")?.value ?? "";
      const reason = form.querySelector<HTMLInputElement>("#exchange-reason")?.value.trim() ?? "";
      if (!assignmentId || !toPersonId || !reason) {
        showToast("Assignment, new member, and reason are required", "warning");
        return;
      }
      setButtonLoading(btn, true, "Request Exchange");
      try {
        const exchange = await requestRotaExchange({
          assignment_id: assignmentId,
          to_person_id: toPersonId,
          reason,
        });
        showToast(`Exchange request saved: ${exchangeStatusLabel(exchange.status)}`, "success");
        await renderRotaReview();
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Failed to request exchange", "error");
        resetButton(btn);
      }
      return;
    }
    if (form.id === "rota-publish-form") {
      event.preventDefault();
      const btn = form.querySelector<HTMLButtonElement>("button[type='submit']");
      const confirmWarnings = Boolean(form.querySelector<HTMLInputElement>("#publish-confirm-warnings")?.checked);
      const approvalNote = form.querySelector<HTMLTextAreaElement>("#publish-approval-note")?.value.trim() ?? "";
      if (!approvalNote) {
        showToast("Approval note is required", "warning");
        return;
      }
      if (!confirmAction("Publish this rota as final?")) return;
      setButtonLoading(btn, true, "Publish Final Rota");
      try {
        rotaPublish = await publishRotaMonth(rotaPublishMonth, {
          confirm_warnings: confirmWarnings,
          approval_note: approvalNote,
        });
        showToast("Final rota published", "success");
        await renderRotaPublish();
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Failed to publish rota", "error");
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
    if (form.id === "leave-form") {
      event.preventDefault();
      const btn = form.querySelector<HTMLButtonElement>("button[type='submit']");
      const personId = form.querySelector<HTMLSelectElement>("#leave-person")?.value ?? "";
      const startsOn = form.querySelector<HTMLInputElement>("#leave-start")?.value ?? "";
      const endsOn = form.querySelector<HTMLInputElement>("#leave-end")?.value ?? "";
      const leaveSlot = form.querySelector<HTMLSelectElement>("#leave-slot")?.value ?? "FULL_DAY";
      const leaveType = form.querySelector<HTMLSelectElement>("#leave-type")?.value ?? "ANNUAL_LEAVE";
      const status = form.querySelector<HTMLSelectElement>("#leave-status")?.value ?? "approved";
      const notes = form.querySelector<HTMLInputElement>("#leave-notes")?.value ?? "";
      if (!personId || !startsOn || !endsOn) {
        showToast("Member and leave dates are required", "warning");
        return;
      }
      setButtonLoading(btn, true, "Add Leave");
      try {
        await createLeaveRequest({
          person_id: personId,
          starts_on: startsOn,
          ends_on: endsOn,
          leave_slot: leaveSlot,
          leave_type: leaveType,
          status,
          notes: notes || null,
        });
        showToast("Leave added", "success");
        await renderLeave();
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Failed to add leave", "error");
        resetButton(btn);
      }
      return;
    }
    if (form.id === "leave-import-form") {
      event.preventDefault();
      const btn = form.querySelector<HTMLButtonElement>("button[type='submit']");
      const file = form.querySelector<HTMLInputElement>("#leave-import-file")?.files?.[0];
      if (!file) {
        showToast("Choose a CSV or XLSX leave file first", "warning");
        return;
      }
      setButtonLoading(btn, true, "Preview File");
      try {
        leaveImportFile = file;
        leaveImportPreview = await previewLeaveImport(leaveMonth, file);
        showToast("Leave import preview ready", "success");
        await renderLeave();
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Failed to preview leave file", "error");
        resetButton(btn);
      }
      return;
    }
    if (form.id === "unit-assignment-form") {
      event.preventDefault();
      const btn = form.querySelector<HTMLButtonElement>("button[type='submit']");
      const formValues = unitAssignmentPayloadFromForm(form);
      if (!formValues.person_id || !formValues.unit_id || !formValues.posting_type || !formValues.starts_on) {
        showToast("Member, unit, posting, and start date are required", "warning");
        return;
      }
      setButtonLoading(btn, true, "Add Assignment");
      try {
        const payload = {
          person_id: formValues.person_id,
          unit_id: formValues.unit_id,
          posting_type: formValues.posting_type,
          starts_on: formValues.starts_on,
          ends_on: formValues.ends_on || null,
          notes: formValues.notes || null,
        };
        await createUnitAssignment(payload);
        showToast("Unit assignment added", "success");
        unitModalUnitId = payload.unit_id;
        unitEditingAssignmentId = null;
        await renderUnitManagement();
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Failed to save unit assignment", "error");
        resetButton(btn);
      }
      return;
    }
    if (form.dataset.unitRowForm) {
      event.preventDefault();
      const assignmentId = form.dataset.unitRowForm;
      const btn = form.querySelector<HTMLButtonElement>("button[type='submit']");
      const formValues = unitAssignmentPayloadFromForm(form);
      if (!formValues.person_id || !formValues.unit_id || !formValues.posting_type || !formValues.starts_on) {
        showToast("Member, unit, posting, and start date are required", "warning");
        return;
      }
      setButtonLoading(btn, true, "Save");
      try {
        const payload = {
          person_id: formValues.person_id,
          unit_id: formValues.unit_id,
          posting_type: formValues.posting_type,
          starts_on: formValues.starts_on,
          ends_on: formValues.ends_on || null,
          notes: formValues.notes || null,
        };
        await updateUnitAssignment(assignmentId, payload);
        unitModalUnitId = payload.unit_id;
        showToast("Unit assignment updated", "success");
        await renderUnitManagement();
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Failed to save unit assignment", "error");
        resetButton(btn);
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

    const viewShortcut = target.closest<HTMLButtonElement>("[data-view-shortcut]");
    if (viewShortcut?.dataset.viewShortcut) {
      const view = viewShortcut.dataset.viewShortcut;
      document.querySelector<HTMLButtonElement>(`[data-view="${view}"]`)?.click();
      return;
    }

    const pageBtn = target.closest<HTMLButtonElement>("[data-set-page]");
    if (pageBtn?.dataset.setPage) {
      const [tableId, pageStr] = pageBtn.dataset.setPage.split(":");
      setPage(tableId, parseInt(pageStr, 10));
      refreshAnalysisTabContent();
      return;
    }

    const cancelLeaveBtn = target.closest<HTMLButtonElement>("[data-cancel-leave]");
    if (cancelLeaveBtn?.dataset.cancelLeave) {
      setButtonLoading(cancelLeaveBtn, true, "Cancel");
      try {
        await cancelLeaveRequest(cancelLeaveBtn.dataset.cancelLeave);
        showToast("Leave cancelled", "success");
        await renderLeave();
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Failed to cancel leave", "error");
        resetButton(cancelLeaveBtn);
      }
      return;
    }

    const leaveDayBtn = target.closest<HTMLButtonElement>("[data-leave-day]");
    if (leaveDayBtn?.dataset.leaveDay) {
      openLeaveDayModal(leaveDayBtn.dataset.leaveDay);
      return;
    }

    const rotaDayBtn = target.closest<HTMLButtonElement>("[data-rota-day]");
    if (rotaDayBtn?.dataset.rotaDay) {
      openRotaDayModal(rotaDayBtn.dataset.rotaDay);
      return;
    }

    const unitOpenBtn = target.closest<HTMLElement>("[data-open-unit-modal]");
    if (unitOpenBtn?.dataset.openUnitModal) {
      openUnitModal(unitOpenBtn.dataset.openUnitModal);
      return;
    }

    const unitDeleteBtn = target.closest<HTMLButtonElement>("[data-delete-unit-assignment]");
    if (unitDeleteBtn?.dataset.deleteUnitAssignment) {
      if (!confirmAction("Remove this unit assignment?")) return;
      setButtonLoading(unitDeleteBtn, true, "Remove");
      try {
        await deleteUnitAssignment(unitDeleteBtn.dataset.deleteUnitAssignment);
        if (unitEditingAssignmentId === unitDeleteBtn.dataset.deleteUnitAssignment) {
          unitEditingAssignmentId = null;
        }
        showToast("Unit assignment removed", "success");
        await renderUnitManagement();
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Failed to remove unit assignment", "error");
        resetButton(unitDeleteBtn);
      }
      return;
    }

    if (target.id === "cancel-unit-edit") {
      unitEditingAssignmentId = null;
      await renderUnitManagement();
      return;
    }

    if (target.id === "clone-rota-scope") {
      const btn = target.closest<HTMLButtonElement>("#clone-rota-scope");
      setButtonLoading(btn, true, "Clone Previous");
      try {
        rotaSetup = await clonePreviousRotaSetupScope(rotaSetupMonth);
        showToast("Previous month scope cloned", "success");
        await renderRotaSetup();
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Failed to clone previous scope", "error");
        resetButton(btn);
      }
      return;
    }

    if (target.id === "apply-leave-import") {
      const btn = target.closest<HTMLButtonElement>("#apply-leave-import");
      if (!leaveImportFile) {
        showToast("Preview a leave file before applying import", "warning");
        return;
      }
      if (!confirmAction("Create leave records for all safely matched preview rows?")) return;
      setButtonLoading(btn, true, "Apply Matched Rows");
      try {
        const result = await applyLeaveImport(leaveMonth, leaveImportFile);
        leaveImportPreview = result.preview;
        showToast(`Imported ${result.created_rows} leave row(s); skipped ${result.skipped_rows}`, "success");
        await renderLeave();
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Failed to apply leave import", "error");
        resetButton(btn);
      }
      return;
    }

    if (target.id === "run-safe-auto-fill") {
      const btn = target.closest<HTMLButtonElement>("#run-safe-auto-fill");
      if (!confirmAction("Run safe auto-fill for open slots? Only clear, low-risk suggestions will be assigned.")) return;
      setButtonLoading(btn, true, "Safe Auto-Fill");
      try {
        const result = await runRotaAutoFillDraft(rotaTemplateMonth);
        rejectedRotaCandidates.clear();
        showToast(`Auto-filled ${result.assigned_slots} slot(s); left ${result.skipped_slots} open`, "success");
        closeRotaDayModal();
        await renderRotaTemplate();
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Safe auto-fill failed", "error");
        resetButton(btn);
      }
      return;
    }

    const assignSlotBtn = target.closest<HTMLButtonElement>("[data-assign-slot]");
    if (assignSlotBtn?.dataset.assignSlot) {
      const slotId = assignSlotBtn.dataset.assignSlot;
      const personId = document.querySelector<HTMLSelectElement>(`[data-assign-person="${slotId}"]`)?.value ?? "";
      const overrideReason = document.querySelector<HTMLInputElement>(`[data-assign-override="${slotId}"]`)?.value.trim() ?? "";
      const replaceExisting = Boolean(document.querySelector<HTMLInputElement>(`[data-assign-replace="${slotId}"]`)?.checked);
      if (!personId) {
        showToast("Select a member to assign", "warning");
        return;
      }
      setButtonLoading(assignSlotBtn, true, replaceExisting ? "Replace" : "Assign");
      try {
        const result = await assignRotaSlot(slotId, {
          person_id: personId,
          replace_existing: replaceExisting,
          override_reason: overrideReason || null,
        });
        showToast(result.status === "unchanged" ? "Member is already assigned to this slot" : "Rota assignment saved", "success");
        closeRotaDayModal();
        await renderRotaTemplate();
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Failed to save rota assignment", "error");
        resetButton(assignSlotBtn);
      }
      return;
    }

    const acceptCandidateBtn = target.closest<HTMLButtonElement>("[data-accept-candidate]");
    if (acceptCandidateBtn?.dataset.acceptCandidate) {
      const [slotId, personId] = acceptCandidateBtn.dataset.acceptCandidate.split(":");
      const slot = rotaTemplate?.slots.find((item) => item.id === slotId);
      if (!slot || !personId) return;
      setButtonLoading(acceptCandidateBtn, true, "Use");
      try {
        await assignRotaSlot(slotId, {
          person_id: personId,
          replace_existing: slot.assignments.length > 0,
          override_reason: null,
        });
        showToast("Suggested candidate assigned", "success");
        closeRotaDayModal();
        await renderRotaTemplate();
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Failed to use suggestion", "error");
        resetButton(acceptCandidateBtn);
      }
      return;
    }

    const selectCandidateBtn = target.closest<HTMLButtonElement>("[data-select-candidate]");
    if (selectCandidateBtn?.dataset.selectCandidate) {
      const [slotId, personId] = selectCandidateBtn.dataset.selectCandidate.split(":");
      const select = document.querySelector<HTMLSelectElement>(`[data-assign-person="${slotId}"]`);
      const reason = document.querySelector<HTMLInputElement>(`[data-assign-override="${slotId}"]`);
      if (select && personId) {
        select.value = personId;
        reason?.focus();
        showToast("Suggestion selected. Add an override reason before assigning.", "info");
      }
      return;
    }

    const rejectCandidateBtn = target.closest<HTMLButtonElement>("[data-reject-candidate]");
    if (rejectCandidateBtn?.dataset.rejectCandidate) {
      rejectedRotaCandidates.add(rejectCandidateBtn.dataset.rejectCandidate);
      rejectCandidateBtn.closest<HTMLElement>("[data-candidate-card]")?.remove();
      showToast("Suggestion hidden for this session", "info");
      return;
    }

    const clearAssignmentBtn = target.closest<HTMLButtonElement>("[data-clear-rota-assignment]");
    if (clearAssignmentBtn?.dataset.clearRotaAssignment) {
      if (!confirmAction("Clear this rota assignment?")) return;
      setButtonLoading(clearAssignmentBtn, true, "Clear");
      try {
        await clearRotaAssignment(clearAssignmentBtn.dataset.clearRotaAssignment);
        showToast("Rota assignment cleared", "success");
        closeRotaDayModal();
        await renderRotaTemplate();
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Failed to clear rota assignment", "error");
        resetButton(clearAssignmentBtn);
      }
      return;
    }

    const approveExchangeBtn = target.closest<HTMLButtonElement>("[data-approve-exchange]");
    if (approveExchangeBtn?.dataset.approveExchange) {
      const exchangeId = approveExchangeBtn.dataset.approveExchange;
      const decisionReason = document.querySelector<HTMLInputElement>(
        `[data-exchange-decision="${exchangeId}"]`,
      )?.value.trim() ?? "";
      if (!confirmAction("Approve this exchange and replace the current assignment?")) return;
      setButtonLoading(approveExchangeBtn, true, "Approve");
      try {
        await approveRotaExchange(exchangeId, decisionReason || null);
        showToast("Exchange approved and assignment updated", "success");
        await renderRotaReview();
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Failed to approve exchange", "error");
        resetButton(approveExchangeBtn);
      }
      return;
    }

    const rejectExchangeBtn = target.closest<HTMLButtonElement>("[data-reject-exchange]");
    if (rejectExchangeBtn?.dataset.rejectExchange) {
      const exchangeId = rejectExchangeBtn.dataset.rejectExchange;
      const decisionReason = document.querySelector<HTMLInputElement>(
        `[data-exchange-decision="${exchangeId}"]`,
      )?.value.trim() ?? "";
      if (!confirmAction("Reject this exchange request?")) return;
      setButtonLoading(rejectExchangeBtn, true, "Reject");
      try {
        await rejectRotaExchange(exchangeId, decisionReason || null);
        showToast("Exchange rejected", "success");
        await renderRotaReview();
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Failed to reject exchange", "error");
        resetButton(rejectExchangeBtn);
      }
      return;
    }

    if (target.id === "download-rota-export") {
      const btn = target.closest<HTMLButtonElement>("#download-rota-export");
      setButtonLoading(btn, true, "Download Excel");
      try {
        const { blob, filename } = await downloadRotaExport(rotaPublishMonth);
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        showToast("Final Excel export downloaded", "success");
        resetButton(btn);
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Failed to download export", "error");
        resetButton(btn);
      }
      return;
    }

    const analysisTabBtn = target.closest<HTMLButtonElement>("[data-analysis-tab]");
    if (analysisTabBtn?.dataset.analysisTab) {
      analysisTab = analysisTabBtn.dataset.analysisTab;
      resetPages();
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
        showToast(`Import complete: ${result.import.duty_assignments_created ?? 0} assignments`, "success");
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Import failed", "error");
      } finally {
        resetButton(btn);
      }
      return;
    }

    if (target.id === "clear-member-filters") {
      memberSearch = "";
      memberStatusFilter = "active";
      memberPositionFilter = "all";
      memberCallLevelFilter = "all";
      memberSort = "name";
      memberSortDirection = "asc";
      saveFocus();
      renderMembersView();
      restoreFocus();
      return;
    }

    const statusToggle = target.closest<HTMLButtonElement>("[data-member-status]");
    if (statusToggle?.dataset.memberStatus) {
      memberStatusFilter = statusToggle.dataset.memberStatus as "all" | "active" | "historical";
      saveFocus();
      renderMembersView();
      restoreFocus();
      return;
    }

    const callChip = target.closest<HTMLButtonElement>("[data-call-chip]");
    if (callChip?.dataset.callChip) {
      const clicked = callChip.dataset.callChip;
      memberCallLevelFilter = memberCallLevelFilter === clicked ? "all" : clicked;
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
    if (target.matches("[data-close-leave-day-modal]") || target.id === "leave-day-modal") {
      closeLeaveDayModal();
    }
    if (target.matches("[data-close-rota-day-modal]") || target.id === "rota-day-modal") {
      closeRotaDayModal();
    }
    if (target.matches("[data-close-unit-modal]") || target.id === "unit-management-modal") {
      closeUnitModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeAnalysisPersonModal();
      closeLeaveDayModal();
      closeRotaDayModal();
      closeUnitModal();
      if (sidebarOpen) toggleSidebar(false);
    }
    const target = event.target as HTMLElement;
    const unitOpener = target.closest<HTMLElement>("[data-open-unit-modal]");
    if (unitOpener?.dataset.openUnitModal && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      openUnitModal(unitOpener.dataset.openUnitModal);
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
    if (target.id === "leave-month") {
      leaveMonth = target.value || leaveMonth;
      leaveImportPreview = null;
      leaveImportFile = null;
      await renderLeave();
      return;
    }
    if (target.id === "unit-month") {
      unitMonth = target.value || unitMonth;
      closeUnitModal();
      unitEditingAssignmentId = null;
      await renderUnitManagement();
      return;
    }
    if (target.id === "rota-setup-month") {
      rotaSetupMonth = target.value || rotaSetupMonth;
      await renderRotaSetup();
      return;
    }
    if (target.id === "rota-template-month") {
      rotaTemplateMonth = target.value || rotaTemplateMonth;
      rejectedRotaCandidates.clear();
      closeRotaDayModal();
      await renderRotaTemplate();
      return;
    }
    if (target.id === "rota-review-month") {
      rotaReviewMonth = target.value || rotaReviewMonth;
      await renderRotaReview();
      return;
    }
    if (target.id === "rota-publish-month") {
      rotaPublishMonth = target.value || rotaPublishMonth;
      await renderRotaPublish();
      return;
    }
    if (target.dataset.callLevel) {
      if (!isAdminUser()) return;
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
      setPage("personnel", 0);
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
    if (isAdminUser()) {
      await loadMappings();
    }
    await renderOverview();
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
