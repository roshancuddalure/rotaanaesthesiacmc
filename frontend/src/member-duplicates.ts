// "Possible duplicate members" review window (admin). Each suspected pair is shown side by
// side; the admin picks which record to keep and confirms the merge, or marks the pair as
// "not the same person" so the server stops suggesting it. Nothing merges without a confirm.
import { workspaceDialog } from "./member-workspace";
import {
  dismissSuspectedDuplicate,
  getMemberMerges,
  getSuspectedDuplicates,
  mergeMembers,
  previewMerge,
  undoMemberMerge,
  type MemberMergeRecord,
  type MergePreview,
  type SuspectedDuplicate,
  type SuspectedDuplicatePerson,
} from "./services/api";
import { badge, codeLabel, emptyState, esc, type Tone } from "./ui";

const TITLE = "Possible duplicate members";

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function statusTone(status: string): Tone {
  const s = status.toLowerCase();
  if (s === "active") return "success";
  if (s === "inactive" || s === "archived" || s === "left") return "neutral";
  return "warning";
}

function personHtml(person: SuspectedDuplicatePerson): string {
  const aliases = person.aliases?.length ? person.aliases.join(", ") : "None";
  return `<div class="dup-person">
    <p class="dup-person__name">${esc(person.canonical_name)}</p>
    <p class="dup-person__meta">${badge(codeLabel(person.active_status, "Unknown"), statusTone(person.active_status))}
      <span>${esc(codeLabel(person.call_level, "No call level"))}</span></p>
    <p class="dup-person__counts">${esc(`${plural(person.duties, "duty", "duties")} · ${plural(person.postings, "posting")} · ${plural(person.leave, "leave")}`)}</p>
    <p class="muted-text dup-person__aliases">Aliases: ${esc(aliases)}</p>
  </div>`;
}

function cardHtml(pair: SuspectedDuplicate, index: number): string {
  const [a, b] = pair.people;
  const keep = pair.people.find((p) => p.id === pair.suggested_target_id) ?? a;
  const percent = Math.round((pair.similarity <= 1 ? pair.similarity * 100 : pair.similarity));
  const headingId = `dup-pair-${index}`;
  return `<article class="dup-card" data-pair="${esc(pair.pair_id)}" aria-labelledby="${headingId}">
    <h3 id="${headingId}" class="dup-card__title">${esc(a.canonical_name)} and ${esc(b.canonical_name)}
      ${badge(`${percent}% similar`, percent >= 90 ? "warning" : "info")}</h3>
    <p class="muted-text dup-card__reason">${esc(pair.reason)}</p>
    <div class="dup-card__people">${personHtml(a)}${personHtml(b)}</div>
    <fieldset class="dup-card__keep">
      <legend>Keep</legend>
      ${pair.people.map((p) => `<label><input type="radio" name="keep-${index}" value="${esc(p.id)}" ${p.id === keep.id ? "checked" : ""}> ${esc(p.canonical_name)}</label>`).join("")}
    </fieldset>
    <div class="dup-card__actions">
      <button type="button" class="danger-button btn-sm" data-merge>Review merge into ${esc(keep.canonical_name)}…</button>
      <button type="button" class="icon-button btn-sm" data-dismiss>Not the same person</button>
    </div>
    <div class="dup-card__preview" data-merge-preview hidden></div>
  </article>`;
}

/** The reviewed plan for one merge: what moves, what is combined, conflicts and warnings. */
function previewHtml(preview: MergePreview, keptName: string, otherName: string): string {
  const moves = Object.entries(preview.moves);
  const combined = preview.combined;
  return `<section class="merge-plan" aria-label="What this merge will do">
    <h4>What merging ${esc(otherName)} into ${esc(keptName)} will do</h4>
    ${preview.warnings.map((w) => `<p class="merge-plan__warning" role="note">${esc(w)}</p>`).join("")}
    ${moves.length ? `<ul class="merge-plan__moves">${moves.map(([kind, n]) => `<li><strong>${n}</strong> ${esc(kind)} move to ${esc(keptName)}</li>`).join("")}</ul>`
      : `<p class="muted-text">No records to move.</p>`}
    ${combined.length ? `<details class="merge-plan__combined"><summary>${esc(plural(combined.length, "duplicate"))} combined instead of copied</summary>
      <ul>${combined.slice(0, 50).map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
      ${combined.length > 50 ? `<p class="muted-text">and ${combined.length - 50} more</p>` : ""}</details>` : ""}
    ${preview.conflicts.map((c) => `<fieldset class="merge-plan__conflict"><legend>${esc(c.description)}</legend>
      <label><input type="radio" name="conflict-${esc(c.id)}" data-conflict="${esc(c.id)}" value="keep_target" ${c.chosen === "keep_target" ? "checked" : ""}> Keep ${esc(keptName)}'s</label>
      <label><input type="radio" name="conflict-${esc(c.id)}" data-conflict="${esc(c.id)}" value="keep_source" ${c.chosen === "keep_source" ? "checked" : ""}> Use ${esc(otherName)}'s</label>
    </fieldset>`).join("")}
    <p class="muted-text">${esc(otherName)}'s separate record is removed. You can undo this merge afterwards.</p>
    <div class="dup-card__actions">
      <button type="button" class="danger-button btn-sm" data-merge-confirm>Confirm merge</button>
      <button type="button" class="icon-button btn-sm" data-merge-cancel>Cancel</button>
    </div>
  </section>`;
}

function mergesHtml(merges: MemberMergeRecord[]): string {
  if (!merges.length) return "";
  return `<details class="dup-history"><summary>Recent merges (${merges.length})</summary><ul>${merges.slice(0, 30).map((m) => `<li>
      <span>${esc(m.source_names.join(", "))} → ${esc(m.target_name)} · ${esc(new Date(m.merged_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }))} · ${esc(m.operator_name)}</span>
      ${m.undone_at ? badge("Undone", "neutral") : `<button type="button" class="icon-button btn-sm" data-undo-merge="${esc(m.merge_id)}">Undo merge</button>`}
    </li>`).join("")}</ul></details>`;
}

