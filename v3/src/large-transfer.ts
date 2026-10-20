import type {RelayFile} from './model.ts';

type RequestFn=<T>(path:string,body?:unknown)=>Promise<T>;
type Init={ok:true;id:string;count:number;chunk_size:number;ticket:string;upload_url:string};
type Download={id:string;base_url:string;expires:number;signature:string;chunk_count:number;chunk_size:number;size:number;mime:string;name:string};

export const SMALL_LIMIT=20*1024*1024;
export const LARGE_LIMIT=100*1024*1024;
export const extendedType=(name:string)=>/\.(zip|docx|xlsx|pptx|mp4|mov)$/i.test(name);
const pause=(time:number)=>new Promise(resolve=>setTimeout(resolve,time));

export async function sendLarge(
 file:File, request:RequestFn, active:Set<XMLHttpRequest>,
 isActive:()=>boolean, onProgress:(percent:number)=>void
):Promise<void>{
 const source=matchMedia('(max-width:760px)').matches?'Phone':'Workstation';
 const spec=await request<Init>('/large-init',{name:file.name,size:file.size,source});
 if(!isActive())throw new Error('Session ended');
 let uploaded=0;
 for(let index=0;index<spec.count;index++){
  if(!isActive())throw new Error('Session ended');
  const chunk=file.slice(index*spec.chunk_size,Math.min(file.size,(index+1)*spec.chunk_size));
  let done=false,err:Error=new Error('Upload interrupted');
  for(let attempt=0;attempt<3&&!done;attempt++){
   try{
    await new Promise<void>((resolve,reject)=>{
     const x=new XMLHttpRequest();active.add(x);
     x.open('POST',spec.upload_url+'/'+index);x.setRequestHeader('authorization','Bearer '+spec.ticket);
     x.setRequestHeader('content-type','application/octet-stream');x.timeout=120000;
     x.upload.onprogress=e=>{
       if(e.lengthComputable)onProgress(Math.min(95,Math.round((uploaded+e.loaded)/file.size*95)));
     };
     x.onload=()=>{active.delete(x);if(x.status>=200&&x.status<300)resolve();else{let msg='Upload failed';try{msg=JSON.parse(x.responseText).error||msg;}catch{}reject(new Error(msg));}};
     x.onerror=x.ontimeout=x.onabort=()=>{active.delete(x);reject(new Error('Upload interrupted'));};
     x.send(chunk);
    });
    done=true;
   }catch(e){
    err=e instanceof Error?e:new Error('Upload failed');
    if(attempt<2&&isActive())await pause(750*(attempt+1));
   }
  }
  if(!done)throw err;
  uploaded+=chunk.size;onProgress(Math.min(95,Math.round(uploaded/file.size*95)));
 }
 if(!isActive())throw new Error('Session ended');
 await request('/large-finish',{id:spec.id});
 onProgress(100);
}

export async function fetchLarge(
 file:RelayFile, request:RequestFn, isActive:()=>boolean, onProgress:(percent:number)=>void
):Promise<void>{
 if(!isActive())throw new Error('Session ended');
 const t=await request<Download>('/large-download-ticket',{id:file.id});
 if(t.id!==file.id||t.size!==file.size||t.chunk_count<1||t.chunk_count>25)
  throw new Error('Invalid download metadata');
 const buffers:ArrayBuffer[]=[];let received=0;
 for(let index=0;index<t.chunk_count;index++){
  if(!isActive())throw new Error('Session ended');
  const link=t.base_url+index+'?expires='+t.expires+'&signature='+encodeURIComponent(t.signature);
  const response=await fetch(link,{cache:'no-store',referrerPolicy:'no-referrer'});
  if(!response.ok)throw new Error('Download interrupted at part '+(index+1));
  const chunk=await response.arrayBuffer();
  const expected=Math.min(t.chunk_size,t.size-index*t.chunk_size);
  if(chunk.byteLength!==expected)throw new Error('Incomplete download');
  buffers.push(chunk);received+=chunk.byteLength;
  onProgress(Math.round(received/t.size*100));
 }
 if(received!==t.size||!isActive())throw new Error('Incomplete download');
 const objectUrl=URL.createObjectURL(new Blob(buffers,{type:t.mime||'application/octet-stream'}));
 const link=document.createElement('a');link.href=objectUrl;link.download=t.name;link.rel='noreferrer';
 document.body.append(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(objectUrl),60000);
}
