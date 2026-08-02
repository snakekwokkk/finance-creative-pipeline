# Figma sync

Use this reference only after a local run has produced `figma-manifest.json`.

## Preconditions

- Load the `figma-use` and `figma-generate-design` skills completely.
- Read the manifest and every referenced `spec.json`.
- Use `fileKey` and `pageId` from the manifest. Do not guess them.
- Inspect the page and existing date sections before writing.

## Structure

Create one section named `YYYY-MM-DD 自动采集` on the target page, positioned 400 px to the right of the current rightmost visible top-level node. Reuse an existing section with the same name when resuming.

For each direction create a frame named `NN/type` containing:

- `Preview`: rectangle receiving `preview.png` as an image fill.
- `Editable`: frame with native `Background`, `Decorations`, `Icon`, `Copy/Title`, `Copy/Subtitle`, and `CTA` layers. Do not create or upload a separate transparent illustration layer.
- `Sources`: small text containing the two source URLs.
- `Keywords`: small text containing the extracted keywords.

Use these sizes:

- Directions 01–06: popup, 1002 × 1335.
- Directions 07–08: banner, 1140 × 240.
- Directions 09–10: float, 240 × 240.

Lay direction frames in two columns with 160 px gaps. Put the preview and editable version side by side inside each direction frame.

## Write sequence

1. Inspect pages, fonts, existing conventions, components, variables, and styles.
2. Create or resolve the dated section and direction wrappers in incremental `use_figma` calls. Return all IDs.
3. Create the `Preview` rectangle before uploading the image.
4. Call `upload_assets` once for `preview.png` with the target rectangle node ID. POST raw bytes to the returned single-use URL with the correct image content type.
5. Build native text, CTA, background, decorations, and simple vector icon layers from each spec. Load fonts before every text mutation.
6. Use semantic layer names exactly as listed above. Use auto-layout for related children.
7. Screenshot each direction and the complete dated section. Fix missing images, clipping, overlap, wrong fonts, and placeholder text before marking the run complete.

## Completion

Run `node scripts/mark-figma-complete.mjs --date YYYY-MM-DD --section-id NODE_ID --section-name "SECTION_NAME" --direction-ids ID1,ID2 --uploaded-assets N` to record the section node ID, all direction node IDs, uploaded asset count, and `stages.figma = "complete"`. Do not delete source files after sync.
