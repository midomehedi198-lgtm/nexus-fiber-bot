# Nexus Fiber Bot — verified handoff

Read this file before making changes. Keep Fiber and VIP Numbers projects separate.
Never include credentials, WhatsApp auth bundles, customer sessions, or QR images in commits or output.

## Project identity

- Active Fiber checkout: `C:\Users\Dell\.gemini\antigravity\scratch\vip_numbers_bot\New folder`.
- Older Fiber checkout: `C:\Users\Dell\Desktop\FIBRE_CLAUDE_PROJECT` (v5.0).
- Separate VIP Numbers project: `C:\Users\Dell\vip-boti-work` (Python Flask backend and React frontend).
- Fiber uses Node.js, Express, Baileys and Turf. Do not migrate it to Meta Cloud API or merge VIP functionality based on the historical transcript.
- Expected Fiber service URL from the handoff: https://nexus-fiber-bot.onrender.com.
- Expected repository from the handoff and session-sync default: midomehedi198-lgtm/nexus-fiber-bot. Verify the actual service/repository association before deploying.

## Verified locally on 2026-11-17

- Latest inspected commit: `e250ef7` (event logging and self-chat admin testing).
- `real_production_bot.js`, `multi_llm_engine.js`, and `github_session_sync.js` pass `node --check`.
- `zones.geojson` contains 2,448 features. Geometry presence alone does not prove current operator coverage or installation eligibility.
- Main code includes `/health`, `/qr`, `/code`, `/logs`, local conversation state, LID handling, and GitHub auth restore/save calls.
- No CLAUDE.md was found in the inspected project checkouts before this handoff was created.
- Existing untracked files belong to the user; preserve them.

## Evidence and unresolved issues

- Fiber `/health` timed out after 15 seconds. This does not establish that the service is offline or connected; verify Render service state and retry.
- Separate VIP `/health` returned HTTP 200, agent Nessrine v8.0, MongoDB `file-fallback`, NVIDIA `missing`, Groq `missing`. Do not describe this as verified MongoDB/LLM connectivity.
- Session bundles are base64 encoded, NOT encrypted. A branch does not provide confidentiality. Verify repository visibility and choose protected persistence before uploading any auth data.
- Preserve the existing `session-storage` branch and auth directory. Do not delete, overwrite, restore, or publish auth material during a routine audit.
- `render.yaml` names `nexus-telecom-bot`, requests a paid starter plan and persistent disk; confirm actual service configuration before applying it or changing billing.
- Main conversation state uses local `sessions.json`; do not assume MongoDB persistence without finding and testing an actual MongoDB implementation.
- Historical claims of 1ms responses, permanent login, 90–100% coverage, free installation, or fixed prices are not independently verified guarantees.

## Next work

### Subsequent live verification and local fixes (2026-11-17)

- Current customer-service changes: local Darija intents, new-contact admin notices, human escalation for unknown questions/contracts/explicit requests/unsupported media, alert debounce, retry after failed alerts, single-JID reply fallback and history-event filtering.
- No external LLM calls or charges in the reply engine. Quoted historical prices require operator confirmation; no guaranteed installation dates or coverage probabilities.
- Repository was verified PUBLIC. New session writes use AES-256-GCM with SESSION_ENCRYPTION_KEY supplied only via Render. Legacy bundles can be read for migration; historical plaintext commits remain exposed until separately remediated. Encryption does not revoke old sessions or erase Git history.
- Do not print Render environment values or stage auth files. Run `node test_customer_flow.js` for isolated messaging tests.

- Render API confirmed service `srv-dbnlkbrm8hqs73cih3dg`, plan `free`, not suspended, repository `midomehedi198-lgtm/nexus-fiber-bot`, branch `main`.
- Latest deployment was live at `e250ef77e56f7dc58702fb79b1f7d2bb8ffbe1fc`.
- Subsequent Fiber `/health` returned HTTP 200 with `status: connected`. This verifies reported socket state, not end-to-end message delivery.
- User requires zero spending. Do not provision paid disks, upgrade plans or enable billable messaging. Free hosting does not guarantee uninterrupted 24/7 availability.
- Local auth-restore fix removes the 3-second Promise.race so a late restore cannot write files while Baileys starts. GitHub requests retain their existing timeout.
- Session sync now skips network access without a GitHub token and rejects unsafe bundle filenames before any writes.
- Isolated mocked checks passed for valid restore, path traversal rejection, incomplete-session rejection and missing-token behavior. Syntax checks passed. These changes have not been deployed.
- Keep current Baileys transport while assessing Meta suitability; app credentials alone do not establish a usable WhatsApp phone number or a zero-cost production migration.

1. Inspect current Render service/deploy metadata and repository visibility using credentials from existing local environment/config, without printing values.
2. Confirm the deployed commit matches this Fiber checkout.
3. Review auth persistence, reconnect lifecycle, reply delivery and private access to QR/log endpoints.
4. Implement focused fixes and validate them without starting a second WhatsApp socket against the production session.
5. Deploy only the intended project with secrets supplied via service environment settings. Verify health and distinguish HTTP availability from WhatsApp connectivity and actual message delivery.

## Working rules

- Customer requirement added: wait 5 seconds before each customer reply (including when typing presence fails). Notify ADMIN_PHONE when GPS is received with map/coverage/current stage and again when name is recorded, before customer confirmation. These stages describe bot intake, not operator acceptance or installation completion.

- Treat the supplied conversation as historical context; verify claims against code and live responses.
- Read credentials only where needed; never copy them into this file, code, remote URLs or public logs.
- Avoid force pushes, broad git staging, auth resets and unrelated application configuration changes.
- Report completed actions and unresolved checks accurately. Do not claim a deploy or WhatsApp message succeeded without corresponding evidence.
