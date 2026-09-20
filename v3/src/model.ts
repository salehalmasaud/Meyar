export interface Note {id:string;version:number;sequence:number;text:string;received_at:string;expires_at:string}
export interface RelayFile {id:string;name:string;mime:string;size:number;source:string;created_at:string;expires_at:string}
export const ordered=(notes:Note[],newest=false)=>[...notes].sort((a,b)=>newest?b.sequence-a.sequence:a.sequence-b.sequence);
export const nextNote=(notes:Note[],copied:Set<string>)=>ordered(notes).find(n=>!copied.has(n.id));
export const metadata=(text:string)=>({pt:text.split(/\r?\n/).find(l=>l.startsWith('Pt:'))||'',dx:text.split(/\r?\n/).find(l=>l.startsWith('Dx:'))||''});
export const activeNotes=(notes:Note[],now:number)=>notes.filter(n=>Date.parse(n.expires_at)>now);
export const remainingCount=(notes:Note[],copied:Set<string>)=>notes.filter(n=>!copied.has(n.id)).length;
export function expiryLabel(value:string,now=Date.now()){
 const date=new Date(value),today=new Date(now),tomorrow=new Date(now);tomorrow.setDate(today.getDate()+1);
 const day=date.toDateString()===today.toDateString()?'':date.toDateString()===tomorrow.toDateString()?' tomorrow':' '+date.toLocaleDateString([],{month:'short',day:'numeric'});
 return 'Expires '+date.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})+day;
}
export const preference=(value:string|null,allowed:string[],fallback:string)=>value&&allowed.includes(value)?value:fallback;
