/** Portable Web Crypto and validation. This module never logs data. */
export class RelayError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
export const utf8 = new TextEncoder();
export const decoder = new TextDecoder('utf-8', { fatal: true });
export const MAX_NOTE = 64 * 1024;
export const MAX_FILE = 20 * 1024 * 1024;
export const MAX_ENVELOPE = 92 * 1024;
export function b64(bytes: Uint8Array): string {
  let result = ''; for (const b of bytes) result += String.fromCharCode(b);
  return btoa(result).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function unb64(s: unknown, max = MAX_ENVELOPE): Uint8Array<ArrayBuffer> {
  if (typeof s !== 'string' || !s.length || s.length > max || !/^[A-Za-z0-9_-]+$/.test(s)) throw new RelayError(400, 'invalid_request');
  try {
    const bytes = Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));
    if (b64(bytes) !== s) throw new Error();
    return bytes;
  } catch { throw new RelayError(400, 'invalid_request'); }
}
export function randomToken(): string { return b64(crypto.getRandomValues(new Uint8Array(32))); }
export async function hash(s: string): Promise<string> { return b64(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8.encode(s)))); }
export async function hmac(secret: string, s: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', unb64(secret, 100), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64(new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8.encode(s))));
}
export async function verifyHmac(secret: string, value: string, signature: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey('raw', unb64(secret, 100), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    return await crypto.subtle.verify('HMAC', key, unb64(signature, 100), utf8.encode(value));
  } catch { return false; }
}
export async function equalSecret(a: string, b: string): Promise<boolean> {
  const x = await hash(a), y = await hash(b); let different = 0;
  for (let i = 0; i < x.length; i++) different |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return different === 0;
}
export interface Envelope { protocol: 3; version: number; timestamp: number; nonce: string; iv: string; ciphertext: string; signature: string }
export const associatedData = (e: Pick<Envelope, 'version' | 'timestamp' | 'nonce'>) => `relay-v3\n${e.version}\n${e.timestamp}\n${e.nonce}`;
export const signedData = (e: Omit<Envelope, 'signature'>) => `${associatedData(e)}\n${e.iv}\n${e.ciphertext}`;
export function validateEnvelope(value: unknown, now: number, windowSeconds: number): Envelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RelayError(400, 'invalid_request');
  const e = value as Envelope;
  if (Object.keys(e).sort().join(',') !== 'ciphertext,iv,nonce,protocol,signature,timestamp,version' || e.protocol !== 3 || !Number.isSafeInteger(e.version) || e.version <= 0 || !Number.isSafeInteger(e.timestamp)) throw new RelayError(400, 'invalid_request');
  if (Math.abs(now - e.timestamp) > windowSeconds * 1000 || e.version > now + windowSeconds * 1000) throw new RelayError(401, 'expired_request');
  if (unb64(e.nonce, 60).length !== 24 || unb64(e.iv, 30).length !== 12 || unb64(e.signature, 60).length !== 32) throw new RelayError(400, 'invalid_request');
  const size = unb64(e.ciphertext).length;
  if (size < 17 || size > MAX_NOTE + 16) throw new RelayError(413, 'too_large');
  return e;
}
async function aesKey(secret: string, usage: KeyUsage[]) {
  const bytes = unb64(secret, 100); if (bytes.length !== 32) throw new Error('configuration');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, usage);
}
export async function encryptText(text: string, key: string, aad: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8.encode(aad), tagLength: 128 }, await aesKey(key, ['encrypt']), utf8.encode(text)));
  return { iv: b64(iv), ciphertext: b64(ciphertext) };
}
export async function decryptText(e: { iv: string; ciphertext: string }, key: string, aad: string): Promise<string> {
  try {
    return decoder.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(e.iv, 30), additionalData: utf8.encode(aad), tagLength: 128 }, await aesKey(key, ['decrypt']), unb64(e.ciphertext)));
  } catch { throw new RelayError(400, 'invalid_envelope'); }
}
export async function makeEnvelope(text: string, encryption: string, signing: string, version = Date.now(), timestamp = Date.now()): Promise<Envelope> {
  if (!text.length || utf8.encode(text).length > MAX_NOTE) throw new RelayError(413, 'too_large');
  const base = { protocol: 3 as const, version, timestamp, nonce: b64(crypto.getRandomValues(new Uint8Array(24))) };
  const e = { ...base, ...await encryptText(text, encryption, associatedData(base)) };
  return { ...e, signature: await hmac(signing, signedData(e)) };
}
export async function verifyEnvelope(value: unknown, encryption: string, signing: string, now = Date.now(), windowSeconds = 120): Promise<Envelope> {
  const e = validateEnvelope(value, now, windowSeconds);
  if (!await verifyHmac(signing, signedData(e), e.signature)) throw new RelayError(401, 'unauthorized');
  const plain = await decryptText(e, encryption, associatedData(e));
  if (!plain.length || utf8.encode(plain).length > MAX_NOTE) throw new RelayError(400, 'invalid_envelope');
  return e;
}
export async function readLimited(req: Request, maximum: number): Promise<Uint8Array> {
  const length = req.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > maximum)) throw new RelayError(413, 'too_large');
  const reader = req.body?.getReader(); if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = []; let total = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; total += value.length; if (total > maximum) { await reader.cancel(); throw new RelayError(413, 'too_large'); } chunks.push(value); }
  const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } return bytes;
}
export async function readJson(req: Request, maximum = 4096): Promise<Record<string, unknown>> {
  try { const p = JSON.parse(decoder.decode(await readLimited(req, maximum))); if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error(); return p; }
  catch (e) { if (e instanceof RelayError) throw e; throw new RelayError(400, 'invalid_request'); }
}
export function sniffFile(bytes: Uint8Array): string {
  if (!bytes.length || bytes.length > MAX_FILE) throw new RelayError(413, 'too_large');
  const at = (s: string, offset = 0) => [...s].every((c, i) => bytes[offset + i] === c.charCodeAt(0));
  if (bytes.length >= 16 && at('%PDF-') && /%%EOF\s*$/.test(new TextDecoder().decode(bytes.slice(-1024)))) return 'application/pdf';
  if (bytes.length >= 32 && [137,80,78,71,13,10,26,10].every((v, i) => bytes[i] === v) && at('IHDR',12) && at('IEND',bytes.length-8)) return 'image/png';
  if (bytes.length >= 16 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes.at(-2) === 255 && bytes.at(-1) === 217) return 'image/jpeg';
  if (bytes.length >= 20 && at('RIFF') && at('WEBP', 8) && new DataView(bytes.buffer, bytes.byteOffset).getUint32(4,true)+8 === bytes.length && (at('VP8 ',12)||at('VP8L',12)||at('VP8X',12))) return 'image/webp';
  if (bytes.length >= 24 && at('ftyp',4)) {
    const size = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0);
    if (size >= 16 && size <= Math.min(bytes.length,256) && size % 4 === 0) {
      const brands = new TextDecoder().decode(bytes.slice(8,size));
      if (/heic|heix|hevc|hevx/.test(brands)) return 'image/heic';
      if (/mif1|msf1/.test(brands) && !/avif|avis/.test(brands)) return 'image/heif';
    }
  }
  throw new RelayError(415, 'unsupported_file');
}
export function cleanFilename(name: string): string {
  return name.replace(/[\u0000-\u001f\u007f/\\\u202a-\u202e\u2066-\u2069]/g, '_').slice(0, 180) || 'File';
}
export function numberSetting(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error('configuration'); return n;
}
export async function encryptBytes(bytes:Uint8Array,key:string,aad:string):Promise<Uint8Array>{
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:utf8.encode(aad)},await aesKey(key,['encrypt']),bytes as BufferSource));
  const result=new Uint8Array(12+encrypted.length);result.set(iv);result.set(encrypted,12);return result;
}
export async function decryptBytes(bytes:Uint8Array,key:string,aad:string):Promise<Uint8Array>{
  try{return new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12),additionalData:utf8.encode(aad)},await aesKey(key,['decrypt']),bytes.slice(12)));}
  catch{throw new RelayError(400,'invalid_envelope');}
}
