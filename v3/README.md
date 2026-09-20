# Trackcare Relay V3

A temporary clinical inbox. Every successful encrypted send appends one read-only note. Notes expire independently after 12 hours; files expire after 24 hours by default. No device pairing, invitations, editor, permanent history, or backup feature.

Preview: https://trackcare-relay-v3--trackcare-relay.netlify.app

Push: https://trackcare-relay-v3--trackcare-relay.netlify.app/push-note-v3

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

Live tests require the private V3 environment and a temporary service-role test credential outside Git. Use synthetic data only; do not run destructive acceptance tests against an inbox containing clinical work.

- [Architecture](docs/ARCHITECTURE.md)
- [Exact ChatGPT Project Instructions and sender contract](docs/CHATGPT_PROJECT_INSTRUCTIONS.md)
- [Security](docs/SECURITY.md)
- [Tests and evidence](docs/TESTING.md)
- [Provisioning, migration, rollback](docs/OPERATIONS.md)

V1 production and V2 preview remain independent. Nothing in this directory authorizes production cutover.
