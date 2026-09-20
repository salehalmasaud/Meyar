# Trackcare Relay V3

A temporary clinical inbox. Every successful encrypted send appends one read-only note. Notes expire independently after 12 hours; files expire after 24 hours by default. No device pairing, invitations, editor, permanent history, or backup feature.

Preview: https://trackcare-relay-v3--trackcare-relay.netlify.app

Push: https://trackcare-relay-v3--trackcare-relay.netlify.app/push-note-v3

ChatGPT app: **Trackcare Relay V3**, connected using OAuth at `https://trackcare-relay-v3--trackcare-relay.netlify.app/mcp`. Its only action is `send_note({note})`. Encryption, signing and transport happen server-side. The Trackcare project instructions are already configured for `ارسلها للدوام`; see the acceptance report for actual conversation evidence and platform/device limits.

The current UI includes content-sized cards, Copy next counts, Compact view, System/Light/Dark themes, keyboard shortcuts, clipboard image uploads and image/PDF preview. Only anonymous copied-note IDs and UI preferences persist in browser storage.

The **one stable private receiver URL** is provisioned in `%LOCALAPPDATA%\TrackcareRelay\v3\receiver-url.txt`. Open that exact URL, enter `000`, and bookmark the original private URL. Successful exchange removes its fragment from the current address bar; copying the cleaned address does not copy private access. The URL never changes on redeploy and is not specific to a device.

```powershell
cd C:\trackcare-relay-v3\v3
npm ci
npm run typecheck
npm test
npm run build
npx tsx scripts/live-tests.ts
npx playwright test
```

Live tests require the private V3 environment and a temporary service-role test credential outside Git. Automated browser scenarios scope inbox responses and destructive actions to their own synthetic IDs. The older `acceptance-preview.ts` fixture script still requires an empty test inbox; do not use it against clinical work.

- [Architecture](docs/ARCHITECTURE.md)
- [Protected sender architecture](docs/SENDER_ARCHITECTURE.md)
- [Exact ChatGPT Project Instructions and sender contract](docs/CHATGPT_PROJECT_INSTRUCTIONS.md)
- [Security](docs/SECURITY.md)
- [Tests and evidence](docs/TESTING.md)
- [Provisioning, migration, rollback](docs/OPERATIONS.md)

V1 production and V2 preview remain independent. Nothing in this directory authorizes production cutover.