export async function openSuspectedDuplicates(onChanged: () => void | Promise<void>): Promise<void> {
  const dialog = workspaceDialog(TITLE, "member-duplicates");
  dialog.innerHTML = `<header class="mw-header"><div><h2>${TITLE}</h2>
      <p>Records that may be the same person. Choose which to keep, then merge — or mark them as different people.</p></div>
      <button type="button" data-close aria-label="Close ${TITLE}">×</button></header>
    <div class="mw-content">
      <p role="status" aria-live="polite" class="dup-status" data-status></p>
      <div data-body></div>
    </div>`;
  const body = dialog.querySelector<HTMLElement>("[data-body]")!;
  const status = dialog.querySelector<HTMLElement>("[data-status]")!;
  let pairs: SuspectedDuplicate[] = [];
  let busy = false;
  const previews = new Map<string, { preview: MergePreview; choices: Record<string, string> }>();

  const say = (text: string) => { status.textContent = text; };
  const close = () => {
    if (busy) return;
    dialog.close();
    dialog.remove();
  };
  const refreshHistory = async () => {
    const host = body.querySelector<HTMLElement>("[data-history]");
    if (host) host.innerHTML = mergesHtml(await getMemberMerges().catch(() => []));
  };
  const showEmptyIfDone = () => {
    if (!body.querySelector(".dup-card")) {
      body.innerHTML = emptyState({ title: "No possible duplicates", body: "Every member record looks distinct." });
    }
  };
  const load = async () => {
    body.innerHTML = `<p class="muted-text" role="status">Looking for possible duplicates…</p>`;
    try {
      const [found, merges] = await Promise.all([getSuspectedDuplicates(), getMemberMerges().catch(() => [])]);
      pairs = found;
      body.innerHTML = pairs.length
        ? `<p class="muted-text">${esc(plural(pairs.length, "possible duplicate pair"))} to review.</p>${pairs.map(cardHtml).join("")}`
        : "";
      showEmptyIfDone();
      body.insertAdjacentHTML("beforeend", `<div data-history>${mergesHtml(merges)}</div>`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load possible duplicates";
      body.innerHTML = emptyState({
        title: "Could not load possible duplicates",
        body: message,
        tone: "danger",
        actionHtml: `<button type="button" class="primary btn-sm" data-retry>Try again</button>`,
      });
    }
  };
  const pairFor = (card: HTMLElement) => pairs.find((p) => p.pair_id === card.dataset.pair);
  const keptAndOther = (card: HTMLElement, pair: SuspectedDuplicate) => {
    const keptId = card.querySelector<HTMLInputElement>("input[type=radio]:checked")?.value ?? pair.suggested_target_id;
    const kept = pair.people.find((p) => p.id === keptId) ?? pair.people[0];
    const other = pair.people.find((p) => p.id !== kept.id)!;
    return { kept, other };
  };
  const removeCard = (card: HTMLElement) => {
    const next = (card.nextElementSibling ?? card.previousElementSibling) as HTMLElement | null;
    pairs = pairs.filter((p) => p.pair_id !== card.dataset.pair);
    card.remove();
    const focusTarget = next?.classList.contains("dup-card") ? next.querySelector<HTMLElement>("input:checked, button") : null;
    showEmptyIfDone();
    (focusTarget ?? dialog.querySelector<HTMLElement>("[data-close]"))?.focus();
  };
  const setCardBusy = (card: HTMLElement, value: boolean) => {
    busy = value;
    card.querySelectorAll<HTMLButtonElement | HTMLInputElement>("button, input").forEach((el) => { el.disabled = value; });
    card.setAttribute("aria-busy", String(value));
  };

  const hidePreview = (card: HTMLElement, pair: SuspectedDuplicate) => {
    previews.delete(pair.pair_id);
    const host = card.querySelector<HTMLElement>("[data-merge-preview]")!;
    host.hidden = true;
    host.innerHTML = "";
  };
  const showPreview = async (card: HTMLElement, pair: SuspectedDuplicate, choices: Record<string, string> = {}) => {
    const { kept, other } = keptAndOther(card, pair);
    const host = card.querySelector<HTMLElement>("[data-merge-preview]")!;
    setCardBusy(card, true);
    say(`Checking what merging ${other.canonical_name} into ${kept.canonical_name} would do… nothing is changed yet.`);
    try {
      const preview = await previewMerge(kept.id, [other.id], choices);
      previews.set(pair.pair_id, { preview, choices });
      host.innerHTML = previewHtml(preview, kept.canonical_name, other.canonical_name);
      host.hidden = false;
      say("Review the merge below, then confirm.");
      setCardBusy(card, false);
      host.querySelector<HTMLElement>("h4")?.setAttribute("tabindex", "-1");
      host.querySelector<HTMLElement>("h4")?.focus();
    } catch (error) {
      setCardBusy(card, false);
      say(`Could not check this merge: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  };

  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener("change", (event) => {
    const input = event.target as HTMLInputElement;
    if (input.type !== "radio") return;
    const card = input.closest<HTMLElement>(".dup-card");
    const pair = card && pairFor(card);
    if (!card || !pair) return;
    if (input.dataset.conflict) {
      const state = previews.get(pair.pair_id);
      if (state) void showPreview(card, pair, { ...state.choices, [input.dataset.conflict]: input.value });
      return;
    }
    const { kept } = keptAndOther(card, pair);
    card.querySelector<HTMLButtonElement>("[data-merge]")!.textContent = `Review merge into ${kept.canonical_name}…`;
    hidePreview(card, pair);
  });
  dialog.addEventListener("click", async (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-close]")) {
      close();
      return;
    }
    if (target.closest("[data-retry]")) {
      say("");
      await load();
      return;
    }
    const undo = target.closest<HTMLButtonElement>("[data-undo-merge]");
    if (undo && !busy) {
      busy = true;
      undo.disabled = true;
      say("Undoing the merge…");
      try {
        const result = await undoMemberMerge(undo.dataset.undoMerge!);
        busy = false;
        say(`Merge undone: ${result.restored.join(", ")} restored as a separate record.`);
        await onChanged();
        await load();
      } catch (error) {
        busy = false;
        undo.disabled = false;
        const err = error as Error & { detail?: { blockers?: string[] } };
        const blockers = err.detail?.blockers?.length ? ` ${err.detail.blockers.join("; ")}.` : "";
        say(`Could not undo: ${err.message || "unknown error"}.${blockers} Nothing was changed.`);
      }
      return;
    }
    const card = target.closest<HTMLElement>(".dup-card");
    const pair = card && pairFor(card);
    if (!card || !pair || busy) return;

    if (target.closest("[data-merge]")) {
      await showPreview(card, pair);
      return;
    }

    if (target.closest("[data-merge-cancel]")) {
      hidePreview(card, pair);
      say("Merge cancelled. Nothing was changed.");
      card.querySelector<HTMLElement>("[data-merge]")?.focus();
      return;
    }

    if (target.closest("[data-merge-confirm]")) {
      const state = previews.get(pair.pair_id);
      if (!state) return;
      const { kept, other } = keptAndOther(card, pair);
      setCardBusy(card, true);
      say(`Merging ${other.canonical_name} into ${kept.canonical_name}…`);
      try {
        const result = await mergeMembers(kept.id, [other.id], state.preview.preview_token, state.choices);
        setCardBusy(card, false);
        previews.delete(pair.pair_id);
        card.outerHTML = `<article class="dup-card dup-card--done" data-pair="${esc(pair.pair_id)}">
          <p>${badge("Merged", "success")} ${esc(other.canonical_name)} is now part of ${esc(kept.canonical_name)}.</p>
          ${result.merge_id ? `<button type="button" class="icon-button btn-sm" data-undo-merge="${esc(result.merge_id)}">Undo merge</button>` : ""}
        </article>`;
        pairs = pairs.filter((p) => p.pair_id !== pair.pair_id);
        say(`Merged ${other.canonical_name} into ${kept.canonical_name}. You can undo it below.`);
        await refreshHistory();
        await onChanged();
      } catch (error) {
        setCardBusy(card, false);
        const err = error as Error & { status?: number; detail?: { code?: string } };
        if (err.status === 409 && err.detail?.code === "stale_preview") {
          say("The records changed since this preview. Here is the updated plan; review it again.");
          await showPreview(card, pair, state.choices);
        } else {
          say(`Could not merge: ${err.message || "unknown error"}. Nothing was changed.`);
        }
      }
      return;
    }

    if (target.closest("[data-dismiss]")) {
      const [a, b] = pair.people;
      setCardBusy(card, true);
      say("Saving…");
      try {
        await dismissSuspectedDuplicate([a.id, b.id]);
        setCardBusy(card, false);
        removeCard(card);
        say(`Marked ${a.canonical_name} and ${b.canonical_name} as different people. They will not be suggested again.`);
      } catch (error) {
        setCardBusy(card, false);
        say(`Could not save: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    }
  });

  await load();
}
