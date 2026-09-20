# V3 security

- A cryptographically random 256-bit private fragment grants viewer access. It is exchanged over HTTPS using a same-origin POST and removed from the address bar immediately on successful exchange. Fragment data is never sent to Netlify as a URL component. No third-party frontend resources run on the page.
- The fixed `000` PIN is a convenience gate, not the root secret. Failed PINs are throttled per session (5/15 minutes) and per HMAC-obscured source IP (30/15 minutes). Exchanges are bounded per source IP. PIN-only requests without the high-entropy viewer exchange fail.
- Eight-hour absolute HttpOnly/Secure/SameSite=Strict session. The database stores only its hash. Same-origin checks prevent cross-site cookie API mutations. Lock revokes the server unlock state. Upload tickets carry only a session hash, not the cookie, are signed with a separate key, expire after two minutes, admit one request, and still require an active unlocked session.
- Separate random V3 secrets for viewer access, AES encryption, push HMAC, gateway, IP rate-key hashing, file URLs/invalidation topic, and upload tickets. Key equality and size are checked at startup. Server credentials are never bundled into the frontend or stored in Git.
- AES-256-GCM protects note text, file bytes, and filenames at rest. HMAC-SHA256 authenticates the complete push envelope. Freshness checks, transaction serialization, nonce uniqueness and persistent monotonically increasing version prevent replay and duplicate insertion.
- All six V3 tables have RLS, zero public/anon/authenticated table grants, and zero anonymous/authenticated RPC execute privileges. V3 functions use SECURITY INVOKER and an empty search_path. Private Storage has no public read policy. Service-role credentials remain server-only.
- Legacy `relay_set_note(text)` PUBLIC/anon/authenticated EXECUTE remains revoked. No V1/V2 grants, content or functions were changed.
- Strict streaming request-size checks, byte-based file type checks, filename sanitization, allowed-ID validation, fixed API routes, bounds on retention, total inbox capacities, and no user-supplied storage paths or query fragments.
- Signed file URLs expire after at most 60 seconds and at file expiry, and every download checks current file existence. Signed URLs are capabilities: anyone holding one can access that file until expiry. Copy link is explicit.
- CSP, no-store, no-referrer, anti-framing, nosniff and robots exclusions. No plaintext application logging; caught exceptions are converted to fixed error codes. UI uses textContent, never note HTML.
- Realtime carries an empty invalidation hint only. Its opaque public topic is not a channel for patient content and never authorizes data access. All actual reads still require the cookie-backed gateway.
- Cleanup filters expired content immediately and removes encrypted Storage objects on the minute scheduler. There is no application backup or history feature. Provider infrastructure/log retention is separate from this application; it is not claimed to be zero. Encrypted GET ciphertext URLs can appear in upstream access logs, so POST is preferred.

## Advisor result

Supabase security advisors after V3 migration reported no WARN or ERROR findings. INFO `rls_enabled_no_policy` includes six V3 tables and existing V1/V2 tables. This is intentional deny-by-default behavior for a server-only schema; adding broad policies to silence it would weaken the boundary. [Supabase advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

Read-only live SQL independently confirmed all six V3 RLS flags, zero public grants/RPC execution, private bucket, active V3 scheduler, and the legacy RPC revocations.
