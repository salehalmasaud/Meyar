# Trackcare Relay V2

A temporary bridge from ChatGPT/phone to the workstation. Built alongside the existing utility, with no production frontend cutover.

- Preview: https://trackcare-relay-v2--trackcare-relay.netlify.app
- Branch: `trackcare-relay-v2`
- Source: `v2/`; Edge entry point: `supabase/functions/relay-v2/index.ts`
- Production remains https://trackcare-relay.netlify.app

Use synthetic data in this preview. Pair each browser once with its private, single-use setup link, then enter **000** once per tab/browser session. The PIN is a convenience gate; the paired device credential is the actual access boundary. Sessions expire after one hour, pairing after 30 days. Lock revokes the current session; Unpair revokes that device and every session on it.

## Delivered

Read-only latest note, exact-format Copy, conditional Copy & Clear, confirmed Clear, encrypted temporary note envelopes, HMAC-authenticated POST and temporary encrypted GET, replay/version guards, private bidirectional uploads, byte-based file validation, upload queue/progress/retry, thumbnails, open/download/delete, delete-all, automatic expiry, Supabase Realtime invalidation and 4-second automatic polling fallback. All frontend scripts, CSS, fonts and icons are self-contained; only Netlify and Supabase are runtime hosts.

## Documentation

- [Architecture and current-system audit](docs/ARCHITECTURE.md)
- [Security review and limitations](docs/SECURITY.md)
- [Deployment, environment variables, rollback and cutover](docs/OPERATIONS.md)
- [Testing and physical-device acceptance](docs/TESTING.md)
- [Updated ChatGPT Project Instructions](docs/CHATGPT_PROJECT_INSTRUCTIONS.md)
- [V1 cleanup checklist](docs/V1_CLEANUP.md)

## Development

From this directory: `npm ci`, `npm run typecheck`, `npm test`, `npm run build`. The lockfile pins all packages. `npm run dev` uses Netlify Dev; use HTTPS for the secure device cookie. Live tests use the explicitly isolated V2 namespace and generated synthetic fixtures. They intentionally replace/expire V2 content, so never run them on a relay containing real data. They never call V1 write endpoints.

The original root build, frontend files and Netlify functions remain unchanged. Do not use the root's V1 build configuration to deploy V2.
