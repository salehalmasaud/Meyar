# Trackcare Project Instructions

**Installed and tested on September 20, 2026.** This exact block is saved under `TRACKCARE RELAY V3 — SENDER` in the actual Trackcare Project Instructions. Existing clinical instructions were preserved; the obsolete Relay encryption/TinyFish paragraph was removed. No manual web connection step remains for this account. The app is [Trackcare Relay V3](https://chatgpt.com/plugins/plugin_asdk_app_6aaf9c4a1a488191ad3ee8a05b75df02). See [actual new-conversation acceptance](CHATGPT_ACCEPTANCE.md).

For recovery or another authorized account, connect the app first and then add the block below. Instructions alone do not install a tool.

```text
When I say "ارسلها للدوام", call the Trackcare Relay V3 app's send_note tool with exactly one argument:
{"note":"<the exact latest final Dietitian Note in this conversation>"}

Send the complete final note exactly as it was generated, preserving every character, space, indentation, blank line and line break. Do not rewrite, summarize, add a heading, add commentary, add Markdown fences, or add a timestamp. If the note is displayed inside a code block, send its contents without the Markdown fence. If no final note is clearly identifiable, ask which note to send.

Call send_note once per explicit send request. The tool appends to the V3 inbox and keeps all existing notes. Do not call any tool to edit, replace, delete or clear inbox items.

Only after send_note returns success:true with a note_id and version, reply with exactly:
تم الإرسال للدوام.

Do not add anything to that successful reply.

The sender service handles encryption, signing and transport. Never ask for, retrieve, calculate, display or transmit encryption keys, HMAC secrets, viewer secrets, gateway secrets or database credentials. Do not use TinyFish, browser automation, GitHub writes, deployments, a manual sender webpage, or V1/V2 as an alternative sending method.

If the tool is not available, say: "تكامل الإرسال إلى V3 غير متصل في هذه المحادثة."
If the tool fails or delivery is uncertain, say: "تعذر الإرسال؛ لم يتأكد وصول الملاحظة إلى Relay."
Never claim success without the tool receipt. Never make a fresh tool call simply to resolve an uncertain timeout; transport retries of the same request are handled by the sender without duplication.

Notes are read-only and expire independently 12 hours after receipt. Copying does not delete a note. The private receiver bookmark and PIN 000 belong to the viewer workflow and are never sender credentials.
```

## Private ChatGPT connection

- Name: **Trackcare Relay V3**
- Server URL: **https://trackcare-relay-v3--trackcare-relay.netlify.app/mcp**
- Transport: Streamable HTTP (JSON responses)
- Authentication: **OAuth**
- Client ID / Client secret: leave empty; dynamic registration is supported.
- Scope: **notes.write** (discovered automatically; enter only if the UI asks).
- Authorization / Token URL overrides: leave empty; metadata supplies them.
- Allowed callback: **https://chatgpt.com/connector_platform_oauth_redirect**
- Tool: **send_note**, a write action with only the required string parameter **note**.

Current web UI, inspected September 20, 2026:

1. In ChatGPT open **Plugins** (https://chatgpt.com/plugins), choose **Add → Create MCP App**. If that option is unavailable, enable Developer mode in **Settings → Security and login** first.
2. Enter the name and Server URL above; choose OAuth. Leave Advanced OAuth settings empty.
3. Review the trust notice, then Create. Complete the OAuth connection.
4. On the Relay consent page, first open the existing private receiver bookmark in another tab of the same browser and enter **000**. Return to the consent page and select **Allow sending notes**. It grants append-only access; no read/delete tool is exposed.
5. Add the instructions above to Trackcare. Start a **new** Trackcare conversation and enable/select the new app if it is not already available.
6. Generate **Test Note Sender A**, then say **ارسلها للدوام**. Verify the tool call, exact Arabic response and appended note. Repeat with **Test Note Sender B**. Both must coexist with existing items.

ChatGPT's write-action confirmations and app availability are controlled by ChatGPT. Do not mislabel this action as read-only to bypass them. Official documentation currently describes developer-mode access on the web and says new conversations may ask for confirmation again. The final web acceptance conversation sent both A and B automatically with no per-send prompt. Native phone availability still requires real device testing.

Sources: [Connect from ChatGPT](https://developers.openai.com/plugins/deploy/connect-chatgpt), [OAuth](https://developers.openai.com/plugins/build/auth), [Developer mode](https://developers.openai.com/api/docs/guides/developer-mode).
