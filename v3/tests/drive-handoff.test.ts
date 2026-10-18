import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const app=readFileSync(new URL('../src/app.ts',import.meta.url),'utf8');

test('Drive handoff appears only inside the authenticated Relay workspace',()=>{
 const workspace=html.indexOf('<section id="workspace" hidden>');
 const handoff=html.indexOf('<section id="drive-upload"');
 const footer=html.indexOf('<footer>',handoff);
 assert.ok(workspace!==-1&&handoff>workspace&&footer>handoff);
});

test('Drive handoff opens the exact private folder with safe new-tab attributes',()=>{
 assert.match(html,/id="drive-link"[^>]*href="https:\/\/drive\.google\.com\/drive\/folders\/1_RPbbpfaIj74myGjIN5xbYftx5E1SIFl"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
 assert.match(html,/not into Relay/);
 assert.match(html,/Never upload patient-identifiable records/);
});

test('oversized Relay files point to the Google Drive handoff',()=>{
 assert.match(app,/file\.size>20\*1024\*1024/);
 assert.match(app,/'drive-link'\)\.click\(\)/);
});
