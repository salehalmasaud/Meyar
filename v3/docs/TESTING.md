# V3 verification

Only synthetic data was used. Tests target the new V3 namespace and preview.

## Automated results

- 11 local unit tests: cryptographic round-trip, exact UTF-8/whitespace, malformed/tampered envelopes, freshness/protocol, file encryption, byte validation and size bounds, stream limits, ordering, independent expiry and copy selection, client-derived metadata.
- 22 live integration checks: [machine-readable report](../tests/live-results.json).
- Additional compatibility checks: [report](../tests/compatibility-results.json): concurrent duplicate requests insert once, GET re-fetch returns the same receipt, maximum 64 KiB note, and actual signed URL expiration after waiting its full lifetime.
- Full live desktop/mobile browser workflow: [report](../tests/browser-results.json), with screenshots in `v3/artifacts/`. This is one Playwright scenario containing the individual assertions listed below.
- Actual TinyFish `fetch_content` with `ttl=0`: encrypted GET accepted one synthetic note; repeated underlying fetch returned its original acknowledgement with `replayed:true` and no second note. This tests TinyFish transport, not the user's phone project configuration.
- TypeScript typecheck/build and `npm audit --omit=dev` passed; dependency audit reported zero vulnerabilities.

## Requested acceptance coverage

| # | Requirement | Evidence |
|---|---|---|
| 1 | Append first note | Live POST and browser A |
| 2 | Append multiple notes | A/B/C simultaneously present |
| 3 | Ordering | DB sequence; oldest/newest browser toggle |
| 4 | Independent 12-hour expiry | Each database deadline equals receipt + 43,200,000 ms; distinct receipts have distinct deadlines |
| 5 | Expired cleanup | Expired note hidden; unattended minute scheduler physically deletes Storage object |
| 6 | Replay rejection | POST 409; simultaneous requests insert once; GET re-fetch returns only existing receipt |
| 7 | Duplicate version | Live 409 rejection |
| 8 | Invalid signature | Live 401 rejection |
| 9 | Invalid ciphertext | Invalid AES-GCM payload with valid HMAC rejected |
| 10 | Viewer secret exchange | Invalid secret rejected; valid secret creates secure cookie; fragment removed |
| 11 | PIN 000 login | Desktop/mobile and backend |
| 12 | Wrong PIN throttling | Five wrong attempts; subsequent correct attempt receives 429 |
| 13 | Session expiry | Server-expired session rejected; receiver returns to locked screen |
| 14 | Copy | Exact original string passed to Clipboard API; failure keeps note |
| 15 | Copy next | Oldest un-copied selected even while newest-first; next card receives focus |
| 16 | Copied-state behavior | Completed style and label; refresh retains ID state and notes; only random IDs in storage |
| 17 | Clear copied | Confirmation and cancellation; only copied notes removed |
| 18 | Clear all | Confirmation; snapshot IDs protect later arrivals; empty state |
| 19 | Realtime arrival | Supabase subscription Live; note arrives automatically |
| 20 | Polling fallback | WebSocket forcibly closed; automatic arrival; Offline/recovery |
| 21 | File upload | Real PNG/PDF; multiple selection; private encrypted storage; Open/Download; failed upload Retry |
| 22 | Paste image upload | Image written to browser/OS clipboard, actual Control+V keypress, upload and inline feedback |
| 23 | Invalid file type | HTML spoofed as PNG/MIME rejected by server |
| 24 | >20 MB file | 20 MiB accepted; 20 MiB + 1 rejected by server |
| 25 | Signed URL expiry | Expired/tampered capability checks; actual issued link stops working at deadline |
| 26 | File cleanup | Unattended physical Storage deletion after synthetic expiry |

Additional checks: no browser exceptions, mobile/desktop horizontal overflow, decoded image thumbnails, no pairing/enrollment/save UI, HttpOnly/Secure/SameSite cookie, no session or patient data in local/session storage, no public table/RPC privileges, private bucket, legacy RPC revocations, cleanup schedule active, V1 production unchanged, V1/V2 function source hashes unchanged. Supabase revision counters advanced after adding V3 project secrets, without changing their source or existing secret values.

## Measured observations

Initial complete live run: Realtime delivery approximately 4.2 seconds; fallback arrival approximately 6.5 seconds end-to-end (includes encrypted send, polling cadence and response). Polling is scheduled every four seconds after the prior HTTP request. Unattended note/file deletion occurred approximately 50.8 seconds after synthetic expiry.

The twelve-hour default is asserted from actual accepted records; accelerated synthetic expiry exercises hiding and physical cleanup. This run has not waited twelve wall-clock hours. Browser Clipboard API arguments are verified character-for-character. Windows and the destination hospital application can normalize line endings independently. Physical phone/project invocation and hospital-network/paste acceptance remain owner-side checks.

## Rerunning

Run from `v3`: `npm test`, `npm run typecheck`, `npm run build`, `npx tsx scripts/live-tests.ts`, `npx tsx scripts/compatibility-tests.ts`, `npx playwright test`.

Use a dedicated empty V3 test inbox. The browser scenario clears all visible notes/files as part of acceptance. Never run it against clinical content. Runtime/service credentials must be supplied privately outside Git. Test traces/videos are disabled; screenshots contain only explicitly synthetic fixtures.
