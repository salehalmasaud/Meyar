# V3 architecture

## Product model

The sender appends an immutable note, and the receiver processes the inbox oldest first. Presentation numbering is recalculated for visible notes. The user can switch ordering instantly; Copy next always selects the oldest un-copied note. Copy never deletes. Clear copied/Clear all operate on the specific IDs captured when the confirmation opens, protecting later arrivals. Files have their own Delete all action.

Exact UTF-8 text is encrypted without trimming, reformatting, normalization, Markdown stripping, or line-ending conversion. The browser renders it with `textContent` and passes the original string to `navigator.clipboard.writeText`. A copy-event fallback uses the same original string. Windows clipboard/paste targets may normalize line endings at the operating-system boundary; the application does not. Patient summaries are extracted client-side from `Pt:` and `Dx:` lines, with no metadata database.

## Components

1. Self-contained TypeScript/CSS UI on the V3 Netlify preview; no fonts, CDNs, telemetry, third-party scripts, or patient content in browser storage.
2. `/api/*` same-origin Netlify gateway. Exchanges the random viewer fragment and sets `__Host-relay_v3`, HttpOnly, Secure, SameSite=Strict, Path=/, eight-hour absolute lifetime. The browser cannot read the session credential. PIN remains exactly `000` and unlocks that session. Lock destroys the old session and creates a locked replacement with the same remaining lifetime.
3. Dedicated `relay-v3` Supabase Edge Function. Custom HMAC authentication protects push; independent gateway authentication protects viewer APIs; short-lived upload tickets protect file upload.
4. RLS-enabled `relay_v3_*` tables with public/anon/authenticated access revoked. Only the server service role accesses them.
5. Private `relay-v3-private` Storage bucket. AES-256-GCM encrypts notes, file bytes, and original filenames. Random UUID paths contain no patient information. Database backups therefore contain pointers/TTL/order/auth metadata, not the actual note text, ciphertext payloads, filenames, or file bytes.
6. A Supabase cron job calls the narrow expiry-only sweep every minute. It cannot shorten expiry, accepts no object IDs, returns no content, and is limited to two runs per minute. Failed object deletions retain their expiry tombstones for retry. No viewer needs to be online.
7. An additive [OAuth/MCP sender](SENDER_ARCHITECTURE.md) exposes only `send_note({note})` to ChatGPT. It creates the existing encrypted envelope server-side and POSTs to the existing push endpoint. A separate minute cleanup job removes expired OAuth and sender receipt metadata.

## Append transaction

A pending storage reservation is created with a ten-minute expiry. After authenticated decryption verifies the incoming envelope, its encrypted form is stored. The append RPC locks the V3 state row, rejects replay/duplicate or stale versions, and inserts a new note with a database-generated sequence and a database-time deadline of `received_at + 12 hours`. Earlier notes are never updated. The last accepted version persists without note content, preventing reuse even after cleanup. Nonce records expire after ten minutes, longer than the complete request freshness window.

A repeated identical POST envelope returns HTTP 409 `replayed`, with the already accepted note ID and version. It never inserts another note. For temporary GET transport only, the same envelope returns HTTP 200 with the original receipt and `replayed:true`, because TinyFish may fetch an identical URL repeatedly during extraction and cannot expose the useful body of a 409. This behavior was observed and verified with actual `fetch_content`. Both paths prevent duplicate insertion. A different envelope reusing a nonce or version is rejected.

## Files

The gateway mints a two-minute upload-only ticket linked to the existing session **hash**, not the session cookie. Upload requires that the session still exists and is unlocked; each ticket admits only one request. The browser uploads directly to the V3 Edge Function to avoid Netlify's buffered request size limit. The backend bounds the body, checks bytes/structure rather than filename/MIME, encrypts data and filename independently with fresh IVs, and publishes the file only after storage completes.

Supported: PDF, JPEG, PNG, WEBP, HEIC, HEIF; maximum 20 MiB per file. The UI supports drop, multi-select, clipboard images, queue/progress, retry, Preview, Download, Delete and Delete all. Images and supported browser PDFs open in a modal; unsupported PDF viewers offer Open in browser. HEIC/HEIF decoding depends on browser support. Cards show source, received time and expiry. Files default to 24 hours, configurable from 60 seconds to seven days. Signed links last at most 60 seconds and never outlive the file. Every file fetch rechecks expiry/deletion and decrypts server-side.

## Updates and state

Supabase Realtime sends only an empty invalidation event over a high-entropy opaque topic disclosed after authentication. It contains no text, name, ID, version, timestamp, or patient metadata. It is an optimization, never an authorization or data channel. HTTP remains authoritative. Realtime failure triggers polling four seconds after each request; the header reports Live, Fallback, or Offline. A 15-second reconciliation also runs while Realtime is connected. Local countdowns hide expired content within one second even during an outage; scheduled cleanup physically removes storage afterward.

Only random copied note IDs (`relay-v3-copied`), theme (`relay-v3-theme`) and comfortable/compact view (`relay-v3-view`) are saved in localStorage. Session storage is unused. Locked/expired screens clear note/file DOM and memory, cancel requests, and disconnect Realtime. Reload restores notes from the server while the HttpOnly session is valid. Note cards reconcile by ID to preserve DOM identity during copy, reorder and arrivals.

## Bounded capacity

Notes: 64 KiB UTF-8 each, at most 500 active/pending notes and 512 KiB combined encrypted envelopes. The combined limit bounds worst-case escaped JSON below the gateway response limit. Files: at most 100 active/pending files, 400 MiB combined. Full inboxes return an explicit error; existing items are never overwritten to make room.
