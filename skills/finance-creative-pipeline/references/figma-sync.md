# Figma sync

Use this reference only after a local run has produced `figma-manifest.json`.

## Preconditions

- Load the `figma-use` and `figma-generate-design` skills completely.
- Read the manifest and every referenced `spec.json`.
- Read every referenced `layers.json` and `layers/decomposition-report.json`. Treat confidence and warnings as evidence, not optional notes.
- Use `fileKey` and `pageId` from the manifest. Do not guess them.
- Inspect the page and existing date sections before writing.

## Structure

Create one section named `YYYY-MM-DD 自动采集` on the target page, positioned 400 px to the right of the current rightmost visible top-level node. Reuse an existing section with the same name when resuming.

For each direction create a frame named `NN/type` containing:

- `Preview`: rectangle receiving `preview.png` as an image fill.
- `Editable`: frame containing a locked hidden `Visual Base`, an optional visible `Background Clean`, and visible `Editable Elements` made from accepted alpha-matted rasters, native OCR text, buttons, vectors, and semantic metadata. Do not redraw the whole composition from the spec and never use the flattened preview as the visible editable-side output.
- `Sources`: small text containing the two source URLs.
- `Keywords`: small text containing the extracted keywords.

Use these sizes:

- Directions 01–06: popup, 1002 × 1335.
- Directions 07–08: banner, 1140 × 240.
- Directions 09–10: float, 240 × 240.

Lay direction frames in two columns with 160 px gaps. Put the flattened preview on the left and the visibly reconstructed editable version on the right inside each direction frame. The two sides must not render the same flattened image.

## Write sequence

1. Inspect pages, fonts, existing conventions, components, variables, and styles.
2. Create or resolve the dated section and direction wrappers in incremental `use_figma` calls. Return all IDs.
3. Create the `Preview` and `Visual Base` rectangles before uploading images.
4. Call `upload_assets` for `preview.png`, `background-clean.png` when present, and only raster files whose `extractionMode` is `vision-alpha-matting` and whose `matting.status` is `accepted`. Position each accepted matte using `assetBboxPx`. Never upload or synthesize a rectangular crop for `matting-rejected` layers.
5. Build native OCR text, CTA, cards, simple geometry, and vector icon layers from `layers.json`. Load fonts before every text mutation. Keep `Visual Base` locked and hidden. Show `Background Clean` plus `Editable Elements` when `background-clean.png` exists; otherwise give the `Editable` frame a native solid fill using the first color in `spec.json.palette` and show `Editable Elements`. Rejected mattes remain absent even when `editableReadiness` is `visual-base-required`.
6. Compose the editable side in this z-order: native/clean background, dim or content masks, card and panel surfaces, accepted raster visuals and decorations, native vectors, then native text. Hide `BackgroundUI` OCR when the visible cleaned background already contains that UI copy. Add an opaque or near-opaque native card/content mask when repaired background text leaks through beneath native copy.
7. Constrain every native text node to its declared bbox. For explicit multiline text, cap font size by both the available width and approximately `bboxHeight / (lineCount * 1.22)`; retain the source line breaks. Fix wrapping rather than allowing text to overlap adjacent rows or controls.
8. Use semantic layer names exactly as listed above. Use auto-layout for related children. Remove or hide generic placeholders that render as bounding boxes, rectangular sparkle outlines, fake chevrons, or detached empty shapes instead of recognizable UI geometry.
9. Screenshot each direction at a readable size and then screenshot the complete dated section. Verify that the left side is the preview and the right side is visibly editable, with no duplicated OCR, clipping, overlap, wrong fonts, washed-out hero art, malformed placeholder vectors, or blank reconstruction. Fix failures in the editable layers; never hide `Editable Elements` or reveal `Visual Base` as a QA workaround.

## Completion

Run `node scripts/mark-figma-complete.mjs --date YYYY-MM-DD --section-id NODE_ID --section-name "SECTION_NAME" --direction-ids ID1,ID2 --uploaded-assets N` only after every right-side reconstruction passes the visual gate above. Record the section node ID, all direction node IDs, uploaded asset count, and `stages.figma = "complete"`. Record whether each direction is `visual_fidelity` or `editable_reconstruction` based on its decomposition report. Do not delete source files after sync.
