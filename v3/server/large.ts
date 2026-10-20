import { b64, cleanFilename, decoder, decryptBytes, decryptText, encryptBytes, encryptText, hmac, readLimited, RelayError, unb64, utf8, verifyHmac } from './core.ts';
import type { Settings } from './config.ts';
import { Store, type FileRow } from './store.ts';

export const LARGE_CHUNK = 4 * 1024 * 1024;
export const LARGE_MAX = 100 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SMALL_MAX = 20 * 1024 * 1024;
const types: Record<string, string> = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
  zip: 'application/zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  mp4: 'video/mp4', mov: 'video/quicktime'
};
const zipTypes = new Set([types.zip, types.docx, types.xlsx, types.pptx]);
export function largeMime(name: string): string | null {
  if (!name || name.length > 180 || /[\/\\\u0000-\u001f\u007f]/.test(name)) return null;
  const ext = name.split('.').at(-1)?.toLowerCase() || '';
  return types[ext] || null;
}
export function chunkTotal(size: number): number {
  if (!Number.isSafeInteger(size) || size < 1 || size > LARGE_MAX) throw new RelayError(413, 'too_large');
  return Math.ceil(size / LARGE_CHUNK);
}
export function chunkLength(size: number, index: number): number {
  const count = chunkTotal(size);
  if (!Number.isInteger(index) || index < 0 || index >= count) throw new RelayError(400, 'invalid_chunk');
  return Math.min(LARGE_CHUNK, size - index * LARGE_CHUNK);
}
export function validLargeHeader(mime: string, data: Uint8Array): boolean {
  const starts = (s: string, pos = 0) => Array.from(s).every((ch, i) => data[i + pos] === ch.charCodeAt(0));
  if (data.length < 16) return false;
  if (mime === types.pdf) return starts('%PDF-');
  if (mime === types.png) return [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => data[i] === n);
  if (mime === types.jpg) return data[0] === 255 && data[1] === 216 && data[2] === 255;
  if (mime === types.webp) return starts('RIFF') && starts('WEBP', 8);
  if (mime === types.heic || mime === types.heif) return starts('ftyp', 4);
  if (mime === types.mp4 || mime === types.mov) return starts('ftyp', 4);
  if (zipTypes.has(mime)) return data[0] === 80 && data[1] === 75 && data[2] === 3 && data[3] === 4;
  return false;
}
function idOf(input: unknown): string {
  if (typeof input !== 'string' || !UUID.test(input)) throw new RelayError(400, 'invalid_request');
  return input;
}
function safeIndex(value: string): number {
  if (!/^(0|[1-9]\d?)$/.test(value)) throw new RelayError(400, 'invalid_chunk');
  return Number(value);
}
async function digest(data: Uint8Array): Promise<string> {
  return b64(new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource)));
}
const unix = () => Date.now();
const current = () => encodeURIComponent(new Date().toISOString());
const partFor = (index: number) => 'chunk-' + String(index).padStart(2, '0');
type Session = { hash: string; unlocked: boolean; expires_at: string };
type ChunkRecord = { digest: string; size: number };

export class LargeFiles {
  constructor(
    readonly c: Settings,
    readonly db: Store,
    readonly limit: (key: string, count: number, seconds: number) => Promise<void>,
    readonly notify: () => Promise<void>
  ) {}

