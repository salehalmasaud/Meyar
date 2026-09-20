# V3 verification

Only synthetic data was used. Tests target the new V3 namespace and preview.

## Automated results

- 23 local unit tests: cryptographic round-trip, exact UTF-8/whitespace, malformed/tampered envelopes, freshness/protocol, file encryption, byte validation and size bounds, ordering/expiry/copy selection, patient preview, theme/view preferences, remaining count, expiry labels, minimal MCP schema, sender acknowledgement validation, lost-response retries and nonce receipt recovery.
- 22 live integration checks: [machine-readable report](../tests/live-results.json).
- 9 live OAuth/MCP/sender checks: [report](../tests/sender-live-results.json). These exercise real deployed endpoints, not ChatGPT model selection; actual ChatGPT acceptance is recorded separately.
- Real new Trackcare conversation: [acceptance evidence](CHATGPT_ACCEPTANCE.md), [metadata report](../tests/chatgpt-acceptance-results.json). Phrase-only sends A and B both appended, kept existing items and returned exactly the required Arabic acknowledgement, without a per-send prompt in the final run.
- Additional compatibility checks: [report](../tests/compatibility-results.json): concurrent duplicate requests insert once, GET re-fetch returns the same receipt, maximum 64 KiB note, and actual signed URL expiration after waiting its full lifetime.
- Full live desktop/mobile browser workflow: [report](../tests/browser-results.json), with screenshots in `v3/artifacts/`. This is one Playwright scenario containing the individual assertions listed below.
- Added live polish browser scenario: [report](../tests/polish-browser-results.json), covering compact/theme persistence, exact Copy next counts and focus, clear confirmation count, keyboard/input safety, file metadata, preview, screenshot paste, twenty-note performance and server session destruction on Lock.
- Added native Chrome PDF scenario using a real generated PDF. The built-in browser viewer rendered the document within Relay's modal; screenshot inspected. Browsers without PDF support receive the explicit fallback.
- Previous delivery's TinyFish encrypted GET evidence remains compatibility history. Normal ChatGPT sending now uses the authenticated MCP sender and POST, without TinyFish.
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

Additional checks: no browser exceptions, mobile/desktop horizontal overflow, decoded image thumbnails, no pairing/enrollment/save UI, HttpOnly/Secure/SameSite cookie, only anonymous note IDs and UI preferences in localStorage, empty sessionStorage, no public table/RPC privileges, private bucket, legacy RPC revocations, both cleanup schedules active, V1 production unchanged, V1/V2 function source hashes unchanged. This sender/polish update added no secrets and deployed only relay-v3 and the V3 preview alias.

## Measured observations

Current full regression: Realtime delivery approximately 3.6 seconds; fallback arrival approximately 7.0 seconds end-to-end (includes encrypted send, polling cadence and response). Polling is scheduled every four seconds after the prior HTTP request. The live test observed unattended physical cleanup after accelerated expiry; no manual cleanup invocation was needed. The polish report records twenty-note sort latency from its latest run.

The twelve-hour default is asserted from actual accepted records; accelerated synthetic expiry exercises hiding and physical cleanup. This run has not waited twelve wall-clock hours. Browser Clipboard API arguments are verified character-for-character. Windows and the destination hospital application can normalize line endings independently. The user confirmed the existing V3 receiver works on the real hospital workstation. Native phone app tool availability and the updated UI on that physical workstation have not been tested by this run.

## Rerunning

Run from `v3`: `npm test`, `npm run typecheck`, `npm run build`, `npx tsx scripts/live-tests.ts`, `npx tsx scripts/compatibility-tests.ts`, `npx tsx scripts/sender-live-tests.ts`, `npx playwright test`, `npx tsx scripts/check-release.ts`, `npx tsx scripts/check-secrets.ts`. Run live suites serially because push versions are globally monotonic. The native PDF scenario requires installed Chrome.

Browser scenarios now filter their view to explicitly owned synthetic IDs and delete only those IDs, so unrelated inbox items remain. Runtime/service credentials must be supplied privately outside Git. Test traces/videos are disabled; screenshots contain only synthetic fixtures. The separate historical `acceptance-preview.ts` script still requires an empty inbox and is not part of routine regression.
