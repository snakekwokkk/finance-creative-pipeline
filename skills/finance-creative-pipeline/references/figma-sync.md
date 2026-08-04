# Figma sync

Use this reference only after a local run has produced `figma-manifest.json`.

## Preconditions

- Load the `figma-use` and `figma-generate-design` skills completely.
- Ensure plugin dependencies are installed so `node_modules/remixicon/icons/` and `npm run find-remix-icon` are available.
- Read the manifest and every referenced `spec.json`.
- Read every referenced `layers.json` and `layers/decomposition-report.json`. Treat confidence and warnings as evidence, not optional notes.
- Use `fileKey` and `pageId` from the manifest. Do not guess them.
- Inspect the page and existing date sections before writing.

## Structure

Create one section named `YYYY-MM-DD 自动采集` on the target page, positioned 400 px to the right of the current rightmost visible top-level node. Reuse an existing section with the same name when resuming.

For each direction create a frame named `NN/type` containing:

- `Preview`: rectangle receiving `preview.png` as an image fill.
- `Editable`: frame containing a locked hidden `Visual Base` and visible `Editable Elements` made from accepted ChatGPT-separated transparent PNGs, native OCR text, buttons, vectors, and semantic metadata. Never use the flattened preview as the visible editable-side output. For popup directions the outer canvas is transparent and contains only the popup body; Banner and float directions may contain native backgrounds.
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
4. Call `upload_assets` for `preview.png` and only separate PNG files whose `extractionMode` is `chatgpt-transparent-asset` and whose `asset.status` is `accepted`. Place each accepted asset inside `assetPlacement.box` (or `assetBboxPx` for older reports) with aspect ratio preserved, `contain` sizing, and center alignment; never stretch it to fill a box whose aspect ratio differs from `assetIntrinsicPx`. Never upload or synthesize a rectangular crop for `transparent-asset-rejected` layers.
5. Build OCR text, CTA, cards, simple geometry, and vector icon layers from `spec.json` and `layers.json`. Resolve ordinary `kind: "icon"` layers through the Remix Icon workflow below instead of drawing paths manually. For popup directions, do not create a canvas fill or reconstruct anything behind the popup card. Ignore legacy popup layers whose roles or IDs describe App/page backgrounds, search bars, navigation, bottom tabs, feeds, page cards, or other environmental UI. Banner and float directions may still build their native background fills. Load fonts before every text mutation. Keep `Visual Base` locked and hidden. Rejected or missing assets remain absent; never reveal the flattened preview to conceal an incomplete editable reconstruction.
6. Compose the editable side using declared `zIndex`, with this fallback order: optional Banner/float background, popup card and panel surfaces, accepted transparent raster visuals and popup-owned decorations, native vectors, then native text. Add opaque or near-opaque native card/content surfaces when needed for legibility.
7. Constrain every native text node to its declared bbox. For explicit multiline text, cap font size by both the available width and approximately `bboxHeight / (lineCount * 1.22)`; retain the source line breaks. Fix wrapping rather than allowing text to overlap adjacent rows or controls.
8. Use semantic layer names exactly as listed above. Use auto-layout for related children. Remove or hide generic placeholders that render as bounding boxes, rectangular sparkle outlines, fake chevrons, or detached empty shapes instead of recognizable UI geometry.
9. Screenshot each direction at a readable size and then screenshot the complete dated section. Verify that the left side is the preview and the right side is visibly editable, with no duplicated OCR, clipping, overlap, wrong fonts, malformed placeholder vectors, wrong Remix Icon semantics, distorted icon proportions, blank reconstruction, or major drift between the preview and ChatGPT-separated assets. For popup directions, also verify that the editable outer canvas is transparent and no page/background interface has been rebuilt. Fix failures in the editable layers; never hide `Editable Elements` or reveal `Visual Base` as a QA workaround.

## Remix Icon workflow

Use Remix Icon only for ordinary functional or informational icons. Logos, brand marks, complex illustrations, campaign-specific symbols, and distinctive source artwork must retain their original treatment and must not be replaced with a generic library icon.

1. Read `layer.icon.query`, `layer.icon.style`, and `layer.icon.color`. If an older manifest lacks these fields, infer a short English semantic query from the layer role and preview before searching.
2. Run `npm run find-remix-icon -- --query "QUERY" --style line|fill --limit 8` from the plugin root. Inspect the returned names and choose the closest semantic match; do not merely accept the first lexical match when its meaning is wrong.
3. Read the selected official SVG from the returned path and import it with Figma's SVG-to-node capability so it remains an editable vector. Do not redraw or trace the path manually, and do not rasterize it.
4. Preserve the SVG's square aspect ratio and internal geometry. Scale uniformly inside the declared bbox, center it, and apply `layer.icon.color` or the preview-derived solid color. Do not stretch it to fill a non-square bbox.
5. Name the resulting node `Icon/ri-<selected-name>` and retain the selected Remix Icon name in node metadata or plugin data when available for auditability.
6. If none of the candidates is semantically credible, do not substitute an unrelated icon. Use native geometry only for a truly elementary primitive such as a divider, dot, plus, minus, or plain chevron; otherwise leave the icon unresolved, record it for visual QA, and do not mark the direction complete.

## Completion

Run `node scripts/mark-figma-complete.mjs --date YYYY-MM-DD --section-id NODE_ID --section-name "SECTION_NAME" --direction-ids ID1,ID2 --uploaded-assets N` only after every right-side reconstruction passes the visual gate above. Record the section node ID, all direction node IDs, uploaded asset count, and `stages.figma = "complete"`. Record whether each direction is `visual_fidelity` or `editable_reconstruction` based on its decomposition report. Do not delete source files after sync.
