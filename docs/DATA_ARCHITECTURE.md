# NEXORA CORE data architecture

The production web app is stateless on Netlify. It does not currently use a
server database. Data is divided into the following explicit layers.

## Shared catalog

`shared/companion-data.mjs` is the source of truth for:

- companion identity, names, dialogue lines, and action lines
- interaction scenes, fallback replies, and internal-thought prompts
- voice archetypes and Edge TTS voice IDs
- browser preference key names

Both `desktop-wallpaper/app.js` and the Netlify functions import this catalog.
Do not copy these records into either runtime.

## Browser conversation store

`shared/conversation-store.mjs` owns short conversation history:

- partitioned by companion and scene
- limited to 12 sanitized turns
- retained for 14 days
- stored only in the user's browser
- versioned so incompatible records can be discarded safely

Model credentials never enter browser storage. Phone, desktop, and pendant
clients send only bounded conversation context to the authenticated chat
function. The managed Kimi key stays in Netlify environment variables.

The NEXORA CORE experience under `soulmate/` stores its versioned identity in
`soulmate-profile-v1` and its last 12 sanitized turns in
`soulmate-history-v1`. `shared/soulmate-profile.mjs` owns profile validation,
growth, evolution, and the versioned export/import bundle. Exported bundles do
not include model credentials.

`shared/fallback-dialogue.mjs` remains the deterministic local test and
simulation engine. Production chat does not disguise these replies as a live
model response: a provider outage returns an explicit error without assistant
text.

## Netlify runtime

`netlify/functions/chat.mjs` is the single production conversation endpoint.
It reads `LLM_API_KEY` only from the Netlify runtime, optionally falls back to
the configured Netlify AI Gateway, and ignores client-supplied key fields.
Provider failures return `502`, while a missing provider returns `503`. The
private chat route is rate limited per visitor to protect the site's AI
credits.

`netlify/functions/voice-*.mjs` use the same shared voice catalog.

## Local Python runtime

`ai-companion/project/config/` belongs to the offline pocket-box runtime. It is
not loaded by the Netlify site. Changes intended for both runtimes should be
made in the shared web catalog first, then adapted deliberately to YAML rather
than copied ad hoc.
