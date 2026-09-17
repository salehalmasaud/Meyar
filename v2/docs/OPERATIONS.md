# Operations, deployment and rollback

## Current environment

| Item | Value |
|---|---|
| Git branch | `trackcare-relay-v2` |
| Existing production frontend | `https://trackcare-relay.netlify.app` |
| Production deploy to preserve | `6aaa498ed4d229964811995b` |
| V2 draft preview | `https://trackcare-relay-v2--trackcare-relay.netlify.app` |
| V2 Edge | `https://gvuuiazenabtsbmozrbk.supabase.co/functions/v1/relay-v2` |
| Supabase project | `gvuuiazenabtsbmozrbk` |
| V2 bucket | `relay-v2-private` (private) |
| Cleanup schedule | `relay-v2-expiry`, once per minute |

All preview secrets were generated independently and set as Supabase environment variables. Netlify receives only the gateway secret and nonsecret endpoint/origin settings, scoped to the individual draft deploy. No shared production Netlify variable was changed.

On the operator's Windows machine the provisioning script creates an ACL-restricted environment file outside OneDrive/Git: `%LOCALAPPDATA%\TrackcareRelay\v2\.env`. Private one-use browser setup links are generated into `setup-links.txt` in the same directory. Do not commit/copy either file into this repository. The `.env` is an operational secret file, not a patient-data backup. Move/rotate sender credentials through an approved secret manager before production.

## Environment variables

