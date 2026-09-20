import {test,expect,chromium} from '@playwright/test';import {mkdirSync} from 'node:fs';
import {site,viewer,login,gateway,db} from '../helpers.ts';import {hash} from '../../server/core.ts';import {scopeInbox} from './scope.ts';
test('native Chromium PDF modal on a real generated PDF',async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}}),files:string[]=[];await scopeInbox(context,[],files);const page=await context.newPage();
 try{
  await page.setContent('<h1>Trackcare Relay preview test</h1><p>Synthetic document. No patient information.</p>');const bytes=await page.pdf({format:'A4'});
  await page.goto(site+'/#access='+viewer);await expect(page.locator('#unlock')).toBeEnabled();await page.locator('#code').fill('000');await page.locator('#unlock').click();await expect(page.locator('#workspace')).toBeVisible();
  expect(await page.evaluate(()=>navigator.pdfViewerEnabled)).toBe(true);
  await page.locator('#file-input').setInputFiles({name:'native-preview.pdf',mimeType:'application/pdf',buffer:bytes});await expect(page.locator('.file')).toHaveCount(1,{timeout:35000});
  const loaded=page.waitForResponse(r=>r.url().includes('/relay-v3/file/')&&r.headers()['content-type']==='application/pdf');await page.getByRole('button',{name:'Preview native-preview.pdf',exact:true}).click();const response=await loaded;expect(response.status()).toBe(200);await response.finished();await expect(page.locator('#file-preview iframe')).toBeVisible();
  await expect.poll(()=>page.frames().length).toBeGreaterThan(1);await page.waitForTimeout(2500);mkdirSync('artifacts',{recursive:true});await page.screenshot({path:'artifacts/v3-native-pdf-preview.png'});
  await page.locator('#preview-close').click();await expect(page.locator('#preview-content')).toBeEmpty();
 }finally{const token=await login('pdf-preview-cleanup');await gateway('/delete-files',token,{ids:files});await db('relay_v3_sessions?hash=eq.'+await hash(token),'DELETE');const cookie=(await context.cookies()).find(c=>c.name==='__Host-relay_v3');if(cookie)await db('relay_v3_sessions?hash=eq.'+await hash(cookie.value),'DELETE');await browser.close();}
});
