import test from 'node:test';
import assert from 'node:assert/strict';
import {LARGE_CHUNK,LARGE_MAX,largeMime,chunkLength,chunkTotal,validLargeHeader} from '../server/large.ts';
const bytes=(s:string)=>new TextEncoder().encode(s);
test('100 MB is split into 25 bounded encrypted segments',()=>{
 assert.equal(chunkTotal(LARGE_MAX),25);
 assert.equal(chunkTotal(20*1024*1024+1),6);
 assert.equal(chunkLength(LARGE_MAX,24),LARGE_CHUNK);
 assert.equal(chunkLength(20*1024*1024+1,5),1);
 assert.throws(()=>chunkTotal(LARGE_MAX+1),/too_large/);
 assert.throws(()=>chunkLength(LARGE_MAX,25),/invalid_chunk/);
});
test('large files are restricted to safe supported extensions',()=>{
 assert.equal(largeMime('document.pdf'),'application/pdf');
 assert.equal(largeMime('photo.JPG'),'image/jpeg');
 assert.equal(largeMime('archive.zip'),'application/zip');
 assert.equal(largeMime('review.xlsx'),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
 assert.equal(largeMime('video.mp4'),'video/mp4');
 assert.equal(largeMime('program.exe'),null);
 assert.equal(largeMime('folder/secret.pdf'),null);
});
test('the first encrypted chunk must match its claimed media type',()=>{
 const pdf=bytes('%PDF-1.7\n'+'x'.repeat(40));
 const zip=Uint8Array.from([80,75,3,4,...new Array(30).fill(0)]);
 const mp4=bytes('\u0000\u0000\u0000\u001cftypisom'+'x'.repeat(28));
 assert.equal(validLargeHeader('application/pdf',pdf),true);
 assert.equal(validLargeHeader('application/zip',zip),true);
 assert.equal(validLargeHeader('video/mp4',mp4),true);
 assert.equal(validLargeHeader('image/png',pdf),false);
 assert.equal(validLargeHeader('application/pdf',zip),false);
});
