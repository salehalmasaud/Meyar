export async function copyExact(text:string):Promise<boolean> {
  try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; } } catch { /* restricted workstation fallback */ }
  const field=document.createElement('textarea'); field.value=text; field.className='clipboard-helper'; field.setAttribute('aria-hidden','true');
  document.body.append(field); field.select(); let handled=false;
  const onCopy=(event:ClipboardEvent)=>{ if(event.clipboardData){event.preventDefault();event.clipboardData.setData('text/plain',text);handled=true;} };
  document.addEventListener('copy',onCopy);
  try { return document.execCommand('copy') && handled; }
  catch { return false; }
  finally { document.removeEventListener('copy',onCopy); field.remove(); }
}
