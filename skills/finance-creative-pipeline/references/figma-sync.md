# Figma sync

Use this reference as soon as the local runtime emits `direction_ready`. The producer may still be generating the next direction.

## Contents

- [Preconditions](#preconditions)
- [Incremental queue](#incremental-queue)
- [Structure](#structure)
- [Coordinate contract](#coordinate-contract)
- [Write sequence](#write-sequence)
- [Remix Icon workflow](#remix-icon-workflow)
- [Visual QA gate](#visual-qa-gate)
- [Completion](#completion)

## Preconditions

- Load the `figma-use` and `figma-generate-design` skills completely.
- Ensure plugin dependencies are installed so `node_modules/remixicon/icons/` and `npm run find-remix-icon` are available.
- Read the manifest and every referenced `layers.json` plus `layers/decomposition-report.json`. Read `spec.json` only when a legacy direction still references one.
- Sync only manifest directions whose status is `ready` and whose `preview.png`, `layers.json`, and `layers/decomposition-report.json` all exist and validate. The decomposition report may be `ready` or `partial` when at least one accepted complex asset exists, but a `partial` direction cannot pass Figma QA if any missing critical asset leaves a visible hole or changes the composition. Ignore retained `failures` except as audit evidence.
- Read every ready direction's `layers.json` and `layers/decomposition-report.json`. Treat confidence and warnings as evidence, not optional notes.
- Use `fileKey` and `pageId` from the manifest. Do not guess them.
- Inspect the page and existing date sections before writing.
- Never write Figma progress into `figma-manifest.json`; the still-running producer owns that file. Use only `figma-sync-state.json` through the bundled progress CLI.

## Incremental queue

1. Run `node scripts/figma-sync-progress.mjs inspect --date YYYY-MM-DD` after each `direction_ready` event. A new or artifact-changed direction appears as `pending`; an unchanged `qa_passed` direction must be skipped.
2. Create or reuse the single dated Section, then persist its ID with `node scripts/figma-sync-progress.mjs section --date YYYY-MM-DD --section-id NODE_ID --section-name "YYYY-MM-DD 自动采集"`.
3. Before writing one direction, run `node scripts/figma-sync-progress.mjs start --date YYYY-MM-DD --direction N`. This binds the attempt to the current preview/layers/report revision.
4. Create or reuse the direction Frame, then immediately persist its ID with `node scripts/figma-sync-progress.mjs node --date YYYY-MM-DD --direction N --node-id NODE_ID` before adding children. This makes a mid-sync restart reuse the same Frame.
5. Build and screenshot that direction using the sequence below. Generation of the next direction may continue concurrently in the existing runtime process.
6. After visual QA passes, run `node scripts/figma-sync-progress.mjs complete --date YYYY-MM-DD --direction N --uploaded-assets N --qa-report /absolute/path/to/figma-qa-report.json`. If writing or QA fails, run the same command with `fail` and `--message "REASON"` instead of claiming success. Completion without `--qa-report` is forbidden and rejected by the CLI.
7. If the direction's artifacts change later, `inspect` resets that direction to `pending` while retaining its previous Frame ID for in-place replacement. Never create a duplicate direction Frame.

## Structure

Create one section named `YYYY-MM-DD 自动采集` on the target page, positioned 400 px to the right of the current rightmost visible top-level node. Reuse an existing section with the same name when resuming.

For each direction create a frame named `NN/type` containing:

- `Preview`: rectangle receiving `preview.png` as an image fill.
- `Editable`: frame containing a locked hidden `Visual Base` and visible `Editable Elements` made from accepted source-pixel transparent PNGs, native OCR text, buttons, vectors, and semantic metadata. Never use the flattened preview as the visible editable-side output. For popup directions the outer canvas is transparent and contains only the popup body; Banner and float directions may contain native backgrounds.
- `Sources`: small text containing the direction's single source URL.
- `Keywords`: small text containing the extracted keywords.

Use these sizes:

- Directions 01–05: popup, 1002 × 1335.
- Directions 06–08: banner, 1140 × 240.
- Directions 09–10: float, 240 × 240.

Lay direction frames in two columns with 160 px gaps. Put the flattened preview on the left and the visibly reconstructed editable version on the right inside each direction frame. The two sides must not render the same flattened image.

## Coordinate contract

`preview.png` is the sole visual truth. `layers.json` describes how to reproduce that exact image; it does not authorize a new layout.

1. Require `bboxFormat: "normalized-xywh-object"`. Every bbox must be an object containing normalized `x`, `y`, `width`, and `height`; arrays and ambiguous aliases are invalid for new output.
2. Convert normalized values against the declared preview canvas: `left = x * canvasWidth`, `top = y * canvasHeight`, `widthPx = width * canvasWidth`, and `heightPx = height * canvasHeight`.
3. Set each layer's position and dimensions from those calculated values. Preserve subpixel values when Figma supports them. Do not drag approximately, re-center, distribute, align to a new grid, optimize whitespace, or infer alternate spacing.
4. Use absolute positioning for the `Editable` artwork canvas and all artwork descendants. Do not apply Auto Layout to the artwork canvas, raster groups, card groups, text groups, buttons, decorations, or any group whose children correspond to preview coordinates. Auto Layout is permitted only outside the artwork canvas for presentation wrappers such as the Preview/Editable row and Sources/Keywords metadata.
5. Use `zIndex` for stacking and the preview to resolve ties. Native text baselines, raster asset boxes, icon boxes, surfaces, and decorations must all correspond to the preview.
6. After writing, read actual absolute bounds and text baselines back from Figma. Never populate QA geometry from the intended input values without reading the created nodes.

## Write sequence

1. Inspect pages, fonts, existing conventions, components, variables, and styles.
2. Create or resolve the dated section and direction wrappers in incremental `use_figma` calls. Return all IDs.
3. Create the `Preview` and `Visual Base` rectangles before uploading images.
4. Call `upload_assets` for `preview.png` and accepted PNGs whose `extractionMode` is `native-source-pixel-asset` with `asset.engine: native-source-pixel-matting` and `sourcePixelExact: true`, or `chatgpt-reconstructed-asset` with `asset.engine: chatgpt-reconstructed-matting` and `reconstructedByChatGpt: true`. Place each accepted asset inside `assetPlacement.box` (or `assetBboxPx` for older reports) with aspect ratio preserved, `contain` sizing, and center alignment; never stretch it to fill a box whose aspect ratio differs from `assetIntrinsicPx`. Never upload `transparent-asset-rejected` layers.
5. Build OCR text, CTA, cards, simple geometry, background fills, and vector icon layers from `layers.json`; a legacy `spec.json` is optional supplementary context only. Before building native layers, collect every ID in accepted assets' `suppressesLayerIds` and skip those IDs because their pixels are already present in the retained raster. Resolve ordinary `kind: "icon"` layers through the Remix Icon workflow below instead of drawing paths manually. For popup directions, do not create a canvas fill or reconstruct anything behind the popup card. Ignore legacy popup layers whose roles or IDs describe App/page backgrounds, search bars, navigation, bottom tabs, feeds, page cards, or other environmental UI. Banner and float directions may build their native background fills from the background layer's geometry and style, using a legacy `spec.json.palette` only as a fallback. Load fonts before every text mutation. Keep `Visual Base` locked and hidden. Rejected or missing assets remain absent; never reveal the flattened preview to conceal an incomplete editable reconstruction.
6. Compose the editable side using declared `zIndex`, with this fallback order: optional Banner/float background, popup card and panel surfaces, accepted transparent raster visuals and popup-owned decorations, native vectors, then native text. Add opaque or near-opaque native card/content surfaces when needed for legibility.
7. Constrain every native text node to its declared bbox. For explicit multiline text, cap font size by both the available width and approximately `bboxHeight / (lineCount * 1.22)`; retain the source line breaks. Fix wrapping rather than allowing text to overlap adjacent rows or controls.
8. Use semantic layer names exactly as listed above. Keep artwork layers absolutely positioned; use Auto Layout only for the outer presentation wrappers allowed by the coordinate contract. Remove or hide generic placeholders that render as bounding boxes, rectangular sparkle outlines, fake chevrons, or detached empty shapes instead of recognizable UI geometry.
9. Export the `Editable` artwork alone at exactly the preview's native pixel dimensions and collect actual geometry using the Visual QA sequence below. Also screenshot each direction and the complete dated section for review context. Fix failures in editable layers; never hide `Editable Elements` or reveal `Visual Base` as a QA workaround.

## Remix Icon workflow

Use Remix Icon only for ordinary functional or informational icons. Logos, brand marks, complex illustrations, campaign-specific symbols, and distinctive source artwork must retain their original treatment and must not be replaced with a generic library icon.

1. Read `layer.icon.query`, `layer.icon.style`, and `layer.icon.color`. If an older manifest lacks these fields, infer a short English semantic query from the layer role and preview before searching.
2. Run `npm run find-remix-icon -- --query "QUERY" --style line|fill --limit 8` from the plugin root. Inspect the returned names and choose the closest semantic match; do not merely accept the first lexical match when its meaning is wrong.
3. Read the selected official SVG from the returned path and import it with Figma's SVG-to-node capability so it remains an editable vector. Do not redraw or trace the path manually, and do not rasterize it.
4. Preserve the SVG's square aspect ratio and internal geometry. Scale uniformly inside the declared bbox, center it, and apply `layer.icon.color` or the preview-derived solid color. Do not stretch it to fill a non-square bbox.
5. Name the resulting node `Icon/ri-<selected-name>` and retain the selected Remix Icon name in node metadata or plugin data when available for auditability.
6. If none of the candidates is semantically credible, do not substitute an unrelated icon. Use native geometry only for a truly elementary primitive such as a divider, dot, plus, minus, or plain chevron; otherwise leave the icon unresolved, record it for visual QA, and do not mark the direction complete.

## Visual QA gate

Side-by-side screenshots are review context, not proof of fidelity. Every direction must pass deterministic native-resolution comparison before `qa_passed`.

1. Export only the visible `Editable` artwork canvas, without labels or presentation wrappers, at the exact pixel dimensions of `preview.png`. Do not scale, crop, pad, or resample either image before comparison.
2. Read every created node's actual absolute `x`, `y`, `width`, and `height` relative to the `Editable` canvas. For text, also read the rendered baseline. Record expected values from normalized bboxes and actual values from Figma in a geometry JSON file. Mark composition-essential layers as `critical`.
3. Record structure and asset evidence in the same JSON. A minimal example is:

```json
{
  "layers": [
    {
      "id": "headline",
      "kind": "text",
      "critical": true,
      "expected": {"x": 84, "y": 70, "width": 489, "height": 48},
      "actual": {"x": 84, "y": 70, "width": 489, "height": 48},
      "expectedBaseline": 102,
      "actualBaseline": 102
    }
  ],
  "structure": {
    "previewHasImage": true,
    "visualBaseHidden": true,
    "visualBaseLocked": true,
    "editableElementsVisible": true,
    "correctCanvasSize": true,
    "noArtworkAutoLayout": true,
    "noGenericPlaceholders": true,
    "officialIconsOnly": true,
    "popupCanvasTransparent": true
  },
  "assets": {
    "acceptedExpected": 2,
    "acceptedVisible": 2,
    "missingAcceptedLayerIds": [],
    "criticalMissingLayerIds": [],
    "rejectedVisibleLayerIds": [],
    "residualMatteLayerIds": []
  }
}
```

4. Run:

```bash
node scripts/figma-visual-qa.mjs \
  --direction N \
  --type popup|banner|float \
  --preview /absolute/path/to/preview.png \
  --editable /absolute/path/to/editable.png \
  --geometry /absolute/path/to/geometry.json \
  --output /absolute/path/to/qa-directory
```

5. Inspect both generated files: `overlay-50.png` must show corresponding edges and baselines aligned, and `difference-heatmap.png` must not show unexplained displaced elements or large missing regions. Do not accept a numeric pass without inspecting both images, and do not accept visual inspection without a numeric pass.
6. The hard thresholds are visual similarity at least 95%; maximum edge error 4 px for popup and 2 px for Banner/float; maximum width or height error 1%; and maximum text-baseline error 2 px. Correct canvas size, hidden locked `Visual Base`, visible `Editable Elements`, official functional icons, and no artwork Auto Layout or generic placeholders are mandatory.
7. Any missing accepted asset, missing critical asset, visible rejected asset, residual rectangular matte/background, non-transparent popup canvas, wrong canvas size, or visible hole caused by a `partial` decomposition fails QA regardless of similarity. Repair the reconstruction or record `fail`; never mark it complete.
8. Keep `overlay-50.png`, `difference-heatmap.png`, `figma-qa-report.json`, the native-resolution editable export, and geometry JSON as audit evidence. The QA report contains preview/editable hashes so stale evidence cannot be silently reused.

## Completion

For each direction, pass its generated report to `node scripts/figma-sync-progress.mjs complete --date YYYY-MM-DD --direction N --uploaded-assets N --qa-report /absolute/path/to/figma-qa-report.json`. The CLI validates the report and records its SHA-256, similarity, geometry maxima, and review time.

Run `node scripts/mark-figma-complete.mjs --date YYYY-MM-DD` only after the local runtime has reached `awaiting_figma` and every current ready direction has a matching `qa_passed` artifact revision with stored QA evidence. The command derives the Section ID, direction IDs, and uploaded asset count from `figma-sync-state.json`; it refuses stale or incomplete work. Record whether each direction is `visual_fidelity` or `editable_reconstruction` based on its decomposition report. Do not delete source files or QA evidence after sync.
