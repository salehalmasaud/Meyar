import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../server/connector.ts',import.meta.url),'utf8');
test('large multipart read only exports authenticated 2 MiB pieces',()=>{
 assert.match(source,/const chunkIndex=Math\.floor\(index\/2\)/);
 assert.match(source,/db\.get\(row\.id,'chunk-'\+String\(chunkIndex\)\.padStart\(2,'0'\)\)/);
 assert.match(source,/decryptBytes\(encrypted,c\.encryption,'large-file-v3\.'\+row\.id\+'\.'\+chunkIndex\)/);
 assert.match(source,/if\(decoded\.length!==expectedChunk\)/);
 assert.match(source,/if\(part\.length!==Math\.min\(partSize,row\.size-index\*partSize\)\)/);
 assert.match(source,/if\(!hasScope\(auth,fileScope\)\)return insufficient\(\)/);
});
test('two-MiB pieces cover large documents exactly',()=>{
 const partSize=2*1024*1024, storageChunkSize=4*1024*1024;
 for(const size of [31934462,39492123,100*1024*1024]){
  const n=Math.ceil(size/partSize);
  let total=0;
  for(let index=0;index<n;index++){
   const ci=Math.floor(index/2),chunkSize=Math.min(storageChunkSize,size-ci*storageChunkSize);
   const offset=(index%2)*partSize;
   const result=Math.max(0,Math.min(chunkSize-offset,partSize));
   assert.equal(result,Math.min(partSize,size-index*partSize));
   total+=result;
  }
  assert.equal(total,size);
 }
});
