# Finance Creative Pipeline

<p align="center">
  <img src="assets/plugin-logo.png" alt="Finance Creative Pipeline" width="160">
</p>

<p align="center">
  Daily finance creative collection, ChatGPT Web generation, pixel-level decomposition, and editable Figma delivery.
</p>

<p align="center">
  <a href="#中文">中文</a> · <a href="#english">English</a>
</p>

---

## 中文

### 项目简介

Finance Creative Pipeline 是一个面向中国互联网金融运营素材的 Codex 插件。它通过可恢复的本地流水线完成以下工作：

1. 使用持久化 Chrome 配置从花瓣采集可见参考图并保留来源链接。
2. 通过 ChatGPT 网页版分析参考图，并为每个方向生成一张品牌中性的完整预览图。
3. 将预览图重新提交给 ChatGPT 网页版，生成语义化 `layers.json`。
4. 使用 Apple Vision 在本地生成像素级前景蒙版，并执行透明度与边界质量检查。
5. 将预览图、清底背景、通过检查的独立素材和原生文字/几何图层同步到 Figma。

默认正式运行会采集 20 张参考图并生成 10 个原创方向：6 个弹窗、2 个 Banner、2 个浮窗。

### 核心原则

- 图片生成必须使用 ChatGPT 网页版，不以 Codex 图片生成作为替代。
- 每个方向只生成一张完整预览图，不额外要求透明前景图。
- ChatGPT 只提供语义框和图层描述；透明边缘由 Apple Vision 在本地生成。
- 未通过抠图质量门槛的素材不会退化为矩形裁切图，也不会上传到 Figma。
- 流水线从 `run.json` 和 `figma-manifest.json` 恢复，避免重复采集、重复生成和重复创建 Figma 日期分区。
- Figma 左侧始终是完整预览，右侧必须是可见的可编辑重建，禁止左右两边显示同一张扁平图。

### 环境要求

- macOS 14 或更高版本
- Node.js 20 或更高版本
- Xcode Command Line Tools
- Google Chrome
- 可用的 ChatGPT 网页版会话
- 可用的花瓣会话
- Codex 桌面版及已启用的官方 Figma connector
- 对目标 Figma 文件的编辑权限

Apple Vision 像素级抠图依赖 `VNGenerateForegroundInstanceMaskRequest`，因此当前不支持 Windows 或 Linux。

### 快速开始

```bash
git clone https://github.com/snakekwokkk/finance-creative-pipeline.git
cd finance-creative-pipeline
npm install
```

创建用户配置目录并复制示例配置：

```bash
mkdir -p "$HOME/Library/Application Support/Codex/finance-creative-pipeline"
cp assets/config.example.json \
  "$HOME/Library/Application Support/Codex/finance-creative-pipeline/config.json"
```

编辑配置文件，至少填写目标 Figma 文件的 `fileKey` 和 `pageId`：

```text
~/Library/Application Support/Codex/finance-creative-pipeline/config.json
```

首次使用或登录失效时运行：

```bash
npm run setup
```

Chrome 会以持久化配置打开。请在可见窗口中手动完成花瓣和 ChatGPT 登录。遇到验证码、安全验证或权限确认时必须由用户处理，流水线不会绕过安全限制。

先运行小规模测试：

```bash
npm run test-run
```

正式运行：

```bash
npm run run
```

### Codex 插件安装

此仓库是插件源码。将它加入已配置的本地 Codex marketplace 后，可使用 marketplace 名称安装：

```bash
codex plugin add finance-creative-pipeline@<marketplace-name>
```

本地开发更新后，应更新 `.codex-plugin/plugin.json` 的 cachebuster 并重新安装插件。新技能内容会在新 Codex 任务中加载。

### 配置说明

用户配置保存在插件仓库之外，不应提交到 Git：

| 配置项 | 说明 |
| --- | --- |
| `timezone` | 日期目录和漏跑检查使用的时区 |
| `chromeExecutable` | Chrome 可执行文件路径 |
| `profileDirectory` | 持久化登录配置目录 |
| `outputRoot` | 每日运行产物根目录 |
| `figma.fileKey` | 目标 Figma 文件 key |
| `figma.pageId` | 目标 Figma 页面 ID |
| `collection.referenceCount` | 正式运行采集的参考图数量 |
| `generation.directionCount` | 原创方向数量 |
| `generation.maxRetries` | 单方向最大重试次数 |
| `matting.paddingRatio` | Apple Vision 候选区域外扩比例 |
| `matting.minForegroundRatio` | 最小前景占比 |
| `matting.maxForegroundRatio` | 最大前景占比 |
| `matting.minTransparentRatio` | 最小透明像素占比 |
| `matting.maxBorderForegroundRatio` | 最大边界前景占比 |

完整示例见 [`assets/config.example.json`](assets/config.example.json)。

### 运行状态与恢复

每日运行目录默认位于：

```text
~/Desktop/互联网金融素材/YYYY-MM-DD/
```

主要状态：

