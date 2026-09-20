const button=document.getElementById('connect') as HTMLButtonElement;
button.onclick=async()=>{
 button.disabled=true;const output=document.getElementById('result')!;
 try{
  const params=Object.fromEntries(new URLSearchParams(location.search));
  const response=await fetch('/api/oauth/authorize',{method:'POST',headers:{'content-type':'application/json'},credentials:'same-origin',body:JSON.stringify(params)});
  const data=await response.json();if(!response.ok)throw new Error(data.error==='viewer_login_required'?'Open your saved receiver bookmark, enter 000, then return here and try again.':'Connection could not be authorized. Restart the connection from ChatGPT settings.');
  location.replace(data.redirect);
 }catch(e){output.textContent=e instanceof Error?e.message:'Connection failed.';button.disabled=false;}
};