| Variable | Purpose / default | Location |
|---|---|---|
| `RELAY_VIEW_PIN` | Exactly `000`; convenience PIN only | Supabase |
| `RELAY_SESSION_SECRET` | Independent 32-byte base64url signing key | Supabase |
| `RELAY_PUSH_HMAC_SECRET` | Independent 32-byte base64url push authentication key | Supabase + protected sender |
| `RELAY_ENCRYPTION_SECRET` | Independent 32-byte base64url AES key | Supabase + protected sender |
| `RELAY_GATEWAY_SECRET` | Independent server-to-server login gateway key | Supabase + Netlify function |
| `RELAY_RATE_SECRET` | Independent IP pseudonymization key | Supabase |
| `RELAY_LINK_SECRET` | Independent file URL signing key | Supabase |
| `RELAY_ADMIN_SECRET` | Independent invitation administration key | Supabase + operator environment |
| `RELAY_CRON_SECRET` | Independent manual authenticated cleanup key | Supabase + operator environment |
| `RELAY_TEXT_TTL_SECONDS` | `1800` | Supabase |
| `RELAY_FILE_TTL_SECONDS` | `86400` | Supabase |
| `RELAY_SESSION_TTL_SECONDS` | `3600`, max 14400 | Supabase |
| `RELAY_DEVICE_TTL_SECONDS` | `2592000` | Supabase |
| `RELAY_SIGNED_URL_TTL_SECONDS` | `60`, max 120 | Supabase |
| `RELAY_REQUEST_WINDOW_SECONDS` | `120`, max 300 | Supabase |
| `RELAY_ALLOW_GET_PUSH` | `true` for compatibility testing; prefer false at cutover | Supabase |
| `RELAY_PREVIEW_ONLY` | `true`; preview banner | Supabase |
| `RELAY_ALLOWED_ORIGINS` | Exact comma-separated HTTPS origins | Supabase + Netlify function |
| `RELAY_EDGE_URL` | V2 Edge base URL | Netlify + protected sender/operator |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` | Built-in Edge environment | Supabase only |

No key is derived from the PIN. The anon/publishable connection key is intentionally public; service-role, crypto, gateway and administration secrets are never returned to the browser. TTL changes apply to newly accepted content/sessions, not retroactively to already-issued expirations.

## Repeatable preview deployment

Operator workflow (already carried out for this preview):

1. Inspect clean status/history and stay on `trackcare-relay-v2`. Preserve V1 root files and existing production deploy.
2. In `v2`, run `npm ci`, `npm run typecheck`, `npm test`, `npm run build`.
3. Apply only the reviewed new migrations to the specified project. Existing V1 migrations contain historical seed data and are intentionally not imported into this public repository. **Do not run an indiscriminate `db push`, `db reset`, migration repair or function prune against the shared project.** The migration history returned by Supabase is the source of truth for applied timestamps.
4. Provision environment values using `scripts/provision-secrets.ps1` only for first setup; it refuses implicit rotation. Use `supabase secrets set --project-ref gvuuiazenabtsbmozrbk --env-file <private-env-file>` without printing values.
5. From repository root: `supabase functions deploy relay-v2 --project-ref gvuuiazenabtsbmozrbk --use-api --no-verify-jwt`. Explicit custom authentication inside V2 replaces the Supabase JWT gateway on this function. Never omit the function name or add `--prune`.
6. In `v2`, run `scripts/deploy-preview.ps1`. It checks the branch and uses the known site ID and draft alias. It never uses `--prod` or changes site-wide secrets/configuration.
7. Run the synthetic live and browser tests described in TESTING.md; inspect security advisors and cleanup health.
8. Generate device invitations with `npx tsx scripts/invite.ts`. Deliver each private link only to the intended device. They expire after 24 hours and can be used once.

## Operational checks without patient data

`GET /health` returns only protocol/preview readiness. For cleanup, query `relay_v2_health` and ensure `cleanup_at` is within approximately two minutes. Check the most recent cron dispatch and HTTP response: cron success alone only proves dispatch, not deletion. Alert outside the app if sweeps stop; this delivery does not install an external notification service.

Safe SQL examples:

```sql
select cleanup_at, cleanup_ok from public.relay_v2_health;
select count(*) as overdue_objects from public.relay_v2_objects
where expires_at < now() - interval '2 minutes';
select p.proname, has_function_privilege('anon',p.oid,'EXECUTE') as anon,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public';
```

Do not inspect/log decrypted notes, filenames, payloads, signed URLs, query signatures, cookies or session tokens. The API returns generic error codes; no upstream error body is serialized. Investigate status, environment presence, permissions and cleanup metadata. If a deploy begins returning 503, check environment consistency and upstream service health without enabling request/response body capture.

## Production cutover checklist — explicit owner approval required

- [ ] Preview implementation, security review and automated checks pass.
- [ ] Owner runs scenarios A/B/C on the real phone and hospital PC, including restricted clipboard and blocked-WebSocket behavior. Current synthetic browser tests are not physical workstation acceptance.
- [ ] Configure the existing ChatGPT sender's protected environment for V2; verify “ارسلها للدوام” with a synthetic note. Do not put secrets in Project Instructions. Do not change the production sender yet.
- [ ] Owner approves service/privacy arrangements and the remaining limitations in SECURITY.md.
- [ ] Record explicit approval to cut over. Preserve production deploy `6aaa498ed4d229964811995b` and V1 sender configuration securely. Do not back up content.
- [ ] Generate fresh production-purpose V2 keys and update the sender/environment consistently. Keep the preview isolated from real data, ideally in a separate backend namespace/project. Do not leave testing scripts pointed at live patient content.
- [ ] Add `https://trackcare-relay.netlify.app` to exact allowed origins in the new production configuration. Re-enroll devices on this origin: HttpOnly `__Host-` cookies are intentionally origin-bound. Set the production preview flag false.
- [ ] Publish the reviewed V2 `v2/dist` and V2 Netlify function with production-scoped V2 environment. Update Netlify's build base to `v2` only in the approved cutover change; the existing root `netlify.toml` describes an older system and must not be accidentally rebuilt.
- [ ] Switch the ChatGPT sender to V2 at the agreed time; send a synthetic note and test both file directions. Disable GET if POST works in that sender.
- [ ] Observe cleanup and connection health; keep V1 rollback capability through a short agreed observation window.
- [ ] Execute the separate V1 cleanup checklist after owner approval, preserving the RPC revocation.

## Rollback

Before cutover, rollback means stop using the draft preview; production has not switched. Revert a defective V2 deploy to its previous draft and deploy the previous `relay-v2` code if needed. Keep the cleanup worker running until V2 objects are gone. Do not drop V2 schema/bucket while content or devices are active.

After an approved cutover, republish the exact preserved Netlify production deploy, restore the previous ChatGPT sender destination/credential configuration, and confirm a new synthetic V1 note on the workstation. Do **not** rebuild the older main branch as a substitute for the preserved deploy. Do not restore database backups or copy temporary patient content between systems. Leave the public `relay_set_note` execution revocation in place: V1 does not need it.

If retiring V2 entirely, expire and delete only V2 objects through Storage API, verify the bucket is empty, revoke V2 device/sender access, unschedule only `relay-v2-expiry`, then remove V2-only resources in a separately reviewed change. Do not disable shared extensions, global RLS, or shared Supabase services.
