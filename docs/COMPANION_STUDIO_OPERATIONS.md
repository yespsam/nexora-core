# Companion Studio 0.4.0

## Delivered

- `/companion-studio/`: photo/anime input, up to three images, full-body preview confirmation, generation progress, private preview/GLB delivery, activation, source-image removal and character deletion.
- Desktop menu opens a one-hour scoped studio session in the browser; the long-lived desktop secret is never included in the browser URL. Mac and Windows download and verify selected assets, cache them locally, and retain the current model if a replacement fails.
- Names, voices, personality and up to 20 explicitly editable memories are owner-scoped. Desktop conversations use the saved profile. Appearance changes do not erase memories; the current prompt includes the most recent six memories.
- Durable PostgreSQL jobs, private Netlify Blobs, locked worker claims, idempotent creation/confirmation, daily caps (2 per owner, 20 site-wide), and no automatic resubmission of ambiguous paid requests.

## Current limitation

No Meshy API key is configured. The deployed generation button must remain disabled. Local tests use fixed, clearly labeled bundled models and do not demonstrate real photo-to-3D quality. Do not market generation as live until a funded provider account and actual sample validation are complete. The real pipeline targets humanoid bipeds; arbitrary pets or non-humanoid drawings are not guaranteed to rig.

## Enable generation

Set `MESHY_API_KEY` privately in Netlify Functions, then `NEXORA_STUDIO_ENABLED=true`. Use `NEXORA_STUDIO_DAILY_LIMIT` and `NEXORA_STUDIO_SITE_LIMIT` to lower the default budgets. `NEXORA_STUDIO_SIGNING_KEY` is an independent high-entropy server secret for browser handoff tokens. Never expose these values in client bundles.

Before allowing public creation, verify the provider account's current pricing/balance and test both photo and anime samples. The pipeline uses image-to-image (`nano-banana`), image-to-3D (`meshy-6`, T-pose, 20k target polygons), rigging, idle and speaking animations. Costs are recorded from task responses. User-facing "generation quota" is not a payment integration.

Provider references: https://docs.meshy.ai/en/api/image-to-image, https://docs.meshy.ai/en/api/image-to-3d, https://docs.meshy.ai/en/api/rigging, https://docs.meshy.ai/en/api/animation.

## Deployment and background work

Apply `202609260001_companion_studio.sql` through Netlify Database migrations. Creation and preview confirmation wake an authenticated background function in the same deploy/database context. It processes a specific owner's job and hands itself off before the background timeout. A production scheduled worker also sweeps due jobs every minute. No browser needs to stay open.

A lease expiring during `submitting_*` becomes `submission_unknown` instead of making another paid POST. Resolve such tasks against provider history before retrying. Safe GET/download failures can resume without creating another paid task. Stuck queued/polling tasks have a manual resume action.

Original images are normalized and stripped of metadata. GLB files require skins, embedded resources, bounded size and animation clips; assets above 18 MB are rejected. Input is forwarded to Meshy only after user consent. Deleting app-stored sources does not issue a refund or erase third-party service retention immediately.

## Local verification

1. `npm run cloud:setup`
2. `node tools/serve-companion-studio-dev.mjs --fixture-generation`
3. Visit `http://127.0.0.1:4177/companion-studio/` or run `node tools/test-companion-studio-local.mjs`.
4. Run `npm test` and the native build/self-tests.

The fixture harness listens only on localhost, labels itself as a test, never calls Meshy, and is not included in public deploys. Assets are stored in ignored `output/studio-local/`.

## UI direction

A quiet sage-and-cream workspace: a large interactive companion preview on the left, a restrained creation/settings inspector on the right. File selection responds to drag/hover; model changes preserve the current character until the replacement loads; preview and model actions stay beside the image. Motion respects reduced-motion settings.
