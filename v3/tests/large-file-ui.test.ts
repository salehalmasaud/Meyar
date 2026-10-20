import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const client=readFileSync(new URL('../src/app.ts',import.meta.url),'utf8');
const transfer=readFileSync(new URL('../src/large-transfer.ts',import.meta.url),'utf8');
const server=readFileSync(new URL('../server/handler.ts',import.meta.url),'utf8');
const gateway=readFileSync(new URL('../netlify/functions/api.mts',import.meta.url),'utf8');

test('the secure native large uploader stays inside the private Relay workspace',()=>{
 const workspace=html.indexOf('<section id="workspace" hidden>');
 const section=html.indexOf('<section id="large-upload"');
 const footer=html.indexOf('<footer>',section);
 assert.ok(workspace>=0&&section>workspace&&footer>section);
 assert.match(html,/id="large-choose"/);
 assert.match(html,/id="large-file-input"/);
 assert.doesNotMatch(html,/drive\.google\.com|id="drive-upload"|id="drive-link"/);
});
test('large files move from the workstation into the same Relay private inbox',()=>{
 assert.match(client,/sendLarge\(f,request,uploads/);
 assert.match(client,/fetchLarge\(file,request/);
 assert.match(transfer,/large-init/);
 assert.match(transfer,/large-finish/);
 assert.match(transfer,/large-download-ticket/);
 assert.match(gateway,/large-download-ticket/);
 assert.match(server,/large\.downloadChunk/);
});
