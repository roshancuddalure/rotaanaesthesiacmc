/** Isolated design review surface. No application API or persisted preferences. */
import './styles.css';
import './premium-theme.css';
import './component-reference.css';
import {badge, emptyState, esc, steps} from './ui';

const actionVariants = [
  {key:'primary', label:'Primary', className:'primary'},
  {key:'secondary', label:'Secondary', className:'icon-button'},
  {key:'quiet', label:'Quiet', className:'quiet-button'},
  {key:'danger', label:'Destructive', className:'danger-button'},
];
const geometryTokens = [
  ['Control minimum height','--control-height'], ['Field radius','--radius-sm'],
  ['Compact card radius','--radius-md'], ['Panel radius','--radius-lg'],
  ['Dialog radius','--radius-xl'], ['Body text','--text-base'],
  ['Secondary text','--text-sm'], ['Small gap','--space-2'],
  ['Field gap','--space-4'], ['Panel spacing','--space-6'],
];
const host = document.querySelector<HTMLElement>('#component-reference');
if (host) {
  host.innerHTML = `<header><p class="eyebrow">Design review only</p><h1>Royal component reference</h1><p>Representative visual and interaction states. These controls use local sample data and never save operational records.</p></header>
  <section class="panel" aria-labelledby="reference-foundation"><h2 id="reference-foundation">Live geometry tokens</h2><p>Values come from the loaded theme. The system follows your browser's light, dark and high-contrast preferences.</p><dl class="reference-token-grid">${geometryTokens.map(([label,token])=>`<div><dt>${esc(label)}</dt><dd><code>${esc(token)}</code><output data-reference-token="${esc(token)}"></output></dd></div>`).join('')}</dl><p>Icons use the application's existing local vector assets. Icon-family consolidation and every operational state require separate review; these samples do not certify them.</p></section>
  <section class="panel" aria-labelledby="reference-states"><h2 id="reference-states">Action variant states</h2><p>Use pointer hover, hold the pointer down for pressed state, or Tab for keyboard focus. Disabled and busy examples remain unavailable. Each enabled sample reports a local outcome.</p><div class="reference-variant-grid">${actionVariants.map(variant=>`<fieldset data-reference-variant="${variant.key}"><legend>${variant.label}</legend><div class="reference-actions"><button type="button" class="${variant.className}" data-reference-action="${variant.key}-default">${variant.label} sample</button><button type="button" class="${variant.className}" disabled aria-describedby="reference-unavailable-help">${variant.label} unavailable</button><button type="button" class="${variant.className}" disabled aria-busy="true">${variant.label} pending</button></div></fieldset>`).join('')}</div><p id="reference-unavailable-help">Unavailable samples demonstrate a missing prerequisite; pending samples demonstrate duplicate prevention.</p></section>
  <section class="panel" aria-labelledby="reference-selection"><h2 id="reference-selection">Selection and local recovery</h2><div class="analysis-tabs" role="tablist" aria-label="Reference state panels"><button type="button" class="analysis-tab-btn active" role="tab" id="reference-tab-ready" aria-selected="true" aria-controls="reference-panel-ready" data-reference-tab="ready">Ready sample</button><button type="button" class="analysis-tab-btn" role="tab" id="reference-tab-recovery" aria-selected="false" aria-controls="reference-panel-recovery" tabindex="-1" data-reference-tab="recovery">Recovery sample</button></div><div id="reference-panel-ready" role="tabpanel" aria-labelledby="reference-tab-ready" tabindex="0"><p>Ready: sample records are available for review.</p>${badge('Sample ready','success')}</div><div id="reference-panel-recovery" role="tabpanel" aria-labelledby="reference-tab-recovery" tabindex="0" hidden><p data-reference-recovery-text>Sample request failed. Retry uses local data and never contacts a service.</p><button type="button" class="icon-button" data-reference-retry>Retry sample</button><p role="status" aria-live="polite" data-reference-recovery-status></p></div></section>
  <section class="panel" aria-labelledby="reference-actions"><h2 id="reference-actions">Actions and focus</h2><div class="reference-actions">
    <button type="button" class="primary" data-reference-action="primary">Primary action</button>
    <button type="button" class="icon-button" data-reference-action="secondary">Secondary action</button>
    <button type="button" class="quiet-button" data-reference-action="quiet">Quiet action</button>
    <button type="button" class="danger-button" data-reference-action="danger">Destructive sample</button>
    <button type="button" class="icon-button" disabled aria-describedby="reference-disabled-reason">Unavailable action</button>
    <button type="button" class="icon-button" disabled aria-busy="true">Saving sample...</button>
  </div><p id="reference-disabled-reason">The unavailable sample demonstrates an unmet prerequisite.</p><p data-reference-result role="status" aria-live="polite">No sample action selected.</p></section>
  <section class="panel" aria-labelledby="reference-form"><h2 id="reference-form">Fields and validation</h2><form data-reference-form>
    <div class="form-grid"><label>Member name<input name="name" value="Dr Alexandra Long Department Name" required autocomplete="off"></label>
    <label>Sample status<select name="status"><option value="requested">Requested</option><option value="approved">Approved</option></select></label>
    <label>Effective date<input name="date" type="date" value="2026-10-21"></label>
    <label>Unavailable field<input value="Read-only sample" disabled></label>
    <label>Notes<textarea name="notes" rows="3">A long description wraps without obscuring adjacent labels or actions.</textarea></label></div>
    <p id="reference-field-error" role="alert" hidden></p><label class="checkbox-line"><input type="checkbox" name="reviewed"> I reviewed the sample values</label>
    <div class="reference-actions"><button class="primary" type="submit">Validate sample</button><button type="button" class="icon-button" data-reference-invalid>Show field error</button></div>
  </form></section>
  <section class="panel" aria-labelledby="reference-status"><h2 id="reference-status">Semantic status</h2><div class="reference-actions">${badge('Approved','success')}${badge('Needs review','warning')}${badge('Blocked','danger')}${badge('Information','info')}${badge('Not recorded','neutral')}</div>
  ${steps(['Upload','Review','Apply'],1)}<p>Royal accents identify the application. Status meaning remains explicit in text.</p></section>
  <section class="panel" aria-labelledby="reference-data"><h2 id="reference-data">Record comparison</h2><div class="table-scroll" tabindex="0" role="region" aria-label="Sample member comparison"><table><caption>Long names, dates and mixed statuses</caption><thead><tr><th scope="col">Member</th><th scope="col">Date range</th><th scope="col">Status</th></tr></thead><tbody><tr><th scope="row">Dr Alexandra Long Department Name</th><td>21 October–2 November 2026</td><td>${badge('Requested','warning')}</td></tr><tr><th scope="row">Dr Bina</th><td>22 October 2026</td><td>${badge('Approved','success')}</td></tr></tbody></table></div></section>
  <section class="panel" aria-labelledby="reference-empty"><h2 id="reference-empty">Empty and local recovery</h2>${emptyState({title:'No sample records',body:'An empty dataset is different from a failed request.',actionHtml:'<button type="button" class="icon-button" data-reference-action="empty">Create sample record</button>'})}
  <details><summary>Technical detail example</summary><p>Expandable details keep operational summaries readable without hiding essential errors.</p></details>
  <button type="button" class="icon-button" data-reference-dialog>Open review dialog</button></section>`;

  const result = () => host.querySelector<HTMLElement>('[data-reference-result]')!;
  const updateTokens = () => {
    const styles = getComputedStyle(host);
    host.querySelectorAll<HTMLOutputElement>('[data-reference-token]').forEach(output => {
      output.value = styles.getPropertyValue(output.dataset.referenceToken!).trim();
    });
  };
  updateTokens();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateTokens);
  const tabs = [...host.querySelectorAll<HTMLButtonElement>('[data-reference-tab]')];
  const chooseTab = (tab: HTMLButtonElement) => {
    tabs.forEach(button => {
      const selected = button === tab;
      button.setAttribute('aria-selected', String(selected));
      button.classList.toggle('active', selected);
      button.tabIndex = selected ? 0 : -1;
      host.querySelector<HTMLElement>('#'+button.getAttribute('aria-controls'))!.hidden = !selected;
    });
  };
  host.querySelector('[aria-label="Reference state panels"]')!.addEventListener('keydown', event => {
    const key = event as KeyboardEvent;
    const current = tabs.indexOf(key.target as HTMLButtonElement);
    if (current < 0) return;
    const index = key.key === 'Home' ? 0 : key.key === 'End' ? tabs.length-1
      : key.key === 'ArrowRight' ? (current+1)%tabs.length
      : key.key === 'ArrowLeft' ? (current-1+tabs.length)%tabs.length : -1;
    if (index < 0) return;
    key.preventDefault();
    tabs.forEach((tab,i)=>tab.tabIndex=i===index?0:-1);
    tabs[index].focus();
  });
  host.addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button');
    if (!button || button.disabled) return;
    if (button.hasAttribute('data-reference-tab')) chooseTab(button);
    if (button.hasAttribute('data-reference-retry')) {
      host.querySelector<HTMLElement>('[data-reference-recovery-text]')!.textContent = 'Sample records recovered locally.';
      host.querySelector<HTMLElement>('[data-reference-recovery-status]')!.textContent = 'Recovery complete. No request was sent.';
      button.textContent = 'Retry sample again';
    }
    if (button.dataset.referenceAction) result().textContent = `${button.textContent?.trim()} completed locally; no record was saved.`;
    if (button.hasAttribute('data-reference-invalid')) {
      const field = host.querySelector<HTMLInputElement>('[name=name]')!;
      const error = host.querySelector<HTMLElement>('#reference-field-error')!;
      field.setAttribute('aria-invalid','true');field.setAttribute('aria-describedby',error.id);
      error.hidden = false;error.textContent = 'Sample validation: enter the complete member name.';field.focus();
    }
    if (button.hasAttribute('data-reference-dialog')) {
      const dialog = document.createElement('dialog');dialog.className='member-workspace';dialog.setAttribute('aria-label','Sample review');
      dialog.innerHTML=`<header class="mw-header"><h2>Sample review</h2><button type="button" data-close>Close</button></header><div class="mw-content"><p>Review scope, warning text and long names remain readable at narrow widths.</p><p>${esc('Dr Alexandra Long Department Name')}</p><label><input type="checkbox" data-confirm> I reviewed this sample</label></div><footer class="mw-footer"><button type="button" class="primary" data-confirm-action disabled>Confirm sample</button></footer>`;
      dialog.onchange=()=>{dialog.querySelector<HTMLButtonElement>('[data-confirm-action]')!.disabled=!dialog.querySelector<HTMLInputElement>('[data-confirm]')!.checked;};
      dialog.onclick=event=>{const action=(event.target as Element).closest('button');if(action?.matches('[data-close]'))dialog.close();if(action?.matches('[data-confirm-action]')&&!action.disabled){result().textContent='Sample reviewed locally; no record was saved.';dialog.close();}};
      dialog.addEventListener('close',()=>{dialog.remove();button.focus();},{once:true});document.body.append(dialog);dialog.showModal();
    }
  });
  host.querySelector<HTMLFormElement>('[data-reference-form]')!.onsubmit=event=>{
    event.preventDefault();const form=event.currentTarget as HTMLFormElement;const data=new FormData(form);
    if(data.has('reviewed')) {
      const field=form.querySelector<HTMLInputElement>('[name=name]')!;
      field.removeAttribute('aria-invalid');field.removeAttribute('aria-describedby');
      const error=form.querySelector<HTMLElement>('#reference-field-error')!;
      error.hidden=true;error.textContent='';
    }
    result().textContent=data.has('reviewed')?'Sample values validated locally; no record was saved.':'Review the sample values before confirming.';
  };
}
