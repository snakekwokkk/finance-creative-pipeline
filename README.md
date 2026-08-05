# Finance Creative Pipeline

<p align="center">
  <img src="assets/plugin-logo.png" alt="Finance Creative Pipeline" width="160">
</p>

<p align="center">
  Daily finance creative collection, ChatGPT Web generation, transparent asset separation, and editable Figma delivery.
</p>

<p align="center">
  <a href="#中文">中文</a> · <a href="#english">English</a>
</p>

---

## 中文

### 项目简介

Finance Creative Pipeline 是一个面向中国互联网金融运营素材的 Codex 插件。它通过可恢复的本地流水线完成以下工作：

1. 使用持久化 Chrome 配置从花瓣 Pin 详情页采集高分辨率可见参考图，并保留来源链接和尺寸信息。
2. 通过 ChatGPT 网页版分析参考图，并为每个方向生成一张品牌中性的完整预览图。
3. 每天创建或复用一个日期项目，每个方向只使用一个项目内聊天；该方向的生图、拆图和透明素材提取都在同一聊天完成。
4. 将预览图继续提交到同一聊天，识别复杂视觉元素并生成语义化 `layers.json`。
5. 只把无法用 Figma 基础图形可靠重构的复杂主视觉逐个交给 ChatGPT，每个元素单独生成一张透明 PNG。
6. 将预览图、通过检查的透明独立素材和原生文字/几何图层同步到 Figma。

默认正式运行会采集 10 张参考图并生成 10 个原创方向：6 个弹窗、2 个 Banner、2 个浮窗，每个方向使用 1 张同类型参考图。

### 核心原则

