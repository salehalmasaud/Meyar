import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../server/connector.ts',import.meta.url),'utf8');

test('MCP export supports small multipart documents without exposing storage keys',()=>{
 assert.match(source,/row\.large&&row\.size>2\*1024\*1024/);
 assert.match(source,/db\.get\(row\.id,'chunk-00'\)/);
 assert.match(source,/decryptBytes\(encrypted,c\.encryption,'large-file-v3\.'\+row\.id\+'\.0'\)/);
 assert.match(source,/if\(bytes\.length!==row\.size\)/);
 assert.match(source,/if\(row\.size<=14\*1024\*1024\)/);
 assert.match(source,/mcpBlobBase64\(bytes\)/);
});
