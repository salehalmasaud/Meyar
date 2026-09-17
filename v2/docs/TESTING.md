# Validation and acceptance

All automated fixtures explicitly say SYNTHETIC / NOT A PATIENT. The tests are restricted to `relay-v2` and `relay_v2_*`; they do not send a note to V1 or read any existing V1 patient content.

## Automated checks

From `v2`:

```text
npm ci
npm run typecheck
npm test
npm run build
npx tsx scripts/live-tests.ts
npm run test:browser
npx tsx scripts/test-scheduler.ts
npx tsx scripts/check-secrets.ts
npm audit --omit=dev
```

Live/browser/scheduler tests require the ACL-restricted operator environment plus a temporary service credential file under `%LOCALAPPDATA%\TrackcareRelay\v2`. They replace/expire synthetic preview data; do not run against real content. Browser tests use separate desktop/mobile contexts and a real draft deployment. No tracing, video, HAR, patient screenshots or body logging is enabled. Remove temporary elevated test credentials after use.

| Required scenario | Coverage |
|---|---|
| 1. Valid encrypted note push | Web Crypto round-trip + deployed POST/GET |
| 2. Invalid signature | Unit + deployed 401 |
| 3. Wrong encryption payload | Unit + deployed 400 |
| 4. Expired request | Unit + deployed 401 |
| 5. Replay | Deployed 409 |
| 6. Duplicate/non-monotonic version | Deployed 409 + concurrent one-winner test |
| 7. Note expiration | API access denied at TTL; scheduled physical deletion |
| 8–10. Valid PIN, invalid PIN, limits | Deployed paired-device authentication and atomic throttling |
| 11. Session expiration | Signature/time unit test, deployed rejection, browser auto-lock |
| 12. File upload | Deployed PDF, browser image/PDF both directions |
| 13. Invalid file type | Bytes spoofing MIME/extension rejected |
| 14. Oversized file | Unit + actual >20 MiB upload |
| 15. File expiration | List/sign/open denial plus Storage deletion |
| 16. Signed file URL | Time bound, download, tamper and expired-signature rejection |
| 17. Copy/Clear | Exact API argument, real OS clipboard, blocked clipboard, CAS and UI |
| 18. Realtime fallback | Real subscription; blocked WebSocket; automatic polling |
| 19. Workstation reload | Paired cookie and sessionStorage restore without PIN re-entry |
| 20. Multiple devices | Separate browser sessions, notes and bidirectional files |

Additional checks: one-use invitation replay, public bucket denial, anonymous tables/RPC denial, key reuse refusal, request streaming limits, logout revocation, HTTP 204 RPC handling, and retention of metadata if Storage deletion fails.

Machine-readable evidence is in `tests/live-results.json`, `tests/browser-results.json`, and `tests/scheduler-results.json`. Unit suite: 19 tests. The live suite and browser result files report their actual run timestamps and measured times. Timings are environment measurements, not an SLA or a hospital-network claim.

The application passes the note string to `navigator.clipboard.writeText` unchanged, including spaces, tabs and line breaks. Windows' browser/OS clipboard serializes LF line endings as CRLF. Tests separately assert the exact original API argument and the native clipboard result. The application performs no normalization. Pasting into the hospital editor may have its own formatting behavior and needs physical acceptance.

## Exact owner acceptance on real devices

Only these device/account gates remain outside the automated environment. Use a synthetic note without patient data.

1. Open each device's private one-use setup link on the phone and hospital workstation. Enter `000`. On subsequent visits to that paired origin, only `000` is needed when the tab session has expired/closed.
2. **Scenario A:** keep the workstation preview open. In a separate preview-configured ChatGPT conversation, generate a synthetic final note with blank lines, indentation, Arabic and English. Say **ارسلها للدوام**. Confirm the sender reports acceptance, the note appears automatically, and Copy pastes every line/space into a safe local test field. No manual note transfer or page refresh.
3. Click Copy & Clear. Confirm both devices show “Waiting for next output…”. With clipboard access denied, repeat and confirm the note stays.
4. **Scenario B:** upload a small image and a valid PDF from the phone. Confirm the workstation lists them automatically; open and download. Verify the UI reports source/time/size. A copied signed URL should stop working after about a minute, and immediately if the file is deleted.
5. **Scenario C:** upload from the workstation; open/download on the phone. Test HEIC/HEIF from the actual phone library; previews for these depend on native browser decoding.
6. Reload the workstation page during its active session. It should remain open and refresh the current note/files. Lock it: content must disappear and the access code is required again.
7. If the hospital blocks WebSocket, verify **Fallback polling** and another automatic delivery within the polling cycle plus network latency. Disconnect/reconnect the workstation network and verify **Offline** then recovery without manual reload.
8. Observe the real configured 30-minute note and 24-hour file expiry before production acceptance, or have the operator use a separate short-TTL test environment. The preview's delivered defaults are 30 minutes / 24 hours; tests do not leave shortened TTL settings behind.
9. Confirm no actual patient contents remain, review the remaining security limitations, then give explicit production-cutover approval if satisfied.

Do not replace the working ChatGPT project's production settings to run these tests. A secure preview sender hookup must be demonstrated first; the provided Project Instructions alone do not create that capability.