| 状态 | 含义 |
| --- | --- |
| `running` | 本地采集、生成或分解正在进行 |
| `awaiting_figma` | 本地产物完整，可以开始 Figma 同步 |
| `complete` | Figma 同步和视觉核验完成 |
| `blocked` | 需要用户处理登录、验证码、权限或其他外部阻塞 |

恢复任务时先读取已有 `run.json` 和 `figma-manifest.json`。如果本地阶段已经完成，只继续 Figma 同步，不要重新运行采集和生成。

### 输出结构

```text
YYYY-MM-DD/
├── run.json
├── figma-manifest.json
├── references/
└── directions/
    └── 01/
        ├── preview.png
        ├── spec.json
        ├── layers.json
        └── layers/
            ├── decomposition-report.json
            ├── background-clean.png
            └── *.png
```

- `preview.png`：完整、扁平化的最终预览。
- `spec.json`：方向构图、配色、组件和文案。
- `layers.json`：ChatGPT 输出的语义图层计划。
- `decomposition-report.json`：本地抠图结果、质量指标、警告和限制。
- `background-clean.png`：仅在文字背景可以安全修复时生成。
- `layers/*.png`：通过 Apple Vision 质量检查的透明前景素材。

### Figma 交付规范

每个方向使用左右并排结构：

- `Preview`：左侧完整预览图。
- `Editable`：右侧可见的可编辑重建。
- `Visual Base`：锁定但隐藏，只作为核对参考，不能作为右侧可见交付。
- `Background Clean`：存在时显示在可编辑元素下方。
- `Editable Elements`：通过检查的独立素材、原生文字、卡片、按钮和简单几何图层。

没有清底背景时，右侧使用 `spec.json.palette` 的第一个颜色作为原生背景。Figma 完成前必须逐方向截图，并检查：

- 左右两侧不是同一张扁平图。
- 没有重复 OCR、文字溢出或错误换行。
- 没有矩形闪光、假箭头、空框等畸形占位矢量。
- 主视觉没有被卡片遮罩洗白。
- 可编辑区域不是空白，且关键文字和独立素材可见。

详细流程见 [`skills/finance-creative-pipeline/references/figma-sync.md`](skills/finance-creative-pipeline/references/figma-sync.md)。

### 常用命令

```bash
npm run setup          # 打开首次登录流程
npm run test-run       # 3 张参考图、1 个方向的测试运行
npm run run            # 20 张参考图、10 个方向的正式运行
npm run check-missed   # 检查漏跑
npm run check          # 检查 Node.js 和 Objective-C 语法
```

单独重新执行图片分解：

```bash
npm run decompose-image -- \
  --image /path/to/preview.png \
  --layers /path/to/layers.json \
  --out /path/to/output/layers
```

### 安全与合规

- 不导出、共享或提交 Chrome 持久化登录目录。
- 不自动处理验证码、WAF、安全验证、付费限制或下载限制。
- 只下载页面中可见的花瓣预览图，并保留原始来源 URL。
- 不生成真实品牌 Logo、真实公司名称、固定收益、保证审批、监管背书或其他误导性金融承诺。
- 不将拒绝的抠图结果伪装成透明独立素材。
- 不提交用户配置、登录数据或每日运行产物。

---

## English

### Overview

Finance Creative Pipeline is a Codex plugin for daily Chinese internet-finance operations creatives. It runs a resumable local workflow that:

1. Collects visible Huaban references through a persistent Chrome profile and preserves source URLs.
2. Uses ChatGPT Web to analyze the references and generate one brand-neutral, complete preview per direction.
3. Sends each preview back to ChatGPT Web to produce a semantic `layers.json` plan.
4. Uses Apple Vision locally for pixel-level foreground masks and enforces alpha and boundary quality gates.
5. Syncs previews, cleaned backgrounds, accepted isolated assets, and native text/geometry into Figma.

A normal run collects 20 references and generates 10 original directions: six popups, two banners, and two floating creatives.

### Design Principles

- Image generation must use ChatGPT Web. Codex image generation is not a fallback.
- Generate exactly one complete preview per direction; do not request separate transparent foreground images.
- ChatGPT provides semantic regions and layer descriptions only. Apple Vision creates transparent edges locally.
- Failed mattes are never replaced with rectangular crops and are never uploaded to Figma.
- Resume from `run.json` and `figma-manifest.json` to avoid duplicate collection, generation, or dated Figma sections.
- The Figma preview stays on the left. The right side must visibly render editable layers and must never duplicate the same flattened image.

### Requirements

- macOS 14 or later
- Node.js 20 or later
- Xcode Command Line Tools
- Google Chrome
- An active ChatGPT Web session
- An active Huaban session
- Codex desktop with the official Figma connector enabled
- Edit access to the target Figma file

Pixel-level matting uses Apple Vision's `VNGenerateForegroundInstanceMaskRequest`, so Windows and Linux are not currently supported.

### Quick Start

```bash
git clone https://github.com/snakekwokkk/finance-creative-pipeline.git
cd finance-creative-pipeline
npm install
```

Create the user configuration outside the repository:

```bash
mkdir -p "$HOME/Library/Application Support/Codex/finance-creative-pipeline"
cp assets/config.example.json \
  "$HOME/Library/Application Support/Codex/finance-creative-pipeline/config.json"
```

