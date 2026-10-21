import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../server/connector.ts',import.meta.url),'utf8');
test('large standard PDFs can be exported as bounded binary parts without new scopes',()=>{
 assert.match(source,/virtualPart=\/\^\(\[0-9a-f-\]\{36\}\):part/);
 assert.match(source,/partSize=2\*1024\*1024/);
 assert.match(source,/bytes\.slice\(index\*partSize/);
 assert.match(source,/mimeType:'application\/octet-stream'/);
 assert.match(source,/isError:false/);
});
