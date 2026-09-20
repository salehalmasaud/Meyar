export interface Note {id:string;version:number;sequence:number;text:string;received_at:string;expires_at:string}
export interface RelayFile {id:string;name:string;mime:string;size:number;source:string;created_at:string;expires_at:string}
export const ordered=(notes:Note[],newest=false)=>[...notes].sort((a,b)=>newest?b.sequence-a.sequence:a.sequence-b.sequence);
export const nextNote=(notes:Note[],copied:Set<string>)=>ordered(notes).find(n=>!copied.has(n.id));
export const metadata=(text:string)=>({pt:text.split(/\r?\n/).find(l=>l.startsWith('Pt:'))||'',dx:text.split(/\r?\n/).find(l=>l.startsWith('Dx:'))||''});
export const activeNotes=(notes:Note[],now:number)=>notes.filter(n=>Date.parse(n.expires_at)>now);
