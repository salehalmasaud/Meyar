import type {BrowserContext} from '@playwright/test';
// Test browser sees only IDs created by this run. All writes still use the real
// deployed API. Never let a Clear all test include an existing clinical item.
export async function scopeInbox(context:BrowserContext,notes:string[],files:string[]){
 await context.route('**/api/state*',async route=>{
  try{
  const url=new URL(route.request().url());url.searchParams.set('since','-1');
  const response=await route.fetch({url:url.href});const data=await response.json();
  if(response.ok()){data.notes=data.notes.filter((n:{id:string})=>notes.includes(n.id));data.files=data.files.filter((f:{id:string})=>files.includes(f.id));}
  await route.fulfill({response,json:data});
  }catch{/* Context may close during an in-flight reconciliation. Never log cookies. */}
 });
 await context.route('**/relay-v3/upload',async route=>{const response=await route.fetch();const data=await response.json();if(response.ok()&&data.id)files.push(data.id);await route.fulfill({response,json:data});});
}
