import {readFileSync,writeFileSync} from 'node:fs';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
const site='https://trackcare-relay-v3--trackcare-relay.netlify.app';const hashes:Record<string,string>={};
for(const file of ['index.html','app.js','app.css','relay.svg']){
 const expected=readFileSync('dist/'+file),r=await fetch(site+'/'+file);assert.equal(r.status,200);const actual=Buffer.from(await r.arrayBuffer());assert.deepEqual(actual,expected);hashes[file]=createHash('sha256').update(actual).digest('hex');
 assert.match(r.headers.get('cache-control')||'',/no-store/);assert.ok(r.headers.get('content-security-policy'));
}
writeFileSync('tests/release-results.json',JSON.stringify({at:new Date().toISOString(),site,assets_match_local_build:true,security_headers:true,sha256:hashes},null,2)+'\n');console.log('PASS deployed HTML, JavaScript, CSS and icon exactly match local build; no-store and CSP present.');
