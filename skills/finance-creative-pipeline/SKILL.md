---
name: finance-creative-pipeline
description: Run, resume, inspect, or configure the daily Chinese finance creative workflow that collects Huaban references through a persistent local Chrome profile, analyzes and generates one brand-neutral preview per direction through ChatGPT Web, saves dated local artifacts, and writes native editable layers plus previews into a target Figma file. Use for daily finance material collection, ChatGPT Web image generation, Figma organization, first-login setup, retries, missed-run checks, and end-to-end test runs. Never replace ChatGPT Web generation with Codex image generation or generate separate transparent foreground images.
---

# Finance Creative Pipeline

Use the deterministic local runtime for web collection, ChatGPT Web generation, and post-generation visual decomposition. Use Figma MCP tools only after the runtime produces `figma-manifest.json` with `layers.json` and a decomposition report for every direction.

## Run order

1. Ensure dependencies exist with `npm install` in the plugin root when `node_modules` is absent.
2. For first use or expired sessions, run `node scripts/setup-login.mjs` in a visible terminal and let the user complete both logins.
3. Run `node scripts/run.mjs` for the normal 20-reference/10-direction workflow, or add `--test` for the 3-reference/1-direction trial.
4. Read the emitted `runDir`, `figma-manifest.json`, every `layers.json`, and every `layers/decomposition-report.json`. Do not start Figma work unless the run status is `awaiting_figma`.
5. Follow [figma-sync.md](references/figma-sync.md) to create the dated section, upload the preview and extracted assets, rebuild OCR text natively, and verify screenshots.
6. After all Figma nodes and images are verified, run `node scripts/mark-figma-complete.mjs --date YYYY-MM-DD --section-id NODE_ID --section-name "SECTION_NAME" --direction-ids ID1,ID2 --uploaded-assets N`. Do not mark the run complete before visual verification.

## Hard requirements

- Use the persistent Chrome profile stored outside the plugin. Never export or share it.
- Use ChatGPT Web for analysis and image generation. Do not call Codex image generation as a fallback.
- Generate exactly one complete preview image per direction. Do not request or save a separate transparent foreground image.
- After each preview is saved, send that generated preview back to ChatGPT Web for a decomposition-only visual review. Save normalized layer boxes, OCR copy, repair colors, confidence, and polygon masks to `layers.json`.
- Run `node scripts/decompose-image.mjs` to create non-destructive crops and a `decomposition-report.json`. Never describe a crop as a fully isolated layer unless the report says it has a reliable mask.
- Treat `decomposition-report.json` warnings and limitations as binding evidence. A single flattened PNG cannot recover pixels hidden behind text or objects.
- Do not bypass login, CAPTCHA, WAF, download restrictions, paid assets, or security interstitials.
- Download only visible Huaban preview images and retain their source URLs.
- Keep generated content brand-neutral and reject real logos, real brand names, copied copy, guaranteed approvals, fixed returns, or fabricated regulatory endorsements.
- Resume from `run.json` and `figma-manifest.json`; never duplicate successful directions or Figma date sections.
- For Figma writes, load and follow `figma-use` and `figma-generate-design`; work incrementally and return every created or mutated node ID.
- Preserve visual fidelity in Figma: use `Visual Base` as the visible locked composite when background cleanup is unsafe; place extracted rasters and native OCR text in `Editable Elements` for toggled editing. Only show extracted layers by default when the decomposition report confirms safe background repair.

## Recovery

- If the runtime reports missing login, run setup and then rerun the same command.
- If a direction fails, retain its screenshots and retry only that incomplete direction.
- If Figma fails, do not rerun collection or generation. Resume from the existing manifest.
- If the 10:30 run was missed, notify once and wait for explicit user approval before launching a catch-up run.

## User configuration

Read or edit `~/Library/Application Support/Codex/finance-creative-pipeline/config.json`. Keep personal values there rather than in the shared plugin.
