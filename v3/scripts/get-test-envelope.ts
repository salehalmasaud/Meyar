import {loadPrivateEnv} from './load-private-env.ts';import {makeEnvelope} from '../server/core.ts';
loadPrivateEnv();const e=await makeEnvelope('TinyFish V3 transport test — synthetic only',process.env.RELAY_V3_ENCRYPTION_SECRET!,process.env.RELAY_V3_PUSH_HMAC_SECRET!);
// Ciphertext only. This short-lived URL is solely for the synthetic compatibility test.
console.log(process.env.RELAY_V3_ALLOWED_ORIGINS!.split(',')[0]+'/push-note-v3?envelope='+Buffer.from(JSON.stringify(e)).toString('base64url'));
