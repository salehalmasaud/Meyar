import {RealtimeClient} from '@supabase/realtime-js';
import {copyForTrackcare} from './clipboard.ts';
import {ordered,nextNote,metadata,activeNotes,remainingCount,expiryLabel,preference,type Note,type RelayFile} from './model.ts';
const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
type Config={expires_at:string;text_ttl:number;file_ttl:number;realtime:{url:string;anon:string;topic:string}};
type State={revision:number;notes:Note[];files:RelayFile[];server_time:number;unchanged?:boolean};
let config:Config|null=null,notes:Note[]=[],files:RelayFile[]=[],revision=-1,generation=0,live=false,reachable=false,offset=0;
let client:RealtimeClient|null=null,poll:ReturnType<typeof setTimeout>,refreshing=false,pending=false,filesKey='';
const controllers=new Set<AbortController>(),uploads=new Set<XMLHttpRequest>();
const thumbnailObservers=new Set<IntersectionObserver>();
const COPIED_KEY='relay-v3-copied';
let copied=new Set<string>();try{const ids=JSON.parse(localStorage.getItem(COPIED_KEY)||'[]');if(Array.isArray(ids))copied=new Set(ids.filter(x=>typeof x==='string'&&/^[0-9a-f-]{36}$/.test(x)));}catch{/* Storage is optional. */}
const readPreference=(key:string)=>{try{return localStorage.getItem(key);}catch{return null;}};
let view=preference(readPreference('relay-v3-view'),['comfortable','compact'],'comfortable');
let theme=preference(readPreference('relay-v3-theme'),['system','light','dark'],'system');
let selectedId='',previewId='';const expanded=new Set<string>();
const themeQuery=matchMedia('(prefers-color-scheme: dark)');
function applyTheme(){document.documentElement.dataset.theme=theme==='system'?(themeQuery.matches?'dark':'light'):theme;}
applyTheme();themeQuery.addEventListener('change',applyTheme);
const persist=(key:string,value:string)=>{try{localStorage.setItem(key,value);}catch{}};
const typing=(target:EventTarget|null)=>target instanceof Element&&!!target.closest('input,textarea,select,[contenteditable="true"],[role="textbox"]');
const saveCopied=()=>{try{localStorage.setItem(COPIED_KEY,JSON.stringify([...copied]));}catch{/* In-memory state still works. */}};
const now=()=>Date.now()+offset;
const time=(s:string)=>new Date(s).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
const expiry=(s:string)=>{const m=Math.max(0,Math.ceil((Date.parse(s)-now())/60000));return m>60?`${Math.floor(m/60)}h ${m%60}m left`:`${m}m left`;};
const size=(n:number)=>n<1048576?`${Math.max(1,Math.round(n/1024))} KB`:`${(n/1048576).toFixed(1)} MB`;
const message=(s:string)=>{$('message').textContent=s;};
const errors:Record<string,string>={invalid_pin:'That PIN is not correct.',invalid_access:'Open your saved private receiver URL.',try_later:'Too many attempts. Try again in 15 minutes.',session_expired:'Your session ended. Open your saved receiver URL to continue.',unsupported_file:'Choose a PDF, JPEG, PNG, WEBP, HEIC or HEIF file.',too_large:'This file is larger than 20 MB.',inbox_full:'Your inbox is full. Clear some items and retry.',file_expired:'This file has expired or was deleted.'};
class ApiError extends Error{constructor(public code:string,public status:number){super(errors[code]||'Unable to connect. Please try again.');}}
async function request<T>(path:string,body?:unknown):Promise<T>{
 const controller=new AbortController();controllers.add(controller);const timer=setTimeout(()=>controller.abort(),55000);
 try{const r=await fetch('/api'+path,{method:body===undefined?'GET':'POST',cache:'no-store',credentials:'same-origin',headers:body===undefined?{}:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});const data=await r.json();if(!r.ok)throw new ApiError(data.error||'unavailable',r.status);return data as T;}
 finally{clearTimeout(timer);controllers.delete(controller);}
}
function setStatus(){const s=$('status');s.textContent=!config?'Locked':!reachable?'Offline':live?'Live':'Fallback';s.dataset.state=!config?'locked':!reachable?'offline':live?'live':'fallback';}
function hideWorkspace(text=''){
 generation++;config=null;notes=[];files=[];revision=-1;filesKey='';refreshing=false;pending=false;live=false;reachable=false;
 selectedId='';expanded.clear();closePreview();$<HTMLDialogElement>('shortcuts').close();
 clearTimeout(poll);client?.disconnect();client=null;for(const c of controllers)c.abort();for(const u of uploads)u.abort();uploads.clear();
 for(const observer of thumbnailObservers)observer.disconnect();thumbnailObservers.clear();
 $('notes').replaceChildren();$('files').replaceChildren();$('queue').replaceChildren();$('workspace').hidden=true;$('gate').hidden=false;$('lock').hidden=true;
 $<HTMLDialogElement>('confirmation').close();$('gate-error').textContent=text;$<HTMLInputElement>('code').value='';message('');setStatus();
}
function updateSummary(){
 $('note-count').textContent=String(notes.length);$('note-summary').textContent=`${notes.length} ${notes.length===1?'note':'notes'}`;
 const latest=ordered(notes,true)[0];$('received-summary').textContent=latest?'Last received '+time(latest.received_at):'Waiting for your first note';
 const completed=notes.filter(n=>copied.has(n.id)).length;
 $('copy-summary').textContent=notes.length?`${notes.length-completed} remaining · ${completed} copied`:'Ready to receive';
 $('remaining-summary').textContent=`${remainingCount(notes,copied)} remaining`;
 $('copy-next').textContent=remainingCount(notes,copied)?`Copy next · ${remainingCount(notes,copied)} remaining`:'All notes copied ✓';
 $<HTMLButtonElement>('copy-next').disabled=!nextNote(notes,copied);$<HTMLButtonElement>('clear-copied').disabled=!completed;$<HTMLButtonElement>('clear-all').disabled=!notes.length;
 $('empty-notes').hidden=notes.length>0;
}
function noteCard(note:Note,index:number){
 const card=document.createElement('article');card.id='note-'+note.id;card.dataset.id=note.id;card.className='note-card'+(copied.has(note.id)?' copied':'');card.tabIndex=-1;
 const top=document.createElement('div');top.className='note-top';
 const label=document.createElement('span');label.className='note-label';label.textContent=`Note ${String(index+1).padStart(2,'0')}`;
 const received=document.createElement('time');received.className='note-time';received.dateTime=note.received_at;received.textContent=time(note.received_at);top.append(label,received);card.append(top);
 const meta=metadata(note.text);
 for(const [content,css]of[[meta.pt,'note-patient'],[meta.dx,'note-dx']])if(content){const p=document.createElement('p');p.className=css;p.textContent=content;card.append(p);}
 const text=document.createElement('pre');text.className='note-text';text.id='text-'+note.id;text.textContent=note.text;if(meta.pt||meta.dx)text.classList.add('with-preview');card.append(text);
 const bottom=document.createElement('div');bottom.className='note-bottom';const left=document.createElement('div');left.className='expiry-info';const absolute=document.createElement('span');absolute.dataset.expiryAbsolute=note.expires_at;absolute.textContent=expiryLabel(note.expires_at,now());const countdown=document.createElement('span');countdown.className='expiry';countdown.dataset.expires=note.expires_at;countdown.textContent=expiry(note.expires_at);left.append(absolute,countdown);
 const actions=document.createElement('div');actions.className='note-actions';const copy=document.createElement('button');copy.className='note-copy';copy.textContent=copied.has(note.id)?'Copied ✓':'Copy';copy.onclick=()=>void copyNote(note,false);
 const del=document.createElement('button');del.className='text-button danger';del.textContent='Delete';del.onclick=()=>confirm(`Delete ${label.textContent}?`,'This note will be removed from your inbox. This cannot be undone.','Delete',()=>deleteNotes([note.id]));
 const expand=document.createElement('button');expand.className='text-button expand';expand.setAttribute('aria-controls',text.id);expand.onclick=()=>{expanded.has(note.id)?expanded.delete(note.id):expanded.add(note.id);renderNotes();};
 card.addEventListener('focusin',()=>{selectedId=note.id;});
 card.addEventListener('click',e=>{if(view==='compact'&&!(e.target as Element).closest('button,a,pre'))expand.click();});
 actions.append(expand,copy,del);bottom.append(left,actions);card.append(bottom);return card;
}
function renderNotes(){
 const shown=ordered(notes,$<HTMLSelectElement>('sort').value==='newest'),list=$('notes');
 const keep=new Set(shown.map(n=>n.id));for(const el of Array.from(list.children))if(!keep.has((el as HTMLElement).dataset.id!))el.remove();
 shown.forEach((note,index)=>{
  const card=document.getElementById('note-'+note.id)||noteCard(note,index);
  if(list.children[index]!==card)list.insertBefore(card,list.children[index]||null);
  card.classList.toggle('copied',copied.has(note.id));card.classList.toggle('compact',view==='compact');
  card.querySelector('.note-label')!.textContent=`Note ${String(index+1).padStart(2,'0')}`;
  card.querySelector('.danger')!.setAttribute('aria-label',`Delete Note ${String(index+1).padStart(2,'0')}`);
  card.querySelector('.note-copy')!.textContent=copied.has(note.id)?'Copied ✓':'Copy';
  const expand=card.querySelector<HTMLButtonElement>('.expand')!;expand.hidden=view!=='compact';expand.textContent=expanded.has(note.id)?'Collapse':'Expand';expand.setAttribute('aria-expanded',String(expanded.has(note.id)));
  card.querySelector<HTMLElement>('.note-text')!.hidden=view==='compact'&&!expanded.has(note.id);
 });updateSummary();
}
function schedule(){clearTimeout(poll);if(config)poll=setTimeout(()=>void refresh(),live&&reachable?15000:4000);}
async function refresh(){
 if(!config)return;if(refreshing){pending=true;return;}refreshing=true;const g=generation;
 try{const state=await request<State>('/state?since='+revision);if(g!==generation)return;offset=state.server_time-Date.now();reachable=true;
  if(!state.unchanged&&state.revision>=revision){revision=state.revision;notes=activeNotes(state.notes,now());files=state.files.filter(f=>Date.parse(f.expires_at)>now());copied=new Set([...copied].filter(id=>notes.some(n=>n.id===id)));saveCopied();renderNotes();renderFiles();}setStatus();
 }catch(e){if(g!==generation)return;if(e instanceof ApiError&&e.status===401){hideWorkspace('Session ended. Open your saved receiver URL, or enter your PIN if access is still active.');return;}reachable=false;setStatus();}
 finally{if(g===generation){refreshing=false;if(pending){pending=false;void refresh();}else schedule();}}
}
async function start(){
 config=await request<Config>('/config');generation++;revision=-1;$('gate').hidden=true;$('workspace').hidden=false;$('lock').hidden=false;$<HTMLInputElement>('code').value='';
 $('file-retention').textContent=`Available for ${Math.round(config.file_ttl/3600)} hours`;
 const g=generation;client=new RealtimeClient(config.realtime.url.replace(/^http/,'ws')+'/realtime/v1',{params:{apikey:config.realtime.anon},heartbeatIntervalMs:20000});
 let lastPing=0;client.channel(config.realtime.topic,{config:{broadcast:{self:false}}}).on('broadcast',{event:'changed'},()=>{if(g===generation&&Date.now()-lastPing>300){lastPing=Date.now();void refresh();}}).subscribe(state=>{if(g!==generation)return;live=state==='SUBSCRIBED';setStatus();void refresh();});
 await refresh();
}
async function copyNote(note:Note,advance:boolean){
 const g=generation;if(Date.parse(note.expires_at)<=now())return;
 const copiedMode=await copyForTrackcare(note.text);if(g!==generation)return;
 if(!copiedMode){message('Copy was blocked. Select the note and press Ctrl+C. Your note is still here.');return;}
 copied.add(note.id);saveCopied();renderNotes();
 message(copiedMode==='rich'?'Copied ✓ TrackCare formatting included.':'Copied ✓ Plain text fallback.');
 if(advance){const next=nextNote(notes,copied);if(next)focusNote(next.id);else message('All notes copied ✓ Clear them when you are ready.');}
}
function focusNote(id:string){selectedId=id;const card=$('note-'+id);card?.focus({preventScroll:true});card?.scrollIntoView({behavior:'instant',block:'nearest'});}
function confirm(title:string,description:string,label:string,action:()=>Promise<void>){
 $('confirm-title').textContent=title;$('confirm-text').textContent=description;const b=$<HTMLButtonElement>('confirm-action');b.textContent=label;b.disabled=false;
 b.onclick=async()=>{b.disabled=true;try{await action();$<HTMLDialogElement>('confirmation').close();}catch(e){message(e instanceof Error?e.message:'Unable to clear. Please retry.');}finally{b.disabled=false;}};
 $<HTMLDialogElement>('confirmation').showModal();$('cancel-action').focus();
}
async function deleteNotes(ids:string[]){await request('/delete-notes',{ids});ids.forEach(id=>copied.delete(id));saveCopied();await refresh();}
async function signed(file:RelayFile,mode='open'){return(await request<{url:string}>('/file-url',{id:file.id,mode})).url;}
async function openFile(file:RelayFile,download=false){
 const tab=download?null:window.open('about:blank','_blank');if(tab)tab.opener=null;
 try{const url=await signed(file,download?'download':'open');if(download){const link=document.createElement('a');link.href=url;link.rel='noreferrer';link.download='';link.click();}else if(tab)tab.location.replace(url);else message('Allow this site to open a new tab, then try again.');}
 catch(e){tab?.close();message(e instanceof Error?e.message:'Unable to open file.');}
}
function closePreview(){previewId='';$<HTMLDialogElement>('file-preview').close();$('preview-content').replaceChildren();$('preview-name').textContent='';}
async function previewFile(file:RelayFile){
 const g=generation;previewId=file.id;$('preview-name').textContent=file.name;$('preview-content').textContent='Loading preview…';$<HTMLDialogElement>('file-preview').showModal();
 $('preview-download').onclick=()=>void openFile(file,true);
 try{
  const url=await signed(file,'preview');if(g!==generation||previewId!==file.id)return;
  const content=$('preview-content');content.replaceChildren();
  if(file.mime==='application/pdf'&&navigator.pdfViewerEnabled){const frame=document.createElement('iframe');frame.title='PDF preview';frame.referrerPolicy='no-referrer';frame.src=url;content.append(frame);}
  else if(file.mime.startsWith('image/')){const img=document.createElement('img');img.alt=file.name;img.src=url;img.referrerPolicy='no-referrer';img.onerror=()=>{content.textContent='Preview is unavailable in this browser. Download the file to view it.';};content.append(img);}
  else{content.textContent='Preview is unavailable in this browser. ';const open=document.createElement('button');open.textContent='Open in browser';open.onclick=()=>void openFile(file);content.append(open);}
 }catch{if(previewId===file.id)$('preview-content').textContent='Unable to load preview. Close and try again.';}
}
function renderFiles(){
 files=files.filter(f=>Date.parse(f.expires_at)>now());$('file-count').textContent=String(files.length);$('empty-files').hidden=!!files.length;$<HTMLButtonElement>('delete-files').disabled=!files.length;
 if(previewId&&!files.some(f=>f.id===previewId))closePreview();
 const key=files.map(f=>f.id).join(',');if(key===filesKey)return;filesKey=key;for(const observer of thumbnailObservers)observer.disconnect();thumbnailObservers.clear();$('files').replaceChildren();const g=generation;
 for(const file of files){
  const row=document.createElement('article');row.className='file';const icon=document.createElement('div');icon.className='file-icon';icon.textContent=file.mime==='application/pdf'?'PDF':file.mime.split('/')[1].toUpperCase();
  const details=document.createElement('div'),name=document.createElement('p');name.className='file-name';name.textContent=file.name;
  const meta=document.createElement('p');meta.className='file-meta';meta.textContent=`${size(file.size)}${file.source?' · '+file.source:''}`;
  const received=document.createElement('span');received.textContent='Received '+time(file.created_at);
  const exp=document.createElement('span');exp.dataset.expiryAbsolute=file.expires_at;exp.textContent=expiryLabel(file.expires_at,now());meta.append(document.createElement('br'),received,document.createElement('br'),exp);details.append(name,meta);
  const actions=document.createElement('div');actions.className='file-actions';
  const callbacks:[string,()=>void][]=[['Preview',()=>void previewFile(file)],['Download',()=>void openFile(file,true)],['Delete',()=>confirm('Delete this file?','It will be removed from the inbox. This cannot be undone.','Delete',async()=>{await request('/delete-files',{ids:[file.id]});await refresh();})]];
  for(const[label,fn]of callbacks){const b=document.createElement('button');b.className='text-button'+(label==='Delete'?' danger':'');b.textContent=label;b.setAttribute('aria-label',`${label} ${file.name}`);b.onclick=fn;actions.append(b);}row.append(icon,details,actions);$('files').append(row);
  if(file.mime.startsWith('image/')){
   // Mint the short-lived URL when the card approaches the viewport, so lazy
   // thumbnails further down a long inbox do not expire before their first load.
   const observer=new IntersectionObserver(entries=>{if(!entries.some(e=>e.isIntersecting))return;observer.disconnect();thumbnailObservers.delete(observer);
    void signed(file,'preview').then(url=>{if(g!==generation||!row.isConnected)return;const img=document.createElement('img');img.alt='';img.referrerPolicy='no-referrer';img.src=url;img.onerror=()=>img.remove();icon.append(img);}).catch(()=>{});
   },{rootMargin:'160px'});thumbnailObservers.add(observer);observer.observe(icon);
  }
 }
}
async function upload(file:File,onProgress:(n:number)=>void){
 const g=generation;const {url,ticket}=await request<{url:string;ticket:string}>('/upload-ticket',{});if(g!==generation)throw new Error('Session ended');
 return new Promise<void>((resolve,reject)=>{
  const x=new XMLHttpRequest();uploads.add(x);x.open('POST',url);x.setRequestHeader('authorization','Bearer '+ticket);x.timeout=120000;
  x.upload.onprogress=e=>{if(e.lengthComputable)onProgress(Math.round(e.loaded/e.total*95));};
  x.onload=()=>{uploads.delete(x);if(x.status>=200&&x.status<300){onProgress(100);resolve();}else{let code='unavailable';try{code=JSON.parse(x.responseText).error;}catch{}reject(new ApiError(code,x.status));}};
  x.onerror=x.ontimeout=x.onabort=()=>{uploads.delete(x);reject(new Error('Upload failed. Please retry.'));};
  const form=new FormData();form.append('file',file,file.name);form.append('source',matchMedia('(max-width:760px)').matches?'Phone':'Workstation');x.send(form);
 });
}
let tail=Promise.resolve();
function queueFiles(incoming:File[],pasted=false){
 if(!config)return;const g=generation;
 for(const file of incoming){
  const row=document.createElement('div');row.className='queue-item';const name=document.createElement('span');name.className='queue-name';name.textContent=pasted?'Pasted image':file.name;
  const label=document.createElement('span');label.className='queue-status';label.textContent='Queued';const progress=document.createElement('progress');progress.max=100;progress.value=0;progress.setAttribute('aria-label','Upload progress');
  const retry=document.createElement('button');retry.textContent='Retry';retry.hidden=true;row.append(name,label,progress,retry);$('queue').append(row);
  const run=async()=>{if(g!==generation)return;retry.hidden=true;if(file.size>20*1024*1024){label.textContent='Larger than 20 MB';return;}label.textContent='Uploading…';if(pasted)message('Pasted image — uploading…');
   try{await upload(file,n=>{progress.value=n;label.textContent=n===100?'Uploaded ✓':n>=95?'Finishing…':`${n}%`;});if(g!==generation)return;message(pasted?'Pasted image — Uploaded ✓':'Uploaded ✓');await refresh();setTimeout(()=>row.remove(),4000);}
   catch(e){if(g!==generation)return;label.textContent=e instanceof Error?e.message:'Upload failed';retry.hidden=false;}
  };
  retry.onclick=()=>{tail=tail.then(run);};tail=tail.then(run);
 }
}
$<HTMLFormElement>('unlock-form').onsubmit=async e=>{e.preventDefault();const b=$<HTMLButtonElement>('unlock');b.disabled=true;$('gate-error').textContent='';try{await request('/login',{pin:$<HTMLInputElement>('code').value});await start();}catch(e){$('gate-error').textContent=e instanceof Error?e.message:'Unable to open Relay.';$<HTMLInputElement>('code').select();}finally{b.disabled=false;}};
$('copy-next').onclick=()=>{const n=nextNote(notes,copied);if(n)void copyNote(n,true);};
$('sort').onchange=()=>renderNotes();
$('clear-copied').onclick=()=>{const ids=notes.filter(n=>copied.has(n.id)).map(n=>n.id);confirm(`Clear ${ids.length} copied ${ids.length===1?'note':'notes'}?`,'Only the notes already marked as copied will be deleted. New arrivals are kept.','Clear copied',()=>deleteNotes(ids));};
$('clear-all').onclick=()=>{const ids=notes.map(n=>n.id);confirm(`Clear all ${ids.length} notes?`,'These notes will be permanently removed. Files and notes arriving after this confirmation opens are kept.','Clear all',()=>deleteNotes(ids));};
$('delete-files').onclick=()=>{const ids=files.map(f=>f.id);confirm(`Delete all ${ids.length} files?`,'These files will be removed. Notes are kept.','Delete all',async()=>{await request('/delete-files',{ids});await refresh();});};
$('lock').onclick=async()=>{hideWorkspace();$<HTMLButtonElement>('unlock').disabled=true;try{await request('/lock',{});$<HTMLButtonElement>('unlock').disabled=false;$('code').focus();}catch{hideWorkspace('The screen is locked locally. Server lock could not be confirmed; close this browser if shared.');}};
const input=$<HTMLInputElement>('file-input');$('choose').onclick=()=>input.click();input.onchange=()=>{queueFiles(Array.from(input.files||[]));input.value='';};
const drop=$('drop');for(const event of ['dragenter','dragover'])drop.addEventListener(event,e=>{e.preventDefault();drop.classList.add('drag');});for(const event of ['dragleave','drop'])drop.addEventListener(event,e=>{e.preventDefault();drop.classList.remove('drag');});drop.addEventListener('drop',e=>queueFiles(Array.from((e as DragEvent).dataTransfer?.files||[])));
document.addEventListener('paste',e=>{if(!config||typing(e.target))return;const images=Array.from(e.clipboardData?.items||[]).filter(i=>i.kind==='file'&&i.type.startsWith('image/')).map(i=>i.getAsFile()).filter((f):f is File=>!!f).map((f,i)=>new File([f],`Screenshot-${new Date().toISOString().replace(/[:.]/g,'-')}-${i+1}.${f.type.split('/')[1]||'png'}`,{type:f.type}));if(images.length){e.preventDefault();queueFiles(images,true);}});
$<HTMLSelectElement>('theme').value=theme;$('theme').onchange=()=>{theme=$<HTMLSelectElement>('theme').value;persist('relay-v3-theme',theme);applyTheme();};
$<HTMLSelectElement>('view').value=view;$('view').onchange=()=>{view=$<HTMLSelectElement>('view').value;persist('relay-v3-view',view);renderNotes();};
$('preview-close').onclick=closePreview;$<HTMLDialogElement>('file-preview').addEventListener('cancel',()=>closePreview());
$('show-shortcuts').onclick=()=>$<HTMLDialogElement>('shortcuts').showModal();$('close-shortcuts').onclick=()=>$<HTMLDialogElement>('shortcuts').close();
document.addEventListener('keydown',e=>{
 if(!config||typing(e.target)||e.ctrlKey||e.metaKey||e.altKey||document.querySelector('dialog[open]'))return;
 const shown=ordered(notes,$<HTMLSelectElement>('sort').value==='newest');if(!shown.length)return;
 const index=shown.findIndex(n=>n.id===selectedId),key=e.key.toLowerCase();
 if(key==='c'){e.preventDefault();const note=nextNote(notes,copied);if(note)void copyNote(note,true);}
 else if(['j','arrowdown','k','arrowup'].includes(key)){e.preventDefault();const next=['j','arrowdown'].includes(key)?Math.min(shown.length-1,index+1):Math.max(0,index-1);focusNote(shown[next].id);}
 else if(key==='enter'&&!(e.target as Element).closest('button,a')){e.preventDefault();void copyNote(shown[Math.max(0,index)],false);}
});
window.addEventListener('online',()=>void refresh());window.addEventListener('offline',()=>{reachable=false;setStatus();});document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
window.addEventListener('pagehide',()=>{for(const c of controllers)c.abort();$('notes').replaceChildren();$('files').replaceChildren();notes=[];files=[];});window.addEventListener('pageshow',e=>{if(e.persisted){revision=-1;filesKey='';void refresh();}});
window.addEventListener('storage',e=>{if(e.key===COPIED_KEY){try{copied=new Set(JSON.parse(e.newValue||'[]'));renderNotes();}catch{}}});
setInterval(()=>{
 if(!config)return;if(Date.parse(config.expires_at)<=Date.now()){hideWorkspace('Session expired. Open your saved receiver URL to continue.');return;}
 const active=activeNotes(notes,now());if(active.length!==notes.length){notes=active;renderNotes();}renderFiles();document.querySelectorAll<HTMLElement>('[data-expires]').forEach(el=>{const label=expiry(el.dataset.expires!);if(el.textContent!==label)el.textContent=label;});
 document.querySelectorAll<HTMLElement>('[data-expiry-absolute]').forEach(el=>{const label=expiryLabel(el.dataset.expiryAbsolute!,now());if(el.textContent!==label)el.textContent=label;});
},1000);
async function boot(){
 try{
  let access=new URLSearchParams(location.hash.slice(1)).get('access');
  if(access){await request('/exchange',{access});history.replaceState(null,'',location.pathname);access=null;}
  const state=await request<{trusted:boolean;unlocked:boolean}>('/status');
  if(!state.trusted){$('gate-error').textContent='Open your saved private receiver URL to continue.';return;}
  $<HTMLButtonElement>('unlock').disabled=false;if(state.unlocked){await start();return;}$('code').focus();
 }catch(e){$('gate-error').textContent=e instanceof Error?e.message:'Unable to connect. Please reload.';}
}
void boot();
