# NC-01 interaction pose sources

Each transparent PNG is a 3 by 2 pose board generated from the matching canonical evolution asset. Cell order is:

1. idle
2. affection
3. listening
4. thinking
5. speaking
6. happy

The generation prompt locks character identity, route colors, anatomy, markings and signature ornaments, then requests the six state-specific full-body poses on a flat green background. The green source was converted to alpha with the shared `remove_chroma_key.py` soft-matte and despill workflow.

Run `node tools/process-pendant-poses.mjs` to rebuild the browser WebP files and QA contact sheet.
