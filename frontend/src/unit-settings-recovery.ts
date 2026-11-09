type RecoveryOptions<T> = {
  current: () => boolean;
  save: () => Promise<unknown>;
  confirmed: () => void;
  read: () => Promise<T>;
  commit: (result: T) => void;
  refreshed: () => void;
};

type FormRecovery = {
  busy: boolean;
  confirmed: boolean;
  signature: string;
  message: HTMLElement;
  retry: HTMLButtonElement;
  saveButton: HTMLButtonElement;
};

const recoveries = new WeakMap<HTMLFormElement, FormRecovery>();

function signature(form: HTMLFormElement): string {
  // Compare exactly the numeric values consumed by the existing save payload.
  // Equivalent input spellings must not permit an unchanged confirmed update.
  return JSON.stringify({
    minimum_free_people: Math.floor(Number(form.querySelector<HTMLInputElement>('#unit-minimum-free-people')?.value ?? 0)),
    call_minimums: [...form.querySelectorAll<HTMLInputElement>('[data-unit-call-minimum]')]
      .map(input => ({call_level: input.dataset.unitCallMinimum ?? '', minimum_free_people: Math.floor(Number(input.value ?? 0))})),
  });
}

function hasNewDraft(form: HTMLFormElement, state: FormRecovery): boolean {
  return signature(form) !== state.signature;
}

function syncSave(form: HTMLFormElement, state: FormRecovery) {
  state.saveButton.disabled = state.busy || (state.confirmed && !hasNewDraft(form, state));
  state.saveButton.textContent = state.busy ? 'Saving rules…' : 'Save Call-Wise Rules';
  state.saveButton.setAttribute('aria-busy', String(state.busy));
}

function recoveryState(form: HTMLFormElement, button: HTMLButtonElement): FormRecovery {
  const existing = recoveries.get(form);
  if (existing) return existing;
  const region = document.createElement('section');
  region.dataset.unitSettingsRecovery = '';
  region.className = 'unit-settings-recovery';
  const message = document.createElement('p');
  message.setAttribute('role', 'status');
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.dataset.retryUnitSettingsRead = '';
  retry.textContent = 'Retry saved rules refresh';
  retry.hidden = true;
  retry.style.display = 'none';
  region.append(message, retry);
  form.append(region);
  const state = {busy:false, confirmed:false, signature:'', message, retry, saveButton:button};
  recoveries.set(form, state);
  form.addEventListener('input', () => {
    syncSave(form, state);
    if (state.confirmed && hasNewDraft(form, state))
      state.message.textContent = state.retry.hidden
        ? 'Previous rules are saved. New edits are not saved yet.'
        : 'Previous rules are saved; their refresh is incomplete. New edits are not saved yet.';
    else if (state.confirmed)
      state.message.textContent = state.retry.hidden
        ? 'Previous rules are saved and refreshed. There are no new unsaved edits.'
        : 'Previous rules are saved; their refresh is incomplete. Retry refresh without saving again.';
  });
  return state;
}

/** Keep confirmed settings mutations separate from a retryable dependent read. */
export async function saveUnitSettingsWithRecovery<T>(
  form: HTMLFormElement,
  button: HTMLButtonElement,
  options: RecoveryOptions<T>,
) {
  const state = recoveryState(form, button);
  if (state.busy || !options.current()) return;
  if (state.confirmed && !hasNewDraft(form, state)) {
    state.retry.focus({preventScroll:true});
    return;
  }
  const submitInitiator = document.activeElement;
  let submitFocusMoved = false;
  const trackSubmitFocus = (event: FocusEvent) => {
    if (event.target !== submitInitiator && event.target !== document.body) submitFocusMoved = true;
  };
  document.addEventListener('focusin', trackSubmitFocus, true);

  const refresh = async (fromRetry: boolean) => {
    if (state.busy || !options.current()) return;
    const initiator = document.activeElement;
    let focusMoved = false;
    const trackFocus = (event: FocusEvent) => {
      if (event.target !== initiator && event.target !== document.body) focusMoved = true;
    };
    document.addEventListener('focusin', trackFocus, true);
    state.busy = true;
    state.retry.disabled = true;
    state.message.textContent = 'Rules saved. Refreshing saved rules…';
    syncSave(form, state);
    try {
      const result = await options.read();
      if (!options.current()) return;
      const newerDraft = hasNewDraft(form, state);
      options.commit(result);
      // New call fields arrived from the read, not from a user edit. Extend only
      // those fields in the saved baseline; existing unsaved values stay dirty.
      const baseline = JSON.parse(state.signature) as {minimum_free_people: number; call_minimums: Array<{call_level: string; minimum_free_people: number}>};
      const values = JSON.parse(signature(form)) as typeof baseline;
      for (const row of values.call_minimums)
        if (!baseline.call_minimums.some(previous => previous.call_level === row.call_level)) baseline.call_minimums.push(row);
      state.signature = JSON.stringify(baseline);
      const retryOwnedFocus = fromRetry && !focusMoved && initiator === state.retry
        && (document.activeElement === state.retry || document.activeElement === document.body);
      state.retry.hidden = true;
      state.retry.style.display = 'none';
      if (newerDraft) {
        state.message.textContent = 'Previous rules are saved and refreshed. New edits are not saved yet.';
        if (retryOwnedFocus) {
          state.message.tabIndex = -1;
          state.message.focus({preventScroll:true});
        }
      } else {
        options.refreshed();
      }
    } catch (error) {
      if (!options.current()) return;
      const detail = error instanceof Error ? error.message : 'Saved rules could not be refreshed.';
      state.message.textContent = `Rules saved, but the refresh failed. ${detail} Retry refresh without saving again.${hasNewDraft(form,state) ? ' New edits are not saved yet.' : ''}`;
      state.retry.hidden = false;
      state.retry.style.display = '';
      state.retry.onclick = () => { void refresh(true); };
      if (fromRetry && !focusMoved && (document.activeElement === initiator || document.activeElement === document.body))
        state.retry.focus({preventScroll:true});
      else if (!fromRetry && !submitFocusMoved && submitInitiator === button
        && (document.activeElement === button || document.activeElement === document.body))
        state.retry.focus({preventScroll:true});
    } finally {
      document.removeEventListener('focusin', trackFocus, true);
      state.busy = false;
      if (options.current()) {
        state.retry.disabled = false;
        syncSave(form, state);
      }
    }
  };

  state.signature = signature(form);
  state.confirmed = false;
  state.busy = true;
  state.retry.hidden = true;
  state.retry.style.display = 'none';
  state.message.textContent = 'Saving rules…';
  syncSave(form, state);
  try {
    await options.save();
    options.confirmed();
    state.confirmed = true;
    if (!options.current()) return;
    state.busy = false;
    await refresh(false);
  } catch (error) {
    if (!options.current()) return;
    state.message.textContent = error instanceof Error ? error.message : 'Rules could not be saved. Your edits are retained.';
  } finally {
    document.removeEventListener('focusin', trackSubmitFocus, true);
    state.busy = false;
    if (options.current()) syncSave(form, state);
  }
}
