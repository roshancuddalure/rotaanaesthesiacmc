// "Possible duplicate members" review window (admin). Each suspected pair is shown side by
// side; the admin picks which record to keep and confirms the merge, or marks the pair as
// "not the same person" so the server stops suggesting it. Nothing merges without a confirm.
import { workspaceDialog } from "./member-workspace";
import {
  dismissSuspectedDuplicate,
  getSuspectedDuplicates,
  mergeMembers,
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
      <button type="button" class="danger-button btn-sm" data-merge>Merge into ${esc(keep.canonical_name)}…</button>
      <button type="button" class="icon-button btn-sm" data-dismiss>Not the same person</button>
    </div>
  </article>`;
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

  const say = (text: string) => { status.textContent = text; };
  const close = () => {
    if (busy) return;
    dialog.close();
    dialog.remove();
  };
  const showEmptyIfDone = () => {
    if (!body.querySelector(".dup-card")) {
      body.innerHTML = emptyState({ title: "No possible duplicates", body: "Every member record looks distinct." });
    }
  };
  const load = async () => {
    body.innerHTML = `<p class="muted-text" role="status">Looking for possible duplicates…</p>`;
    try {
      pairs = await getSuspectedDuplicates();
      body.innerHTML = pairs.length
        ? `<p class="muted-text">${esc(plural(pairs.length, "possible duplicate pair"))} to review.</p>${pairs.map(cardHtml).join("")}`
        : "";
      showEmptyIfDone();
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
    const { kept } = keptAndOther(card, pair);
    card.querySelector<HTMLButtonElement>("[data-merge]")!.textContent = `Merge into ${kept.canonical_name}…`;
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
    const card = target.closest<HTMLElement>(".dup-card");
    const pair = card && pairFor(card);
    if (!card || !pair || busy) return;

    if (target.closest("[data-merge]")) {
      const { kept, other } = keptAndOther(card, pair);
      const ok = window.confirm(
        `Merge ${other.canonical_name} into ${kept.canonical_name}? ` +
        `Their ${plural(other.duties, "duty", "duties")}, ${plural(other.postings, "posting")}, ` +
        `${plural(other.leave, "leave record")} and aliases move to ${kept.canonical_name}, ` +
        `and ${other.canonical_name}'s separate record is removed. This cannot be undone.`,
      );
      if (!ok) return;
      setCardBusy(card, true);
      say(`Merging ${other.canonical_name} into ${kept.canonical_name}…`);
      try {
        await mergeMembers(kept.id, [other.id]);
        setCardBusy(card, false);
        removeCard(card);
        say(`Merged ${other.canonical_name} into ${kept.canonical_name}.`);
        await onChanged();
      } catch (error) {
        setCardBusy(card, false);
        say(`Could not merge: ${error instanceof Error ? error.message : "unknown error"}`);
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
