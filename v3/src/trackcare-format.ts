const TEAL='#006666';
const SHADE='#ECF0F1';

type Section='top'|'assessment'|'anthropometrics'|'laboratory'|'requirements'|'plan'|'other';

const esc=(value:string)=>value
  .replace(/&/g,'&amp;')
  .replace(/</g,'&lt;')
  .replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;')
  .replace(/'/g,'&#39;');

function sectionHeading(value:string):Section|null{
  const key=value.trim().replace(/:$/,'').toLowerCase();
  if(key==='nutrition assessment')return 'assessment';
  if(key==='anthropometrics')return 'anthropometrics';
  if(key==='laboratory')return 'laboratory';
  if(key==='nutrition requirements')return 'requirements';
  if(key==='plan')return 'plan';
  return null;
}

const headingStyle=(shade=false)=>
  `font-family:'Times New Roman',serif;font-size:13.5pt;font-weight:700;color:${TEAL};text-decoration:underline;line-height:1.0;`+
  (shade?`background-color:${SHADE};`:'');

const bodyStyle=(section:Section)=>{
  if(section==='assessment')return "font-family:Cambria,serif;font-size:10pt;font-weight:700;color:#000000;line-height:1.0;";
  if(section==='requirements'||section==='plan')return "font-family:'Times New Roman',serif;font-size:12pt;font-weight:700;color:#000000;line-height:1.0;";
  return "font-family:'Times New Roman',serif;font-size:12pt;font-weight:400;color:#000000;line-height:1.0;";
};

function bodyLine(text:string,section:Section,bullet:boolean){
  const style=bodyStyle(section);
  if(bullet){
    return `<div style="${style}margin:0 0 4pt 26pt;text-indent:-14pt;"><span style="font-family:'Times New Roman',serif;">•</span>&nbsp;&nbsp;${esc(text)}</div>`;
  }
  return `<div style="${style}margin:0 0 3pt 0;">${esc(text)}</div>`;
}

export function buildTrackcareHtml(text:string):string{
  const lines=text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n');
  const out:string[]=[];
  let section:Section='top';
  let firstContent=true;

  out.push("<div style=\"font-family:'Times New Roman',serif;font-size:12pt;color:#000000;line-height:1.0;\">");

  for(const raw of lines){
    const trimmed=raw.trim();

    if(!trimmed){
      out.push('<div style="height:6pt;line-height:6pt;font-size:1pt;">&nbsp;</div>');
      continue;
    }

    const heading=sectionHeading(trimmed);
    if(heading){
      section=heading;
      const shade=heading==='plan';
      out.push(`<div style="margin:14pt 0 8pt 0;"><span style="${headingStyle(shade)}">${esc(trimmed)}</span></div>`);
      firstContent=false;
      continue;
    }

    if(firstContent&&/^\(\s*Dieti(?:tian|cian)\b/i.test(trimmed)){
      out.push(`<div style="margin:0 0 16pt 0;"><span style="${headingStyle(true)}">${esc(trimmed)}</span></div>`);
      firstContent=false;
      continue;
    }

    if(/^Pt:/i.test(trimmed)||/^Dx:/i.test(trimmed)){
      out.push(`<div style="font-family:'Times New Roman',serif;font-size:13.5pt;font-weight:700;color:#000000;line-height:1.0;margin:0 0 3pt 0;">${esc(trimmed)}</div>`);
      firstContent=false;
      continue;
    }

    const bullet=/^[-•·]\s+(.*)$/.exec(trimmed);
    if(bullet){
      out.push(bodyLine(bullet[1],section,true));
      firstContent=false;
      continue;
    }

    out.push(bodyLine(trimmed,section,false));
    firstContent=false;
  }

  out.push('</div>');
  return out.join('');
}
