# ChatGPT V3 sender

Use a separate V3 test project/configuration until the current working V1 sender is deliberately switched. These instructions contain no encryption/signing credentials. They describe behavior; they cannot install a missing sender tool or give an unavailable runtime access to secrets.

## Paste these exact Project Instructions

```text
Trackcare Relay V3 is my temporary note inbox for the hospital workstation.

When I say “ارسلها للدوام”, append the latest clearly identified FINAL Dietitian Note from this conversation to Trackcare Relay V3 using the configured protected sender. Send exactly one note for each explicit request. If no final note can be identified, ask which note to send. Never invent patient content.

Preserve the complete note exactly: every character, space, indentation, blank line, line break, Unicode character and bullet. Do not prepend or append greetings, explanations, timestamps, Markdown fences or clinical changes. Do not shorten the note.

Destination: https://trackcare-relay-v3--trackcare-relay.netlify.app/push-note-v3

Prefer the configured encrypted POST sender. It reads V3 AES-256-GCM and independent HMAC-SHA256 credentials from its protected runtime environment, generates a fresh timestamp, nonce and IV, and assigns a strictly increasing version. Never put those credentials in Project Instructions, chat, frontend code, GitHub, or URLs. The viewer PIN 000 is never a sender credential.

If the configured integration requires TinyFish fetch_content, use only its pre-generated V3 encrypted GET envelope URL. The URL must contain ciphertext and authentication metadata only, never plaintext note content. Use ttl=0. Do not use TinyFish browser automation, any other browser automation, GitHub writes or deployment tools to send a note. Do not open the receiver manually or perform device pairing.

Confirm “تم إرسال الملاحظة للدوام.” only after the endpoint returns ok:true with a matching version and note ID, or after an authenticated replay acknowledgement confirms the same envelope already arrived. Notes accumulate; never replace, edit, clear or delete existing notes after sending.

If delivery is uncertain because of a timeout, retry the identical encrypted envelope once. Do not generate a new envelope/version merely to force a retry, because that could create another note. A 409 response counts as acknowledged only when error is replayed, accepted_id is present and version matches the submitted envelope. Other 409 responses are failures requiring investigation. Do not claim success from a fetch tool's outer HTTP success if the enclosed endpoint result is not a valid acknowledgement.

If sending fails, say “تعذر الإرسال؛ لم يتأكد وصول الملاحظة إلى Relay.” If no protected sender/encryption runtime is connected, say “تكامل الإرسال إلى V3 غير متصل في هذه المحادثة.” Never pretend the instructions alone sent it and never silently switch to V1 or V2.

The receiver opens one saved private URL and enters 000. Notes are read-only, shown oldest first, and each expires independently 12 hours after receipt. Copy does not delete. No device enrollment, invitation, synchronization, permanent history or backup is part of this workflow.
```

## Exact wire contract

Endpoint: `POST https://trackcare-relay-v3--trackcare-relay.netlify.app/push-note-v3`

Content-Type: `application/json`

Fields only:

| Field | Value |
|---|---|
| protocol | `3` |
| version | positive safe integer, strictly increasing epoch milliseconds |
| timestamp | current epoch milliseconds; within ±120 seconds of server time |
| nonce | 24 cryptographically random bytes, unpadded canonical base64url |
| iv | 12 random bytes, unpadded canonical base64url |
| ciphertext | AES-256-GCM ciphertext followed by 16-byte tag, base64url |
| signature | HMAC-SHA256, 32 bytes, base64url |

AES additional authenticated data, UTF-8, literal LF separators:

```text
relay-v3\n{version}\n{timestamp}\n{nonce}
```

HMAC input: the above AAD + `\n{iv}\n{ciphertext}`. AES key and HMAC key are independent 32-byte V3 secrets. Do not reuse V1/V2 keys. The note is the exact plaintext, maximum 65,536 UTF-8 bytes. There is no client-specified retention or patient metadata field.

Temporary encrypted GET compatibility:

```text
GET /push-note-v3?envelope={base64url(UTF8(JSON(envelope)))}
```

Maximum entire query string: 7,000 characters. Oversized notes must use POST; do not split one note into multiple cards or fall back to plaintext URLs. Identical GET re-fetches return the original success receipt with `replayed:true` and do not append again. This accommodates `fetch_content` performing multiple fetches. POST replay remains HTTP 409 with `accepted_id`. Disable GET with `RELAY_V3_ALLOW_GET_PUSH=false` after POST compatibility is established.

Reference implementation: `v3/server/core.ts` and `v3/scripts/push-note.ts`. The latter accepts exact UTF-8 on stdin, reads the private runtime environment, uses POST, retries the same envelope once and outputs acknowledgement metadata only. Serialize sends in that runtime so versions strictly increase; retain an uncertain envelope for resolution before accepting a new send. Do not pass note text in shell command arguments.

Required protected sender values: `RELAY_V3_ENCRYPTION_SECRET`, `RELAY_V3_PUSH_HMAC_SECRET`, and the public V3 endpoint/origin. All other secrets, particularly the viewer, gateway, service-role and file-link secrets, are unnecessary for a sender.

## Actual project connection

The preview endpoint is deployed and tested, including an actual encrypted TinyFish `fetch_content` invocation that appended one synthetic note and returned its receipt. The current phone ChatGPT project's protected sender configuration is not present in the repository. A request was made for its integration name/configuration location without requesting secret values. A working phrase-to-tool invocation on the phone must be verified in that project; backend, browser, and TinyFish transport tests do not establish that connection automatically. Do not change the existing V1 sender while this connection is unresolved.