Edit the configuration and provide at least `figma.fileKey` and `figma.pageId`:

```text
~/Library/Application Support/Codex/finance-creative-pipeline/config.json
```

For first use or expired sessions:

```bash
npm run setup
```

Chrome opens with a persistent profile. Complete Huaban and ChatGPT authentication manually in the visible window. CAPTCHA, security checks, and permission prompts require user action and are never bypassed.

Run the small test first:

```bash
npm run test-run
```

Run the normal workflow:

```bash
npm run run
```

### Codex Plugin Installation

This repository contains the plugin source. After adding it to a configured local Codex marketplace, install it by marketplace name:

```bash
codex plugin add finance-creative-pipeline@<marketplace-name>
```

For local development updates, refresh the cachebuster in `.codex-plugin/plugin.json` and reinstall the plugin. New skill content is loaded in a new Codex task.

### Configuration

User configuration lives outside the repository and should never be committed:

| Key | Description |
| --- | --- |
| `timezone` | Timezone used for dated runs and missed-run checks |
| `chromeExecutable` | Chrome executable path |
| `profileDirectory` | Persistent login profile directory |
| `outputRoot` | Root directory for daily artifacts |
| `figma.fileKey` | Target Figma file key |
| `figma.pageId` | Target Figma page ID |
| `collection.referenceCount` | Number of references in a normal run |
| `generation.directionCount` | Number of original directions |
| `generation.maxRetries` | Maximum retries per direction |
| `matting.paddingRatio` | Padding around Apple Vision regions of interest |
| `matting.minForegroundRatio` | Minimum foreground ratio |
| `matting.maxForegroundRatio` | Maximum foreground ratio |
| `matting.minTransparentRatio` | Minimum transparent pixel ratio |
| `matting.maxBorderForegroundRatio` | Maximum foreground ratio along asset borders |

See [`assets/config.example.json`](assets/config.example.json) for the complete example.

### Run States and Recovery

Daily artifacts are stored by default under:

```text
~/Desktop/互联网金融素材/YYYY-MM-DD/
```

Primary states:

| State | Meaning |
| --- | --- |
| `running` | Local collection, generation, or decomposition is active |
| `awaiting_figma` | Local artifacts are complete and Figma sync may begin |
| `complete` | Figma sync and visual verification are complete |
| `blocked` | Login, CAPTCHA, permissions, or another external issue requires user action |

Always inspect the existing `run.json` and `figma-manifest.json` before resuming. If local generation is already complete, continue only the Figma stage.

### Output Layout

```text
YYYY-MM-DD/
├── run.json
├── figma-manifest.json
├── references/
└── directions/
    └── 01/
        ├── preview.png
        ├── spec.json
        ├── layers.json
        └── layers/
            ├── decomposition-report.json
            ├── background-clean.png
            └── *.png
```

- `preview.png`: complete flattened preview.
- `spec.json`: composition, palette, components, and copy.
- `layers.json`: semantic layer plan produced by ChatGPT Web.
- `decomposition-report.json`: local matting results, quality metrics, warnings, and limitations.
- `background-clean.png`: generated only when text regions can be repaired safely.
- `layers/*.png`: transparent foreground assets accepted by the Apple Vision quality gate.

### Figma Delivery Contract

Each direction uses a side-by-side layout:

- `Preview`: complete flattened preview on the left.
- `Editable`: visible editable reconstruction on the right.
- `Visual Base`: locked and hidden reference only; it must not be used as the visible right-side delivery.
- `Background Clean`: visible behind editable elements when available.
- `Editable Elements`: accepted isolated assets, native text, cards, buttons, and simple geometry.

When no cleaned background exists, the right side uses the first color in `spec.json.palette` as a native background. Before completion, screenshot every direction and verify:

- The left and right sides are not the same flattened image.
- OCR is not duplicated, clipped, or wrapped incorrectly.
- No malformed placeholder geometry appears as empty boxes, rectangular sparkles, or fake arrows.
- Hero artwork is not washed out by card masks.
- The editable area is nonblank and shows key text and independent assets.

See [`skills/finance-creative-pipeline/references/figma-sync.md`](skills/finance-creative-pipeline/references/figma-sync.md) for the full workflow.

### Commands

```bash
npm run setup          # Open first-login setup
npm run test-run       # Test with 3 references and 1 direction
npm run run            # Normal 20-reference, 10-direction run
npm run check-missed   # Check for a missed scheduled run
npm run check          # Validate Node.js and Objective-C syntax
```

Run decomposition directly:

```bash
npm run decompose-image -- \
  --image /path/to/preview.png \
  --layers /path/to/layers.json \
  --out /path/to/output/layers
```

### Security and Compliance

- Never export, share, or commit the persistent Chrome profile.
- Never bypass CAPTCHA, WAF, security interstitials, paywalls, or download restrictions.
- Download only visible Huaban previews and preserve their source URLs.
- Do not generate real logos, real company names, fixed returns, guaranteed approvals, fabricated regulatory endorsements, or other misleading financial claims.
- Never present rejected mattes as valid transparent assets.
- Never commit user configuration, authentication data, or daily run artifacts.
