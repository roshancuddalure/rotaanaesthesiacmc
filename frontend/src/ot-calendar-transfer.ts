/** Monthly dated replacement transfer: preview first, explicit apply, no auto retry. */
import {request,requestDownload} from './services/api';
import {esc} from './ui';
type Review={review_hash:string;source_hash:string;changed:boolean;changes:{day:string;area_key:string;state:string;before:unknown[];after:unknown[]}[];unknown_rows:{day:string;area_key:string}[]};
type Payload={filename:string;base_revision:string;document:unknown};

export function mountOtCalendarTransfer(host:HTMLElement,unit:string,revision:string,canImport:()=>boolean,busy:(value:boolean)=>void,reload:(outcome?:'confirmed')=>Promise<void>):()=>void {
 let alive=true,ticket=0,payload:Payload|null=null,review:Review|null=null,applying=false;
 host.dataset.otTransferPanel='';
 host.innerHTML=`<h3>Monthly OT import and export</h3><p>Transfer dated area replacements as JSON. Dates outside the month stay unchanged. Missing areas are not closures. Reserve and qualification policy changes require separate calendar review.</p><label>Export month<input data-transfer-month type="month" required value="${esc(localStorage.getItem('duty_rota_working_month')??new Date().toISOString().slice(0,7))}"></label><button type="button" data-transfer-export>Download saved month JSON</button><form data-transfer-form><label>Monthly OT JSON file<input type="file" accept=".json,application/json" required data-transfer-file></label><button type="submit">Preview file changes</button></form><p data-transfer-message role="status" aria-live="polite"></p><div data-transfer-review></div>`;
 const message=host.querySelector<HTMLElement>('[data-transfer-message]')!,region=host.querySelector<HTMLElement>('[data-transfer-review]')!,form=host.querySelector<HTMLFormElement>('form')!;
 const current=(n:number)=>alive&&ticket===n&&host.isConnected;
 function clear(){ticket++;payload=null;review=null;region.innerHTML='';}
 async function preview(event:SubmitEvent){
  event.preventDefault();event.stopPropagation();if(applying)return;clear();
  if(!canImport()){message.textContent='Save or discard the existing OT draft before previewing an import.';return;}
  const n=ticket,file=host.querySelector<HTMLInputElement>('[data-transfer-file]')!.files?.[0];if(!file)return;
  if(file.size>2_000_000){message.textContent='Choose a JSON file smaller than 2 MB.';return;}
  message.textContent='Validating file and saved mappings…';
  try{
   const parsed=JSON.parse(await file.text());if(!current(n))return;
   const candidate:Payload={filename:file.name,base_revision:revision,document:parsed.document??parsed};
   const result=await request<Review>(`/api/v1/admin/ot-calendars/${unit}/transfer/preview`,{method:'POST',body:JSON.stringify(candidate)});
   if(!current(n))return;payload=candidate;review=result;
   region.innerHTML=`<h4>Review monthly changes</h4><p>${esc(file.name)} · ${result.changed?`${result.changes.length} changed area/date rows`:'No scheduling changes'}.</p><p>Source hash: <code>${esc(result.source_hash)}</code></p>${result.unknown_rows.length?`<p>${result.unknown_rows.length} unknown rows stay unknown; they do not erase reviewed demand.</p>`:''}<ul>${result.changes.map(r=>`<li><strong>${esc(r.day)} · ${esc(r.area_key)} · ${esc(r.state)}</strong><details><summary>Before and after staffing</summary><pre>${esc(JSON.stringify({before:r.before,after:r.after},null,2))}</pre></details></li>`).join('')}</ul><label class="ot-check"><input type="checkbox" data-transfer-confirm> I reviewed these dated replacements and their staffing counts.</label><button type="button" data-transfer-apply disabled>Apply reviewed import</button>`;
   const confirm=region.querySelector<HTMLInputElement>('[data-transfer-confirm]')!,apply=region.querySelector<HTMLButtonElement>('[data-transfer-apply]')!;
   confirm.onchange=()=>apply.disabled=!confirm.checked||applying;
   apply.onclick=async()=>{
    if(!review||!payload||!confirm.checked||applying)return;
    if(!canImport()){clear();message.textContent='The editor draft changed after import review. Save or discard it, then preview the file again.';return;}
    applying=true;busy(true);apply.disabled=true;confirm.disabled=true;
    message.textContent='Applying reviewed monthly replacements…';
    try{
     await request(`/api/v1/admin/ot-calendars/${unit}/transfer/apply`,{method:'POST',body:JSON.stringify({...payload,review_hash:review.review_hash})});
     if(current(n)){message.textContent='Reviewed monthly import saved.';await reload('confirmed');}
    }catch(error){if(current(n)){clear();message.textContent=`Import outcome requires review: ${error instanceof Error?error.message:'Request failed'}. Read the latest saved calendar before previewing again. This request was not retried.`;
     const refresh=document.createElement('button');refresh.type='button';refresh.textContent='Read latest saved calendar';region.append(refresh);
     refresh.onclick=async()=>{if(!canImport()){message.textContent='Save or discard your current draft before reading the saved calendar.';return;}refresh.disabled=true;await reload();};
    }}
    finally{applying=false;busy(false);}
   };
   message.textContent='Preview ready. No calendar changes have been saved.';
  }catch(error){if(current(n)){clear();message.textContent=`File preview unavailable: ${error instanceof Error?error.message:'Check the file'}`;}}
 }
 host.querySelector<HTMLButtonElement>('[data-transfer-export]')!.onclick=async()=>{
  const n=ticket,month=host.querySelector<HTMLInputElement>('[data-transfer-month]')!.value;
  try{const {blob,filename}=await requestDownload(`/api/v1/admin/ot-calendars/${unit}/transfer/export?month=${encodeURIComponent(month)}`);if(!current(n))return;const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename??'ot-month.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);message.textContent='Saved monthly calendar exported. Unsaved drafts are excluded.';}
  catch(error){if(current(n))message.textContent=`Export unavailable: ${error instanceof Error?error.message:'Retry'}`;}
 };
 const changed=()=>{if(!applying){clear();message.textContent='File changed. Preview again before applying.';}};
 host.querySelector('[data-transfer-file]')!.addEventListener('change',changed);form.addEventListener('submit',preview);
 return ()=>{alive=false;ticket++;form.removeEventListener('submit',preview);host.querySelector('[data-transfer-file]')?.removeEventListener('change',changed);};
}