  private async file(id: string, ready: boolean): Promise<FileRow> {
    const rows = await this.db.db<FileRow[]>(
      'relay_v3_objects?id=eq.' + id + '&kind=eq.file&large=eq.true&ready=eq.' +
      ready + '&expires_at=gt.' + current() + '&limit=1'
    );
    if (!rows?.length) throw new RelayError(404, 'file_expired');
    return rows[0];
  }
  private async name(id: string): Promise<string> {
    const encrypted = await (await this.db.get(id, 'meta')).json();
    const meta = JSON.parse(await decryptText(encrypted, this.c.encryption, 'file-info-v3.' + id));
    return String(meta.name);
  }
  async init(body: Record<string, unknown>, sessionHash: string) {
    const name = typeof body.name === 'string' ? cleanFilename(body.name) : '';
    const mime = largeMime(name);
    if (!mime) throw new RelayError(415, 'unsupported_file');
    const size = Number(body.size);
    const count = chunkTotal(size);
    const source = body.source === 'Phone' ? 'Phone' : 'Workstation';
    await this.limit('large-init.' + sessionHash, 12, 3600);
    const id = crypto.randomUUID();
    const reserved = await this.db.rpc<boolean>('reserve_large', {
      p_id: id, p_mime: mime, p_size: size, p_source: source
    });
    if (!reserved) throw new RelayError(413, 'inbox_full');
    try {
      const encrypted = await encryptText(JSON.stringify({ name }), this.c.encryption, 'file-info-v3.' + id);
      await this.db.put(id, 'meta', JSON.stringify(encrypted));
    } catch (e) {
      await this.db.db('relay_v3_objects?id=eq.' + id, 'PATCH', { expires_at: new Date().toISOString() }).catch(() => {});
      throw e;
    }
    const payload = b64(utf8.encode(JSON.stringify({ session: sessionHash, id, exp: unix() + 45 * 60_000 })));
    return {
      ok: true, id, count, chunk_size: LARGE_CHUNK,
      upload_url: this.c.url + '/functions/v1/relay-v3/large-chunk/' + id,
      ticket: payload + '.' + await hmac(this.c.ticket, 'large-upload-v3.' + payload)
    };
  }
  async uploadChunk(req: Request, action: string): Promise<{ ok: true; index: number }> {
    const match = /^\/large-chunk\/([0-9a-f-]{36})\/([0-9]{1,2})$/.exec(action);
    if (!match) throw new RelayError(400, 'invalid_chunk');
    const id = idOf(match[1]);
    const index = safeIndex(match[2]);
    const bearer = (req.headers.get('authorization') || '').replace(/^Bearer /, '');
    const parts = bearer.split('.');
    if (parts.length !== 2 || !await verifyHmac(this.c.ticket, 'large-upload-v3.' + parts[0], parts[1]))
      throw new RelayError(401, 'session_expired');
    let ticket: { session: string; id: string; exp: number };
    try { ticket = JSON.parse(decoder.decode(unb64(parts[0], 2048))); }
    catch { throw new RelayError(401, 'session_expired'); }
    if (ticket.id !== id || !Number.isSafeInteger(ticket.exp) || ticket.exp <= unix() ||
        !/^[A-Za-z0-9_-]{43}$/.test(ticket.session || ''))
      throw new RelayError(401, 'session_expired');
    const sessions = await this.db.db<Session[]>(
      'relay_v3_sessions?hash=eq.' + ticket.session + '&unlocked=eq.true&expires_at=gt.' + current()
    );
    if (!sessions.length) throw new RelayError(401, 'session_expired');
    await this.limit('large-chunks.' + ticket.session, 240, 3600);
    const file = await this.file(id, false);
    const expected = chunkLength(file.size, index);
    const data = await readLimited(req, LARGE_CHUNK + 1);
    if (data.length !== expected) throw new RelayError(400, 'invalid_chunk');
    if (index === 0 && !validLargeHeader(file.mime, data)) throw new RelayError(415, 'unsupported_file');
    const sha = await digest(data);
    const prior = await this.db.db<ChunkRecord[]>(
      'relay_v3_large_chunks?file_id=eq.' + id + '&idx=eq.' + index + '&select=size,digest'
    );
    if (prior.length) {
      if (prior[0].size !== data.length || prior[0].digest !== sha) throw new RelayError(409, 'chunk_conflict');
      return { ok: true, index };
    }
    const part = partFor(index);
    try {
      await this.db.put(id, part, await encryptBytes(data, this.c.encryption, 'large-file-v3.' + id + '.' + index));
    } catch (e) {
      // A lost response can leave a fully persisted chunk. Validate its bytes before acknowledging.
      try {
        const encrypted = new Uint8Array(await (await this.db.get(id, part)).arrayBuffer());
        const existing = await decryptBytes(encrypted, this.c.encryption, 'large-file-v3.' + id + '.' + index);
        if (existing.length !== data.length || existing.some((b, i) => b !== data[i])) throw new Error('conflict');
      } catch { throw e; }
    }
    const recorded = await this.db.rpc<boolean>('record_large_chunk', {
      p_id: id, p_index: index, p_size: data.length, p_digest: sha
    });
    if (!recorded) throw new RelayError(409, 'chunk_conflict');
    return { ok: true, index };
  }
  async finish(body: Record<string, unknown>) {
    const id = idOf(body.id);
    await this.file(id, false);
    const ok = await this.db.rpc<boolean>('finish_large', { p_id: id, p_ttl: this.c.fileTtl });
    if (!ok) throw new RelayError(409, 'incomplete_file');
    await this.notify();
    return { ok: true, id };
  }
  async downloadTicket(body: Record<string, unknown>) {
    const id = idOf(body.id);
    const row = await this.file(id, true);
    const expiry = Math.min(unix() + 20 * 60_000, Date.parse(row.expires_at));
    if (expiry <= unix()) throw new RelayError(404, 'file_expired');
    return {
      id, expires: expiry, signature: await hmac(this.c.link, 'large-download-v3.' + id + '.' + expiry),
      base_url: this.c.url + '/functions/v1/relay-v3/large-download/' + id + '/',
      chunk_count: chunkTotal(row.size), chunk_size: LARGE_CHUNK, size: row.size, mime: row.mime,
      name: await this.name(id)
    };
  }
  async downloadChunk(action: string, url: URL, headers: Record<string, string>): Promise<Response> {
    const match = /^\/large-download\/([0-9a-f-]{36})\/([0-9]{1,2})$/.exec(action);
    if (!match) throw new RelayError(400, 'invalid_chunk');
    const id = idOf(match[1]), index = safeIndex(match[2]);
    const exp = Number(url.searchParams.get('expires'));
    if (!Number.isSafeInteger(exp) || exp <= unix() || exp > unix() + 20 * 60_000 + 60_000 ||
        !await verifyHmac(this.c.link, 'large-download-v3.' + id + '.' + exp, url.searchParams.get('signature') || ''))
      throw new RelayError(401, 'link_expired');
    const row = await this.file(id, true);
    const expected = chunkLength(row.size, index);
    const encrypted = new Uint8Array(await (await this.db.get(id, partFor(index))).arrayBuffer());
    const data = await decryptBytes(encrypted, this.c.encryption, 'large-file-v3.' + id + '.' + index);
    if (data.length !== expected) throw new RelayError(503, 'invalid_file');
    return new Response(data as BodyInit, {
      headers: { ...headers, 'content-type': 'application/octet-stream', 'content-length': String(data.length),
        'content-security-policy': "default-src 'none'; sandbox", 'content-disposition': 'attachment; filename="part.bin"' }
    });
  }
}
