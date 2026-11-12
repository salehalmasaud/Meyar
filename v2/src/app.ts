import { RealtimeClient } from '@supabase/realtime-js';
import { copyExact, copyThenClear } from './clipboard.ts';
import { connectionStatus, pollingDelay } from './connection.ts';
import type { RelayFile, RelayNote, RelayState, ViewerSession } from './types.ts';

const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const gate=$('gate'), workspace=$('workspace'), code=$<HTMLInputElement>('code'), gateError=$('gate-error'), status=$('status');
let session:ViewerSession|null=null, note:RelayNote|null=null, files:RelayFile[]=[], revision=-1, generation=0;
let reachable=false, live=false, polling:ReturnType<typeof setTimeout>|undefined, client:RealtimeClient|null=null, refreshing=false, pending=false, fileSignature='';
let serverOffset=0;
let lastRefreshStarted=0;
const inflight=new Set<AbortController>(); const uploads=new Set<XMLHttpRequest>(); const previews=new Set<string>();
const time=(value:string)=>new Date(value).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
const now=()=>Date.now()+serverOffset;
const remaining=(value:string)=>Math.max(0,Math.ceil((Date.parse(value)-now())/60000));
const bytes=(value:number)=>value<1048576?`${Math.max(1,Math.round(value/1024))} KB`:`${(value/1048576).toFixed(1)} MB`;
const message=(text:string)=>{$('message').textContent=text;};
const errors:Record<string,string>={invalid_pin:'That access code is not correct.',try_later:'Too many attempts. Try again in 15 minutes.',device_not_paired:'Open your private setup link on this device first.',invalid_invite:'This setup link has expired or was already used.',new_note_arrived:'A newer output arrived. It has been kept.',unsupported_file:'Choose a PDF, JPEG, PNG, WEBP, HEIC or HEIF file.',too_large:'This file is larger than 20 MB.',relay_full:'The relay is full. Delete a few files and try again.',file_expired:'This file has expired or was removed.'};
class ApiError extends Error { constructor(public code:string,public status:number){super(errors[code]||'Connection lost — retrying…');} }
async function request<T>(url:string,init:RequestInit={}):Promise<T>{
  const controller=new AbortController(); inflight.add(controller); const timer=setTimeout(()=>controller.abort(),20000);
  try { const r=await fetch(url,{...init,cache:'no-store',signal:controller.signal}); const data=await r.json(); if(!r.ok)throw new ApiError(data.error||'unavailable',r.status); return data as T; }
  finally {clearTimeout(timer);inflight.delete(controller);}
}
async function auth<T>(body?:unknown):Promise<T>{return request<T>('/api/session',body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{});}
async function api<T>(path:string,body?:unknown):Promise<T>{
  if(!session)throw new ApiError('session_expired',401);
  return request<T>(session.edge+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+session.token,...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
}
function setStatus(){status.textContent=session?connectionStatus(live,reachable):'Locked';status.dataset.state=session?(reachable?(live?'live':'fallback'):'offline'):'locked';}
function renderNote(){
  $('note').textContent=note?.text||''; $('note').hidden=!note; $('empty-note').hidden=!!note;
  for(const id of ['copy','copy-clear','clear'])$<HTMLButtonElement>(id).disabled=!note;
  $('received').textContent=note?`Received ${time(note.received_at)}`:'';
  $('note-expiry').textContent=note?`Expires in ${remaining(note.expires_at)} min`:'';
  $('note-marker').textContent=note?'Ready to copy':'Awaiting output';
}
function revokePreviews(){for(const url of previews)URL.revokeObjectURL(url);previews.clear();}
function lock(text=''){
  generation++;session=null;note=null;files=[];revision=-1;fileSignature='';refreshing=false;pending=false;
  clearTimeout(polling);client?.disconnect();client=null;live=false;reachable=false;
  for(const c of inflight)c.abort();for(const x of uploads)x.abort();uploads.clear();
  revokePreviews();sessionStorage.removeItem('relay-v2-session');
  renderNote();$('files').replaceChildren();$('queue').replaceChildren();message('');$('confirmation').hidden=true;
  workspace.hidden=true;gate.hidden=false;gateError.textContent=text;code.value='';setStatus();code.focus();
}
function schedule(){clearTimeout(polling);if(session)polling=setTimeout(()=>void refresh(),Math.max(300,pollingDelay(live,reachable)-(Date.now()-lastRefreshStarted)));}
async function refresh(){
  if(!session)return;if(refreshing){pending=true;return;}refreshing=true;lastRefreshStarted=Date.now();const current=generation;
  try {
    const state=await api<RelayState>('/state?since='+revision);
    if(current!==generation)return;
    reachable=true;serverOffset=state.server_time-Date.now();
    if(!state.unchanged && state.revision>=revision){revision=state.revision;note=state.note;files=state.files;renderNote();renderFiles();}
    setStatus();
  }catch(e){if(current!==generation)return;if(e instanceof ApiError&&e.status===401){lock('Session expired — enter access code.');return;}reachable=false;setStatus();}
  finally{if(current===generation){refreshing=false;if(pending){pending=false;void refresh();}else schedule();}}
}
function start(value:ViewerSession){
  session=value;generation++;revision=-1;sessionStorage.setItem('relay-v2-session',JSON.stringify(value));
  gate.hidden=true;workspace.hidden=false;code.value='';gateError.textContent='';
  $('text-ttl').textContent=`Outputs disappear after ${Math.round(value.text_ttl/60)} minutes.`;
  $('file-ttl').textContent=`Files are temporary · ${value.file_ttl>=3600?Math.round(value.file_ttl/3600)+' hours':Math.round(value.file_ttl/60)+' minutes'}`;
  const current=generation;
  client=new RealtimeClient(value.realtime.url.replace(/^http/,'ws')+'/realtime/v1',{params:{apikey:value.realtime.anon},heartbeatIntervalMs:20000});
  let lastPing=0;
  client.channel(value.realtime.topic,{config:{broadcast:{self:false}}}).on('broadcast',{event:'changed'},()=>{if(current===generation&&Date.now()-lastPing>500){lastPing=Date.now();void refresh();}}).subscribe(state=>{
    if(current!==generation)return;live=state==='SUBSCRIBED';setStatus();void refresh();
  });
  void refresh();$('copy').focus();
}
async function clearSnapshot(snapshot:RelayNote){await api('/clear',{version:snapshot.version});await refresh();}
async function copy(clear=false){
  const snapshot=note;if(!snapshot)return;
  const button=$<HTMLButtonElement>(clear?'copy-clear':'copy');button.disabled=true;
  try{
    const copied=clear?await copyThenClear(snapshot,()=>copyExact(snapshot.text),clearSnapshot):await copyExact(snapshot.text);
    if(!copied){message('Copy was blocked. Select the output and press Ctrl+C. The output has been kept.');$('note').focus();return;}
    button.textContent='Copied ✓';message(clear?'Copied and cleared.':'Copied. Ready to paste.');
    setTimeout(()=>{button.textContent=clear?'Copy & Clear':'Copy';},1800);
  }catch(e){message(e instanceof ApiError&&e.code==='new_note_arrived'?'Copied the previous output. A newer output has been kept.':'The output was copied, but could not be cleared. Try again.');await refresh();}
  finally{button.disabled=!note;}
}
function confirmInline(text:string,action:()=>Promise<void>){
  const region=$('confirmation');region.hidden=false;$('confirm-text').textContent=text;
  const button=$<HTMLButtonElement>('confirm-action');button.onclick=async()=>{button.disabled=true;try{await action();region.hidden=true;}catch(e){message(e instanceof ApiError?e.message:'Unable to clear. Try again.');await refresh();}finally{button.disabled=false;}};
  $('cancel-action').onclick=()=>{region.hidden=true;};$('cancel-action').focus();
}
async function signed(file:RelayFile,mode='open'){return (await api<{url:string}>('/file-url',{id:file.id,mode})).url;}
async function openFile(file:RelayFile,download=false){
  // Open synchronously within the click gesture, before awaiting the short-lived URL.
  const tab=download?null:window.open('about:blank','_blank');if(tab)tab.opener=null;
  try{const url=await signed(file,download?'download':'open');if(download){const link=document.createElement('a');link.href=url;link.rel='noreferrer';link.download='';document.body.append(link);link.click();link.remove();}else if(tab)tab.location.replace(url);else message('Allow this site to open a new tab, then try again.');}
  catch(e){tab?.close();message(e instanceof ApiError?e.message:'Could not open this file. Try again.');}
}
function renderFiles(){
  const visible=files.filter(f=>Date.parse(f.expires_at)>now());files=visible;
  $('file-count').textContent=String(visible.length);$<HTMLButtonElement>('delete-all').disabled=!visible.length;
  $('empty-files').hidden=!!visible.length;
  const signature=visible.map(f=>f.id).join(',');if(signature===fileSignature)return;fileSignature=signature;
  revokePreviews();const list=$('files');list.replaceChildren();
  const current=generation;
  for(const file of visible){
    const row=document.createElement('article');row.className='file';
    const icon=document.createElement('div');icon.className='file-icon';icon.textContent=file.mime==='application/pdf'?'PDF':file.mime.split('/')[1].toUpperCase();
    const details=document.createElement('div');details.className='file-details';
    const name=document.createElement('p');name.className='file-name';name.textContent=file.name;
    const meta=document.createElement('p');meta.className='file-meta';meta.textContent=`${bytes(file.size)} · ${file.source} · ${time(file.created_at)}`;
    details.append(name,meta);const actions=document.createElement('div');actions.className='file-actions';
    for(const [label,callback] of [ ['Open',()=>void openFile(file)],['Download',()=>void openFile(file,true)],['Delete',()=>confirmInline('Delete this file from both devices?',async()=>{await api('/delete-files',{ids:[file.id]});await refresh();})] ] as const){const button=document.createElement('button');button.textContent=label;button.className=label==='Delete'?'text-button danger':'text-button';button.setAttribute('aria-label',`${label} ${file.name}`);button.onclick=callback;actions.append(button);}
    row.append(icon,details,actions);list.append(row);
    if(file.mime.startsWith('image/')){
      void signed(file,'preview').then(url=>{if(current!==generation||!row.isConnected)return;const image=document.createElement('img');image.alt='';image.loading='lazy';image.referrerPolicy='no-referrer';image.src=url;image.onerror=()=>image.remove();icon.append(image);}).catch(()=>{});
    }
  }
}
function upload(file:File,progress:(n:number)=>void):Promise<void>{
  return new Promise((resolve,reject)=>{
    if(!session){reject(new Error());return;}
    const xhr=new XMLHttpRequest();uploads.add(xhr);xhr.open('POST',session.edge+'/upload');xhr.setRequestHeader('authorization','Bearer '+session.token);xhr.timeout=120000;
    xhr.upload.onprogress=e=>{if(e.lengthComputable)progress(Math.round(e.loaded/e.total*95));};
    xhr.onload=()=>{uploads.delete(xhr);let data:{error?:string}={};try{data=JSON.parse(xhr.responseText);}catch{}if(xhr.status>=200&&xhr.status<300){progress(100);resolve();}else{if(xhr.status===401)lock('Session expired — enter access code.');reject(new ApiError(data.error||'upload_failed',xhr.status));}};
    xhr.onerror=xhr.ontimeout=xhr.onabort=()=>{uploads.delete(xhr);reject(new Error('Upload failed — Retry'));};
    const body=new FormData();body.append('file',file,file.name);body.append('source',$<HTMLSelectElement>('device-label').value);xhr.send(body);
  });
}
let queueTail=Promise.resolve();
function queueFiles(selected:File[]){
  const current=generation;
  for(const file of selected){
    const item=document.createElement('div');item.className='queue-item';const name=document.createElement('span');name.textContent=file.name;
    const label=document.createElement('span');label.className='queue-status';label.textContent='Queued';
    const progress=document.createElement('progress');progress.max=100;progress.value=0;progress.setAttribute('aria-label','Upload progress');
    const retry=document.createElement('button');retry.className='text-button';retry.textContent='Retry';retry.hidden=true;
    item.append(name,label,progress,retry);$('queue').append(item);
    const run=async()=>{
      if(current!==generation)return;retry.hidden=true;
      if(file.size>20*1024*1024){label.textContent='Larger than 20 MB';return;}
      label.textContent='Uploading…';
      try{await upload(file,n=>{progress.value=n;label.textContent=n<95?`${n}%`:n<100?'Finishing…':'Uploaded ✓';});await refresh();setTimeout(()=>item.remove(),2500);}
      catch(e){if(current!==generation)return;label.textContent=e instanceof ApiError?e.message:'Upload failed — Retry';retry.hidden=false;}
    };
    retry.onclick=()=>{queueTail=queueTail.then(run);};queueTail=queueTail.then(run);
  }
}
$<HTMLFormElement>('unlock-form').onsubmit=async e=>{
  e.preventDefault();const b=$<HTMLButtonElement>('unlock');b.disabled=true;gateError.textContent='';
  try{start(await auth<ViewerSession>({action:'login',pin:code.value}));}
  catch(e){gateError.textContent=e instanceof ApiError?e.message:'Unable to connect. Try again.';code.select();}
  finally{b.disabled=false;}
};
$('copy').onclick=()=>void copy();$('copy-clear').onclick=()=>void copy(true);
$('clear').onclick=()=>{const snapshot=note;if(snapshot)confirmInline('Clear this output from both devices?',()=>clearSnapshot(snapshot));};
$('delete-all').onclick=()=>{const ids=files.map(f=>f.id);confirmInline(`Delete all ${ids.length} files from both devices?`,async()=>{await api('/delete-files',{ids});await refresh();});};
$('lock').onclick=async()=>{if(!session)return;try{await api('/logout',{});}catch{/* Local lock still clears the screen during an outage. Server TTL remains bounded. */}finally{lock();}};
$('forget').onclick=async()=>{try{await auth({action:'forget'});lock('Device unpaired. Use a new private setup link next time.');$<HTMLButtonElement>('unlock').disabled=true;}catch{message('Unable to unpair. Try again.');}};
const input=$<HTMLInputElement>('file-input');$('choose').onclick=()=>input.click();input.onchange=()=>{queueFiles(Array.from(input.files||[]));input.value='';};
const drop=$('drop');for(const name of ['dragenter','dragover'])drop.addEventListener(name,e=>{e.preventDefault();drop.classList.add('drag');});
for(const name of ['dragleave','drop'])drop.addEventListener(name,e=>{e.preventDefault();drop.classList.remove('drag');});
drop.addEventListener('drop',e=>queueFiles(Array.from((e as DragEvent).dataTransfer?.files||[])));
window.addEventListener('online',()=>void refresh());window.addEventListener('offline',()=>{reachable=false;setStatus();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
window.addEventListener('pagehide',()=>{for(const c of inflight)c.abort();$('note').textContent='';$('files').replaceChildren();note=null;files=[];});
window.addEventListener('pageshow',e=>{if(e.persisted){revision=-1;fileSignature='';void refresh();}});
setInterval(()=>{
  if(session&&session.expires_at<=Date.now()){lock('Session expired — enter access code.');return;}
  if(note&&Date.parse(note.expires_at)<=now()){note=null;renderNote();}
  else if(note)$('note-expiry').textContent=`Expires in ${remaining(note.expires_at)} min`;
  if(session)renderFiles();
},1000);
$<HTMLSelectElement>('device-label').value=matchMedia('(max-width: 700px)').matches?'Phone':'Work computer';
async function boot(){
  const invite=new URLSearchParams(location.hash.slice(1)).get('pair');if(location.hash)history.replaceState(null,'',location.pathname);
  try{
    if(invite)await auth({action:'pair',invite});
    const state=await auth<{paired:boolean;preview:boolean}>();$('preview-badge').hidden=!state.preview;
    if(!state.paired){gateError.textContent='Open your private setup link to connect this device.';$<HTMLButtonElement>('unlock').disabled=true;return;}
    $<HTMLButtonElement>('unlock').disabled=false;
    const saved=sessionStorage.getItem('relay-v2-session');if(saved){try{const value=JSON.parse(saved) as ViewerSession;if(value.expires_at>Date.now()){start(value);return;}}catch{}sessionStorage.removeItem('relay-v2-session');}
    code.focus();
  }catch(e){gateError.textContent=e instanceof ApiError?e.message:'Unable to connect. Reload to try again.';}
}
void boot();
