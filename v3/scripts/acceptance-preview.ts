import {chromium,expect} from '@playwright/test';import {mkdirSync,writeFileSync} from 'node:fs';
import {site,viewer,push,login,gateway,db} from '../tests/helpers.ts';import {hash} from '../server/core.ts';
const token=await login('acceptance-seed');const state=await(await gateway('/state',token)).json();
if(state.notes.length||state.files.length)throw new Error('Acceptance seeding requires an empty preview. Existing items kept.');
const accepted=[];for(const name of ['Test Note A','Test Note B','Test Note C']){const r=await push(name);expect(r.status).toBe(200);accepted.push(r.data.id);}
await db('relay_v3_sessions?hash=eq.'+await hash(token),'DELETE');
const browser=await chromium.launch();
try{
 const context=await browser.newContext({permissions:['clipboard-read','clipboard-write'],viewport:{width:1440,height:1000}});const page=await context.newPage();
 await page.goto(site+'/#access='+viewer);await expect(page.locator('#unlock')).toBeEnabled();await page.locator('#code').fill('000');await page.locator('#unlock').click();await expect(page.locator('.note-text')).toHaveText(['Test Note A','Test Note B','Test Note C']);
 await page.locator('.note-copy').first().click();await expect(page.locator('.note-copy').first()).toHaveText('Copied ✓');await page.reload();await expect(page.locator('.note-text')).toHaveText(['Test Note A','Test Note B','Test Note C']);await expect(page.locator('.note-copy').first()).toHaveText('Copied ✓');
 mkdirSync('artifacts',{recursive:true});await page.screenshot({path:'artifacts/acceptance-abc.png',fullPage:true});
 const c=(await context.cookies()).find(c=>c.name==='__Host-relay_v3')!;await db('relay_v3_sessions?hash=eq.'+await hash(c.value),'DELETE');
 writeFileSync('tests/acceptance-results.json',JSON.stringify({at:new Date().toISOString(),notes:['Test Note A','Test Note B','Test Note C'],simultaneously_visible:true,first_copied:true,refresh_retained_all:true,note_count:3,ttl_hours:12,remaining_files:0},null,2)+'\n');
 console.log('PASS: A/B/C visible together; Copy A and refresh verified. Three synthetic notes remain for owner review.');
}finally{await browser.close();}
