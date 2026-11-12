import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.ts';
import type { Settings } from '../server/config.ts';
test('RPCs returning HTTP 204 do not turn committed operations into failed responses',async()=>{
  class VoidStore extends Store { override async call(){return new Response(null,{status:204});} }
  assert.equal(await new VoidStore({} as Settings).rpc('expire'),null);
});
test('storage deletion precedes metadata deletion, preserving cleanup retries',async()=>{
  const calls:string[]=[];
  class FailedStorage extends Store { override async call(path:string){calls.push(path);throw new Error('storage unavailable');return new Response();} }
  await assert.rejects(()=>new FailedStorage({} as Settings).removeObjects(['00000000-0000-4000-8000-000000000000']));
  assert.deepEqual(calls,['/storage/v1/object/relay-v2-private']);
});
