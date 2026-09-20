# V3 protected sender

This is an additive tool-only MCP adapter to the existing V3 inbox, not a replacement protocol or a new product version.

ChatGPT send_note({note}) → HTTPS /mcp → OAuth authentication → server-side version lease → existing AES-256-GCM + independent HMAC-SHA256 envelope → POST /push-note-v3 → validated receipt.

The Netlify connector function only forwards requests to the existing relay-v3 Edge Function and authenticates that forwarding with its protected gateway environment variable. Encryption and signing happen inside relay-v3 using the existing protected V3 secrets. ChatGPT receives no backend credentials. Model-visible output contains only success, note_id and version.

## Authentication

OAuth authorization-code flow with S256 PKCE, exact ChatGPT callback allowlist, issuer identification and audience binding. Authorization requires an already unlocked private viewer session plus explicit consent. Codes expire after two minutes and are consumed atomically. Access tokens expire after one hour. Refresh tokens rotate once and expire after 30 days unused. Codes/tokens are random 256-bit values stored only as SHA-256 hashes. Tokens are never accepted in query strings. Revocation removes the grant's tokens. Registration and token endpoints are rate limited behind the trusted gateway; no plaintext application logging exists.

Scope is fixed to notes.write. The tool can append notes only. It cannot retrieve inbox content, change retention, delete items, upload files, or access the viewer session. No OpenAI API key or model API deployment is needed.

## Ordering and retry

A transactional database lease serializes sender version allocation and delivery across Edge instances. Versions exceed the existing accepted V3 version, the prior sender version and the current millisecond clock. The caller's MCP session and JSON-RPC request ID define the idempotency key, HMAC-protected in the database and bound to the OAuth grant and a keyed content digest.

The encrypted envelope is persisted in private Storage before sending. On transient transport failure the exact same envelope is retried once. A replay receipt is accepted only for matching version and a valid returned UUID. A lost response can also be resolved through the existing nonce receipt. Successful receipts live for at most 12 hours; ciphertext outbox objects are marked for immediate existing scheduled cleanup. Unfinished outbox objects expire after ten minutes. The sender never puts patient plaintext or patient preview metadata into Postgres.

Repeating the same MCP request returns its original receipt. A genuinely new tool call intentionally appends another note, even if its text is identical. This is necessary because the note-only schema cannot distinguish an intentional repeat from a model-generated replacement call. After an uncertain response the model must not invent a fresh call. The global lease is bounded at 90 seconds; overload returns a retryable busy error rather than allowing out-of-order writes.

## Isolation

The migration adds five V3-only tables with RLS, service-role-only grants, scoped RPCs and one expiry cron. Existing V1/V2 resources, V3 note schema, encryption wire format, private receiver secret and retention are preserved. Existing relay_set_note EXECUTE remains revoked for public/anon/authenticated.

Lock now atomically deletes the current unlocked session and creates a replacement locked session with the same remaining lifetime. Only PIN 000 is needed to unlock again; the stable bookmark is unchanged.