- 图片生成必须使用 ChatGPT 网页版，不以 Codex 图片生成作为替代。
- 每个方向生成一张完整预览图；每个复杂素材都使用独立的 ChatGPT 任务和独立 PNG，不生成多元素素材板。
- 弹窗方向只生成弹窗本体与干净的外部安全留白，不生成 App 页面、搜索栏、导航栏、底部 Tab、页面卡片或虚化界面背景。
- 只拆复杂主视觉、3D物体、人物、吉祥物或复杂插画；卡片、按钮、普通图标、图表和简单装饰由 Figma 原生重构。
- 普通功能图标优先从 [Remix Icon](https://remixicon.com/) 匹配官方 SVG，并以可编辑矢量导入 Figma；不再手绘临时图标或使用无语义占位形状。
- ChatGPT 必须从原图单独提取并保持造型、比例、颜色、光影和细节，不得重新设计；本地不运行 Apple Vision 或其他 AI 抠图模型。
- 本地只裁掉透明空白并执行 Alpha 与边界质量检查，不会推断前景蒙版。
- 没有真实 Alpha、带底色、内容为空或触碰图片边界的素材会被拒绝，也不会上传到 Figma。
- 每个运行日期只使用一个名为 `金融运营素材 YYYY-MM-DD` 的 ChatGPT 项目，每个设计方向只使用一个聊天。项目 URL 和方向聊天 URL 都会写入清单，失败重试或断点恢复时继续原聊天，不会为拆图或单个素材另外新建聊天。
- 项目内聊天会显式命名为 `弹窗1` 至 `弹窗6`、`Banner1` 至 `Banner2`、`浮窗1` 至 `浮窗2`；编号在各素材类型内独立计算，验证运行中的每个类型从 1 开始。
- 参考图使用 ChatGPT 图片专用上传控件；只有该方向 1 张附件的文件名、缩略图和发送状态全部验证通过后才发送分析提示词。若 ChatGPT 回复未收到图片，流水线会清理草稿并重新上传，不会继续无图生图。
- 流水线从 `run.json` 和 `figma-manifest.json` 恢复，避免重复采集、重复生成和重复创建 Figma 日期分区。
- 参考图按类型采集：弹窗、Banner、浮窗分别使用匹配的关键词池和数量配额，不混用搜索词。Banner 词库使用 `金融banner`、`理财banner`、`投资理财banner` 等金融垂类词，优先寻找结构简洁的横向设计；浮窗词库使用 `浮窗`、`小浮窗`、`悬浮窗素材` 等形态词，并排除明显的完整手机页面。
- `reference-history.json` 长期记录已采集 Pin 和图片指纹；后续运行会跳过历史 Pin 和相同图片并继续滚动检索，不会误删仅仅版式相似的素材。
- Figma 左侧始终是完整预览，右侧必须是可见的可编辑重建，禁止左右两边显示同一张扁平图。

### 环境要求

- Node.js 20 或更高版本
- Google Chrome
- 可用的 ChatGPT 网页版会话
- 可用的花瓣会话
- Codex 桌面版及已启用的官方 Figma connector
- 对目标 Figma 文件的编辑权限

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

登录设置、测试、正式、定时和断点恢复运行均使用带持久化配置的可见专用 Chrome。花瓣会对无头浏览器返回 `405`，而 macOS 后台启动方式不能稳定复用 ChatGPT 登录会话，因此默认不再隐藏或最小化窗口。遇到验证码、安全验证或权限确认时会停止并通知用户，流水线不会绕过安全限制。

每次工作流最多启动一次专用 Chrome，并在启动阶段一次性准备花瓣、Pin 详情和 ChatGPT 标签页。所有方向和重试均复用该浏览器会话；单实例锁会阻止重复调度再次打开窗口，浏览器异常时任务直接停止而不会自动重启。

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
| `browser.mode` | 浏览器模式，默认 `visible`；`background` 和 `headless` 仅保留用于诊断 |
| `figma.fileKey` | 目标 Figma 文件 key |
| `figma.pageId` | 目标 Figma 页面 ID |
| `collection.referenceCount` | 正式运行采集的参考图数量 |
| `collection.minReferenceWidthPx` | 详情页参考图的最低像素宽度，默认 720 |
| `collection.perKeywordLimit` | 单个搜索词最多接受的参考图数量 |
| `collection.maxSearchScrolls` | 为寻找未采集 Pin 执行的最大滚动次数 |
| `collection.maxFloatHeightToWidthRatio` | 浮窗参考图允许的最大高宽比，默认 2；用于排除完整手机页面 |
| `collection.searchPlans` | 弹窗、Banner、浮窗各自的配额和搜索词列表 |
| `generation.directionCount` | 原创方向数量 |
| `generation.analysisTimeoutMinutes` | 第 6 步参考分析单次等待上限，默认 5 分钟 |
| `generation.analysisMaxAttempts` | 第 6 步参考分析首轮总尝试次数，默认 2；失败方向在队尾再尝试 1 次 |
| `generation.maxAttempts` | 第 7 步预览生成总尝试次数，默认 2 |
| `generation.imageTimeoutMinutes` | 单次生图等待上限，默认 5 分钟 |
| `generation.decompositionTimeoutMinutes` | 第 8 步语义分层单次等待上限，默认 5 分钟 |
| `generation.decompositionMaxAttempts` | 第 8 步语义分层总尝试次数，默认 2 |
| `chatgpt.dailyProjects` | 是否每天创建或复用一个 ChatGPT 日期项目，默认开启 |
| `chatgpt.projectNamePrefix` | 日期项目前缀，默认 `金融运营素材` |
| `transparentAssets.maxAssets` | 单方向最多拆出的复杂视觉素材数，默认 4 |
| `transparentAssets.timeoutMinutes` | 第 9 步每个独立素材单次等待上限，默认 5 分钟 |
| `transparentAssets.maxAttempts` | 第 9 步每个独立素材总尝试次数，默认 2 |
| `transparentAssets.minForegroundRatio` | 单素材最小前景占比 |
| `transparentAssets.maxForegroundRatio` | 单素材最大前景占比 |
| `transparentAssets.minTransparentRatio` | 单素材最小透明像素占比 |
| `transparentAssets.maxBorderForegroundRatio` | 图片边界允许的最大前景占比 |

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
| `awaiting_figma` | ChatGPT 阶段结束，至少一个完整方向可以开始 Figma 同步；失败方向保留审计记录 |
| `complete` | Figma 同步和视觉核验完成 |
| `blocked` | 需要用户处理登录、验证码、权限或其他外部阻塞 |

恢复任务时先读取已有 `run.json` 和 `figma-manifest.json`。如果本地阶段已经完成，只继续 Figma 同步，不要重新运行采集和生成。

第 6 步参考分析、第 7 步预览生成、第 8 步语义分层和第 9 步逐素材透明 PNG 提取分别拥有独立的两次尝试，每次等待最多 5 分钟。第 6 步两次失败后先跳过该方向，并在所有方向结束后再尝试 1 次；第 9 步不会嵌套进第 8 步重试而放大次数。运行开始时已有的历史失败方向会排到新方向之后，且只获得一次最终尝试。最终仍失败的方向保留在 `figma-manifest.json.failures`，当天 ChatGPT 阶段随即结束；只要存在具备有效 `preview.png`、`layers.json` 和 `decomposition-report.json` 的 `ready` 方向，状态即进入 `awaiting_figma` 并继续同步这些成功方向。登录失效、验证码、安全验证和权限问题仍会立即停止并通知用户。

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
            └── NN-layer-id.png
```

输出根目录还会维护 `reference-history.json`，长期保存已接受的 Pin ID、aHash、来源、尺寸和采集日期。每日运行会先读取该台账，再向下滚动寻找未采集内容。

- `preview.png`：完整、扁平化的最终预览。
- `spec.json`：方向构图、配色、组件和文案。
- `layers.json`：ChatGPT 输出的语义图层计划。
- `decomposition-report.json`：每个独立素材的 Alpha、边界质量、警告和限制。
- `layers/*.png`：ChatGPT 分别生成并通过质量检查的独立透明素材。

### Figma 交付规范

每个方向使用左右并排结构：

- `Preview`：左侧完整预览图。
- `Editable`：右侧可见的可编辑重建。
- `Visual Base`：锁定但隐藏，只作为核对参考，不能作为右侧可见交付。
- `Editable Elements`：通过检查的 ChatGPT 透明素材、原生文字、卡片、按钮和简单几何图层；Banner 和浮窗可包含自身背景。

弹窗右侧画布保持透明，只重构弹窗卡片、阴影、贴附主视觉和卡内元素，不还原弹窗后方的页面界面。Banner 和浮窗没有清底背景时，可使用 `spec.json.palette` 的第一个颜色作为原生背景。Figma 完成前必须逐方向截图，并检查：

- 左右两侧不是同一张扁平图。
- 没有重复 OCR、文字溢出或错误换行。
- 没有矩形闪光、假箭头、空框等畸形占位矢量。
- 主视觉没有被卡片遮罩洗白。
- 可编辑区域不是空白，且关键文字和独立素材可见。

详细流程见 [`skills/finance-creative-pipeline/references/figma-sync.md`](skills/finance-creative-pipeline/references/figma-sync.md)。

### 常用命令

```bash
npm run setup          # 打开首次登录流程
npm run test-run       # 1 张参考图、1 个方向的测试运行
npm run test-three-types # 弹窗、Banner、浮窗各 1 个的隔离验证运行
npm run test-transparent-assets -- --image /path/to/preview.png # 只测试透明素材拆分
npm run find-remix-icon -- --query "shield check" --style line # 检索 Remix Icon SVG
npm run run            # 10 张参考图、10 个方向的正式运行
npm run run -- --visible # 显式强制可见模式，可覆盖诊断用 browser.mode 配置
npm run check-missed   # 检查漏跑
npm run check          # 运行语法检查和自动化测试
```

### 安全与合规

- 不导出、共享或提交 Chrome 持久化登录目录。
- 不自动处理验证码、WAF、安全验证、付费限制或下载限制。
- 只从 Pin 详情页公开可见图片元素下载预览图，并保留列表缩略图、最终图片和 Pin 来源 URL。
- 不生成真实品牌 Logo、真实公司名称、固定收益、保证审批、监管背书或其他误导性金融承诺。
- 不将不透明、空白、跨格或质量检查失败的结果伪装成透明独立素材。
- 不提交用户配置、登录数据或每日运行产物。

普通功能图标使用 Remix Icon 4.9.1，遵循该版本随包提供的开源许可证。Remix Icon 只用于功能性或信息性图标，不用于 Logo、商标或品牌标识。

---

## English

### Overview

Finance Creative Pipeline is a Codex plugin for daily Chinese internet-finance operations creatives. It runs a resumable local workflow that:

1. Collects higher-resolution visible references from Huaban Pin detail pages through a persistent Chrome profile, preserving source URLs and dimensions.
2. Uses ChatGPT Web to analyze the references and generate one brand-neutral, complete preview per direction.
3. Creates or reuses one dated project per day and keeps preview generation, decomposition, and transparent-asset extraction for each direction in one project chat.
4. Sends each preview back in the same chat to identify complex visual elements and produce a semantic `layers.json` plan.
5. Uses a separate image task in that chat for each non-reconstructable complex visual and saves each result as its own transparent PNG.
6. Syncs previews, accepted transparent assets, and native text/geometry into Figma.

A normal run collects 10 references and generates 10 original directions: six popups, two banners, and two floating creatives, with one type-matched reference per direction.

### Design Principles

- Image generation must use ChatGPT Web. Codex image generation is not a fallback.
- Generate exactly one complete preview; never combine multiple extracted assets into one sheet or image.
- Popup directions generate only the popup body with a clean outer safety margin. They must not generate an App page, search bar, navigation, bottom tabs, page cards, or a blurred interface background.
- Only complex hero visuals, 3D objects, people, mascots, and non-reconstructable illustrations become PNG assets. Cards, buttons, ordinary icons, charts, and simple decorations stay native in Figma.
- Match ordinary functional icons against official [Remix Icon](https://remixicon.com/) SVGs first and import them as editable Figma vectors instead of hand-drawing temporary icons or using generic placeholders.
- ChatGPT must extract each selected element separately while preserving its original shape, proportions, color, lighting, and details; no Apple Vision or downloaded local matting model is used.
- Local processing only trims transparent margins and validates Alpha and image boundaries.
- Opaque, colored-background, empty, or boundary-touching assets are rejected and never uploaded to Figma.
- Each run date uses one ChatGPT project named `金融运营素材 YYYY-MM-DD`, with exactly one chat per design direction. Project and direction-chat URLs are persisted so retries and resumed runs continue the original chat instead of creating decomposition or per-asset chats.
- Project chats are explicitly renamed with type-local numbering: `弹窗1`–`弹窗6`, `Banner1`–`Banner2`, and `浮窗1`–`浮窗2`. Isolated validation runs start each included type at 1 instead of using the global direction index.
- Reference images use ChatGPT's image-specific upload input. The analysis prompt is sent only after every expected filename, image thumbnail, and send-ready state is verified. If ChatGPT reports missing images, the composer is cleared and all references are uploaded again instead of continuing without visual references.
- Resume from `run.json` and `figma-manifest.json` to avoid duplicate collection, generation, or dated Figma sections.
- Collect popup, Banner, and floating-window references from separate type-matched keyword pools and quotas. Banner queries use finance-specific terms such as `金融banner`, `理财banner`, and `投资理财banner`, favoring simple horizontal compositions. Floating references use form-specific terms such as `浮窗`, `小浮窗`, and `悬浮窗素材`, while obvious full phone screens are rejected.
- Keep accepted Pin IDs and image fingerprints in `reference-history.json`; later runs skip historical Pins and identical images and continue scrolling, without rejecting merely similar layouts.
- The Figma preview stays on the left. The right side must visibly render editable layers and must never duplicate the same flattened image.

### Requirements

- Node.js 20 or later
- Google Chrome
- An active ChatGPT Web session
- An active Huaban session
- Codex desktop with the official Figma connector enabled
- Edit access to the target Figma file

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

Login setup, tests, normal runs, scheduled runs, and resumed runs all use a visible dedicated Chrome with the persistent profile. Huaban returns HTTP 405 to headless Chrome, while the macOS background-launch mode does not reliably preserve the ChatGPT authenticated session, so the window is no longer hidden or minimized by default. CAPTCHA, security checks, and permission prompts stop the run and require user action; they are never bypassed.

Each workflow starts the dedicated Chrome at most once and prepares the Huaban, Pin-detail, and ChatGPT tabs together during startup. Every direction and retry reuses that browser session. A global single-run lock prevents duplicate schedules from opening another window, and a browser failure stops the run instead of relaunching Chrome.

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
| `browser.mode` | Browser mode; defaults to `visible`, while `background` and `headless` remain diagnostic-only alternatives |
| `figma.fileKey` | Target Figma file key |
| `figma.pageId` | Target Figma page ID |
| `collection.referenceCount` | Number of references in a normal run |
| `collection.minReferenceWidthPx` | Minimum detail-image width in pixels; defaults to 720 |
| `collection.perKeywordLimit` | Maximum accepted references from one search query |
| `collection.maxSearchScrolls` | Maximum scroll attempts used to find unseen Pins |
| `collection.maxFloatHeightToWidthRatio` | Maximum float-reference height-to-width ratio; defaults to 2 to reject full phone screens |
| `collection.searchPlans` | Type-specific quotas and queries for popup, Banner, and floating references |
| `generation.directionCount` | Number of original directions |
| `generation.analysisTimeoutMinutes` | Maximum wait per step 6 reference-analysis attempt; defaults to 5 minutes |
| `generation.analysisMaxAttempts` | Initial step 6 reference-analysis attempts; defaults to 2, followed by one queue-tail final attempt after failure |
| `generation.maxAttempts` | Total step 7 preview-generation attempts; defaults to 2 |
| `generation.imageTimeoutMinutes` | Maximum wait per image-generation attempt; defaults to 5 minutes |
| `generation.decompositionTimeoutMinutes` | Maximum wait per step 8 semantic-decomposition attempt; defaults to 5 minutes |
| `generation.decompositionMaxAttempts` | Total step 8 semantic-decomposition attempts; defaults to 2 |
| `chatgpt.dailyProjects` | Create or reuse one dated ChatGPT project per day; enabled by default |
| `chatgpt.projectNamePrefix` | Prefix for dated project names; defaults to `金融运营素材` |
| `transparentAssets.maxAssets` | Maximum non-reconstructable complex assets per direction; defaults to 4 |
| `transparentAssets.timeoutMinutes` | Maximum wait per step 9 separate-asset attempt; defaults to 5 minutes |
| `transparentAssets.maxAttempts` | Total step 9 attempts per separate asset; defaults to 2 |
| `transparentAssets.minForegroundRatio` | Minimum foreground ratio per asset |
| `transparentAssets.maxForegroundRatio` | Maximum foreground ratio per asset |
| `transparentAssets.minTransparentRatio` | Minimum transparent-pixel ratio per asset |
| `transparentAssets.maxBorderForegroundRatio` | Maximum foreground ratio along image borders |

See [`assets/config.example.json`](assets/config.example.json) for the complete example.

### Run States and Recovery

Daily artifacts are stored by default under:

```text
~/Desktop/互联网金融素材/YYYY-MM-DD/
```

The output root also contains `reference-history.json`, a persistent ledger of accepted Pin IDs, aHashes, sources, dimensions, and collection dates. Each run reads it before scrolling for unseen results.

Primary states:

| State | Meaning |
| --- | --- |
| `running` | Local collection, generation, or decomposition is active |
| `awaiting_figma` | The ChatGPT phase is over and at least one complete direction can be synced; failures remain auditable |
| `complete` | Figma sync and visual verification are complete |
| `blocked` | Login, CAPTCHA, permissions, or another external issue requires user action |

Always inspect the existing `run.json` and `figma-manifest.json` before resuming. If local generation is already complete, continue only the Figma stage.

Steps 6 through 9 each have independent two-attempt budgets with a five-minute limit per attempt. A direction that fails both step 6 attempts is skipped and appended once to the end of the queue for one final analysis attempt. Step 9 retries are not nested inside step 8 retries. Directions that were already failed at run start are processed after new directions and receive one final attempt. Remaining failures stay in `figma-manifest.json.failures`, the day's ChatGPT phase ends, and any `ready` directions with valid `preview.png`, `layers.json`, and `decomposition-report.json` continue to Figma. Login expiry, CAPTCHA, security checks, and permission issues still stop immediately and notify the user.

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
            └── NN-layer-id.png
```

- `preview.png`: complete flattened preview.
- `spec.json`: composition, palette, components, and copy.
- `layers.json`: semantic layer plan produced by ChatGPT Web.
- `decomposition-report.json`: per-asset Alpha and boundary metrics, warnings, and limitations.
- `layers/*.png`: independently generated transparent assets accepted by the quality gate.

### Figma Delivery Contract

Each direction uses a side-by-side layout:

- `Preview`: complete flattened preview on the left.
- `Editable`: visible editable reconstruction on the right.
- `Visual Base`: locked and hidden reference only; it must not be used as the visible right-side delivery.
- `Editable Elements`: accepted ChatGPT-separated transparent assets plus native text, cards, buttons, and simple geometry; Banner and float directions may include their own backgrounds.

Popup editable canvases stay transparent and reconstruct only the popup card, shadow, attached hero, and internal elements; the page behind the popup is never rebuilt. Banner and float directions may use the first color in `spec.json.palette` when no cleaned background exists. Before completion, screenshot every direction and verify:

- The left and right sides are not the same flattened image.
- OCR is not duplicated, clipped, or wrapped incorrectly.
- No malformed placeholder geometry appears as empty boxes, rectangular sparkles, or fake arrows.
- Hero artwork is not washed out by card masks.
- The editable area is nonblank and shows key text and independent assets.

See [`skills/finance-creative-pipeline/references/figma-sync.md`](skills/finance-creative-pipeline/references/figma-sync.md) for the full workflow.

### Commands

```bash
npm run setup          # Open first-login setup
npm run test-run       # Test with 1 reference and 1 direction
npm run test-three-types # Isolated validation with one popup, Banner, and float
npm run test-transparent-assets -- --image /path/to/preview.png # Test transparent separation only
npm run find-remix-icon -- --query "shield check" --style line # Search Remix Icon SVGs
npm run run            # Normal 10-reference, 10-direction run
npm run run -- --visible # Explicitly force visible mode, overriding diagnostic browser.mode settings
npm run check-missed   # Check for a missed scheduled run
npm run check          # Run syntax checks and automated tests
```

### Security and Compliance

- Never export, share, or commit the persistent Chrome profile.
- Never bypass CAPTCHA, WAF, security interstitials, paywalls, or download restrictions.
- Download only previews exposed by visible image elements on Huaban Pin detail pages, preserving the list thumbnail, selected image, and Pin source URLs.
- Do not generate real logos, real company names, fixed returns, guaranteed approvals, fabricated regulatory endorsements, or other misleading financial claims.
- Never present opaque, colored-background, empty, boundary-touching, or rejected images as valid transparent assets.
- Never commit user configuration, authentication data, or daily run artifacts.

Ordinary functional icons use Remix Icon 4.9.1 under the open-source license included with that package. Remix Icon is used only for functional or informational symbols, never as a logo, trademark, or brand identity.
