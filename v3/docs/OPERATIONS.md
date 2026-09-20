# Provisioning, migration and rollback

## Provisioning completed

- Branch: `trackcare-relay-v3`; isolated checkout: `C:\trackcare-relay-v3`.
- Preview only: `https://trackcare-relay-v3--trackcare-relay.netlify.app`.
- One stable receiver URL: `%LOCALAPPDATA%\TrackcareRelay\v3\receiver-url.txt`. This is a private receiver bookmark, not a device invitation. Copy/bookmark the exact URL from that file, including its `#access=` fragment. Open it and enter `000`.
- One public transport endpoint: `https://trackcare-relay-v3--trackcare-relay.netlify.app/push-note-v3`, authenticated by the encrypted envelope. The user never opens this manually.
- Independent backend: `relay-v3`, `relay_v3_*`, `relay-v3-private`, `relay-v3-expiry-sweep`.
- V3 private environment outside Git: `%LOCALAPPDATA%\TrackcareRelay\v3\.env`. Windows ACL restricts this directory to the owner and SYSTEM. No encryption/signing keys belong in Project Instructions.

`scripts/provision-secrets.ps1` refuses to rotate an existing secret file. Run only once. `scripts/deploy-preview.ps1` requires the exact V3 branch and always deploys to the V3 alias without `--prod`; it injects only the gateway secret and public routing configuration into that specific deploy. It does not edit site-wide V1/V2 environment variables.

Supabase secrets use only `RELAY_V3_*` names. Deploy only `relay-v3` with `--use-api --no-verify-jwt`; do not deploy all functions or use `--prune`. Disabling platform JWT verification is intentional: sensitive routes implement custom authentication before access.

## Configuration

- Notes: fixed twelve-hour TTL in the append transaction.
- Files: `RELAY_V3_FILE_TTL_SECONDS=86400`; changing it affects new uploads only, with a 60–604800 second supported range.
- Viewer session: `RELAY_V3_SESSION_TTL_SECONDS=28800`; bounded to at most twelve hours.
- Encrypted GET compatibility: `RELAY_V3_ALLOW_GET_PUSH=true`; turn off after protected POST sending works in the actual ChatGPT project.
- File signed links: 60 seconds maximum.

## Migration plan

1. Keep V1 production and V2 preview running as they are. There is no automatic data migration or copy of old clinical content.
2. Review V3 with synthetic A/B/C notes and files. Test the exact saved URL and clipboard behavior on the hospital workstation/network.
3. Configure a separate protected V3 sender with only its V3 encryption and HMAC secrets, then paste the V3 Project Instructions into the separate test project.
4. Say `ارسلها للدوام` on the actual phone and confirm one note is appended. Repeat for A/B/C and process them on the hospital workstation.
5. Only after explicit owner cutover approval, change the production workflow's sender/bookmark. No production URL changes, replacement deploys, deletions or legacy cleanup are part of this preview delivery.

## Rollback plan

Preview rollback needs no database restore and does not touch clinical V1/V2 data. Stop using the V3 bookmark and V3 sender, and continue the existing V1 workflow. V1 remains on Netlify deployment `6aaa498ed4d229964811995b`; do not rebuild V1 from repository root as a substitute for that known deployment. V2 remains at its existing preview alias and with the same function source hash. Supabase increased existing function revision counters when the additive V3 project secrets were installed; their source hashes and source update timestamps remained identical. No V1/V2 secret values or source were changed.

For a V3-only code regression, redeploy the prior verified V3 commit to the V3 alias. Keep existing V3 secrets so the stable receiver bookmark continues working. Additive schema objects need not be dropped.

For suspected V3 viewer-link disclosure, rotate only the V3 viewer secret, revoke all V3 session rows, and distribute the new private receiver bookmark. That is an exceptional security rotation, not enrollment. Sender key rotation is separate. Never rotate V1/V2 keys as part of V3 recovery.

If V3 is abandoned, allow existing content to expire while the scheduler remains active. Verify zero V3 note/file Storage objects before removing V3-only infrastructure. Do not disable cleanup while temporary content remains. Do not drop tables/buckets or delete any V1/V2 resources without separate authorization.

## Evidence boundaries

Automated live tests can demonstrate deployed endpoint behavior, browser rendering and clipboard arguments, scheduled cleanup and security isolation. They cannot demonstrate the user's physical phone tool invocation, hospital proxy/firewall, or paste into the hospital system. The default twelve-hour deadlines are checked in database rows and independent expiry is tested with shortened synthetic deadlines; this run does not claim to have waited twelve real hours.
