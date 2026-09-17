# V2 security review

## Controls

- Known PIN `000` is never a cryptographic secret. Access also requires a randomly generated paired-device credential. A one-use invite expires after 24 hours. Its token travels in a URL fragment, is removed immediately, and is redeemed via POST. Only its SHA-256 hash is in the database.
- Pairing credential: `__Host-` cookie, HttpOnly, Secure, SameSite=Strict, path `/`, 30-day expiry. The browser JavaScript never receives this credential or the gateway credential. Sessions are HMAC-signed, expire after one hour, and are checked against revocable server records on every authenticated request. Lock revokes the session; unpair cascades revocation.
- PIN failure throttling: five attempts per paired device per 15 minutes; 30 per trusted gateway-reported IP per 15 minutes. Pairing attempts are limited to ten per IP per 15 minutes. IPs are HMAC-pseudonymized, never logged or retained raw. Successful PIN clears the device counter. Limits are atomic in Postgres, not in process memory.
- Independent 256-bit random environment secrets for encryption, push HMAC, session signing, gateway authentication, rate-key pseudonymization, file links, invite administration and manual cleanup. Startup refuses missing, weak-size or reused secrets.
- AES-256-GCM, random 96-bit IV, authenticated protocol/version/timestamp/nonce metadata. HMAC-SHA256 covers the complete canonical envelope. ±120-second request freshness; strict safe-integer monotonic version; atomic nonce replay protection. Strict canonical base64url and envelope fields; 64 KiB UTF-8 note limit, bounded JSON and streaming request reads.
- RLS remains enabled. No V2 table or RPC is granted to anon/authenticated. V2 RPCs use SECURITY INVOKER and explicit service-role-only EXECUTE. The legacy `relay_set_note(text)` EXECUTE grants were revoked from PUBLIC/anon/authenticated, retaining service-role access.
- Server validation detects PDF/JPEG/PNG/WEBP/HEIC/HEIF by byte signatures and basic structural markers; browser MIME and filename extension are not trusted. HTML/SVG/executables are not accepted. Paths are generated server-side. Filename text is rendered with textContent.
- Signed file URLs last at most 60 seconds, bounded by the file expiry; signed fields cannot be altered. The file-serving endpoint rechecks live metadata, uses no-store/nosniff and a sandbox CSP, and provides a safe Content-Disposition filename.
- All app HTML/API/file responses use no-store. Strict CSP, frame protection, no external runtime CDN/font, no service worker, no analytics, no patient localStorage/sessionStorage, no response/error-body logging.
- Fixed public `/sweep`: accepts no parameters and returns no data. It can only delete already-expired V2 objects and auth metadata, at most twice per minute. This allows pg_cron scheduling without putting secrets in SQL, URLs or Vault. Authenticated `/cleanup` is available for operational testing. Neither endpoint can delete live data or V1 data.

## Verification

The Supabase advisors were run before and after changes. The two SECURITY DEFINER warnings on the legacy RPC were removed. Remaining `rls_enabled_no_policy` entries are informational: these tables intentionally deny browser roles; the service-role Edge layer is their only supported caller. Explicit catalog checks confirm anon/authenticated cannot execute **any** public function in this project after the repair.

Live tests verify invalid signature/encryption/timestamp rejection, replay/duplicate/older versions, concurrent acceptance, CAS Clear, session revocation/expiry, PIN limits, anonymous RPC/table denial, bucket privacy, content-type spoofing, oversized uploads, signed-link tampering, logical expiry and physical deletion.

## Material limitations / cutover gates

1. Preview and V1 share one Supabase infrastructure/security boundary. Isolation is by names and fixed routes. Use a separately approved project if infrastructure isolation is required.
2. V1's hardcoded/reused credential, plaintext storage and older public-GitHub encrypted artifact still exist to preserve the current workflow. Do not use their keys for V2. Rotate/retire them during approved cutover; the already-revoked bypass must remain revoked.
3. GET push is temporary and limited to about 7 KB total query. Only ciphertext is sent, but provider request logs/browser history may retain encrypted URLs and authentication signatures. Application code never logs them. **An application cannot promise deletion/redaction of independently managed Netlify/Supabase/OpenAI access logs.** Prefer POST and set `RELAY_ALLOW_GET_PUSH=false` after sender compatibility is proven. Short-lived file bearer URLs have the same access-log caveat. Tokens expire; do not copy them into analytics or tickets.
4. Storage object bytes are outside Supabase database backups; object *metadata* and auth/version metadata can still appear in managed database backups. No plaintext note/filename is placed there. Underlying cloud deletion/retention guarantees must be checked against the hospital's approved service arrangements; application deletion does not erase provider-held historical copies or prior V1 Git history.
5. Type/structure validation is not antivirus or deep PDF sanitization. A valid PDF can contain active content; downloaded files rely on the hospital's viewer/endpoint protections. Browser opening is sandboxed, but downloading deliberately transfers the file to the user. HEIC thumbnails depend on browser support; the UI falls back to a type tile and supports open/download.
6. Files already downloaded and notes already copied to the OS clipboard cannot be remotely erased. The app never clears the user's system clipboard automatically.
7. Expired content becomes inaccessible at its exact TTL. Physical Storage deletion normally occurs within the next one-minute sweep; provider outages can delay it. `relay_v2_health.cleanup_at` must remain fresh. Tests check scheduler HTTP status as well as cron dispatch status.
8. The hospital firewall, clipboard policy, real phone browser and actual ChatGPT sender are owner/device acceptance gates. Passing headless Chromium and API tests does not prove those environments.
9. A paired browser left open is trusted until locked/session expiry. The 000 PIN provides no meaningful protection against a person who already controls a paired workstation. Use Lock, Unpair and the workstation's OS lock appropriately.

References: [Supabase database backups](https://supabase.com/docs/guides/platform/backups), [Supabase security linter](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [Supabase Broadcast](https://supabase.com/docs/guides/realtime/broadcast).
