import {buildTrackcareHtml} from './trackcare-format.ts';

function legacyCopy(text:string,html?:string):boolean{
  const field=document.createElement('textarea');
  field.value=text;
  field.className='clipboard-helper';
  field.setAttribute('aria-hidden','true');
  document.body.append(field);
  field.select();

  let handled=false;
  const onCopy=(event:ClipboardEvent)=>{
    if(!event.clipboardData)return;
    event.preventDefault();
    event.clipboardData.setData('text/plain',text);
    if(html)event.clipboardData.setData('text/html',html);
    handled=true;
  };

  document.addEventListener('copy',onCopy);
  try{return document.execCommand('copy')&&handled;}
  catch{return false;}
  finally{document.removeEventListener('copy',onCopy);field.remove();}
}

export async function copyExact(text:string):Promise<boolean>{
  try{
    if(navigator.clipboard?.writeText){
      await navigator.clipboard.writeText(text);
      return true;
    }
  }catch{/* restricted workstation fallback */}
  return legacyCopy(text);
}

export async function copyForTrackcare(text:string):Promise<'rich'|'plain'|false>{
  const html=buildTrackcareHtml(text);
  try{
    if(navigator.clipboard?.write&&typeof ClipboardItem!=='undefined'){
      const item=new ClipboardItem({
        'text/plain':new Blob([text],{type:'text/plain;charset=utf-8'}),
        'text/html':new Blob([html],{type:'text/html;charset=utf-8'})
      });
      await navigator.clipboard.write([item]);
      return 'rich';
    }
  }catch{/* restricted workstation fallback */}

  if(legacyCopy(text,html))return 'rich';
  return await copyExact(text)?'plain':false;
}
