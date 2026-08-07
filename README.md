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

1. 使用持久化 Chrome 从花瓣详情页采集高分辨率可见参考图，并保留来源链接和尺寸信息。
2. 将每个方向的参考图只上传一次，让 ChatGPT 网页版在内部理解后直接生成一张品牌中性的完整预览图，不输出中间分析或提示词。
3. 每天创建或复用一个日期项目，每个方向只使用一个项目内聊天；该方向的生图、语义拆图和必要的复杂框架补全都在同一聊天完成。
4. 在同一聊天中直接要求 ChatGPT 基于刚生成的预览图识别复杂视觉元素并生成语义化 `layers.json`，不重复上传预览图。
5. 按 80% 原生还原阈值优先从完整预览的源像素提取复杂视觉；大面积框架包含文字或按钮、无法直接分离时，由 ChatGPT 去字并补全遮挡区域。
6. 将预览图、通过检查的透明独立素材和原生文字/几何图层同步到 Figma。

默认正式运行会采集 10 张参考图并生成 10 个原创方向：6 个弹窗、2 个 Banner、2 个浮窗，每个方向使用 1 张同类型参考图。

### 核心原则

- 图片生成必须使用 ChatGPT 网页版，不以 Codex 图片生成作为替代。
- 每个方向生成一张完整预览图；不可原生重建的复杂素材从预览源像素分别提取为独立 PNG，不生成多元素素材板。
- 弹窗方向只生成弹窗本体与干净的外部安全留白，不生成 App 页面、搜索栏、导航栏、底部 Tab、页面卡片或虚化界面背景。
- 以 80% 原生还原阈值决定拆图；复杂主视觉、3D物体、人物、吉祥物、渐变折面、立体徽章、红包外壳和复杂插画低于阈值时逐元素拆分，真正简单的卡片、按钮、普通图标、图表和装饰才由 Figma 原生重构。
- 普通功能图标优先从 [Remix Icon](https://remixicon.com/) 匹配官方 SVG，并以可编辑矢量导入 Figma；不再手绘临时图标或使用无语义占位形状。
- 参考图用于确定主视觉类别、材质气质、颜色关系和信息层级；可保留相近的金融主体（如红包或相近权益材质），同时重设计具体造型细节、文案和局部排布，避免完整照搬。
- 透明素材优先使用本地背景差分从最终预览中直接抠取。大面积复杂框架包含多个内部图层时，才在同一聊天中让 ChatGPT 去字并补全；报告会明确区分源像素与 GPT 补全素材。视觉上连成一体的复杂主视觉仍作为一个整体。
- 拆图回复以最新完整且非空的 `DECOMPOSE_START` / `DECOMPOSE_END` 标记 JSON 为完成信号，不依赖单一消息选择器或停止按钮。恢复与重试前先扫描已有聊天，发现完整结果就立即保存，不重复提交。
- 本地只裁掉透明空白并执行 Alpha 与边界质量检查，不会推断前景蒙版。
- 紧裁或贴边的小素材会保留并记录警告，不再仅因主体占比高而丢弃。空图、无法获得可用 Alpha 或没有可恢复主体的素材仍会被拒绝；单个失败不会阻止后续素材，部分成功方向可以继续。
- 每个运行日期只使用一个名为 `金融运营素材 YYYY-MM-DD` 的 ChatGPT 项目。候选内容审核聊天 `采集筛选-弹窗/Banner/浮窗` 和正式方向聊天都保存在该日期项目内；每个设计方向仍只使用一个聊天完成直接生图和拆图。
- 项目内聊天会显式命名为 `弹窗1` 至 `弹窗6`、`Banner1` 至 `Banner2`、`浮窗1` 至 `浮窗2`；编号在各素材类型内独立计算，验证运行中的每个类型从 1 开始。
- 参考图使用 ChatGPT 图片专用上传控件；只有该方向 1 张附件的文件名、缩略图和发送状态全部验证通过后，才在同一条消息中要求 ChatGPT 内部理解参考图并直接生图。正常成功路径只上传 1 次，不请求中间分析、设计规格或可见提示词；普通生图重试复用聊天中的参考图，只有 ChatGPT 明确表示未收到图片时才重新上传。
- 流水线从 `run.json` 和 `figma-manifest.json` 恢复，避免重复采集、重复生成和重复创建 Figma 日期分区。
- 每次运行固定使用花瓣作为参考图来源。
- 参考图按类型采集：弹窗、Banner、浮窗分别使用匹配的关键词池和数量配额，不混用搜索词。搜索词负责方向，尺寸和透明度负责基础过滤，ChatGPT Web 根据图片实际内容做最终判断；浮窗允许金融 3D 素材、插图、红包、金币、徽章或元素加按钮，花瓣标题只用于快速排除明确写着背景、模板、完整页面或其他行业的候选。
- 每个缺失方向最多扫描 30 个未见 Pin，每个关键词最多取 3 个候选，最多临时下载 8 张；候选按每批最多 3 张放入当天项目中的类型筛选聊天，降低 ChatGPT 附件额度消耗。只有同时通过类型、完整成品、金融相关和最低 60 分的图片才会正式进入 `references/`；结构和可用性作为软性参考信号。数字、`元`、`¥/$/%`、金币、优惠券、仪表盘、红包、利息或息费都算金融相关线索，失败临时文件会删除并记录审核原因。
- 弹窗和 Banner 保留默认 720px 最低宽度，Banner 继续要求宽高比至少 1.5；浮窗不使用宽度、高宽比或 Alpha 门槛，只要是可识别的金融单元素或元素加按钮即可进入看图审核。模糊标题、文件名和 `IMG_*` 不再直接淘汰。
- `reference-history.json` 长期记录已采集的花瓣 Pin，并通过图片指纹排除同一图片。
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

每次工作流最多启动一次专用 Chrome，并在启动阶段一次性准备选定来源的搜索页、Pin 详情页和 ChatGPT 标签页。所有方向和重试均复用该浏览器会话。

先运行小规模测试：

```bash
npm run test-run
```

只验证 1 张弹窗参考图采集，成功后立即停止，不进入生图、拆图或 Figma：

```bash
npm run test-popup-collection
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
| `collection.source` | 采集来源固定为 `huaban` |
| `collection.referenceCount` | 正式运行采集的参考图数量 |
| `collection.minReferenceWidthPx` | 弹窗和 Banner 详情图的最低像素宽度，默认 720；浮窗不使用此门槛 |
| `collection.maxScannedCandidatesPerDirection` | 每个缺失方向最多浏览的 Pin 数，默认 30 |
| `collection.maxCandidatesPerKeyword` | 每次搜索词轮换最多取得的候选数，默认 3 |
| `collection.maxDownloadedCandidatesPerDirection` | 每个缺失方向最多临时下载并验证的图片数，默认 8 |
| `collection.visualReviewBatchSize` | 单次 ChatGPT 内容审核最多附件数，默认 3 |
| `collection.visualReviewTimeoutMinutes` | 单次候选内容审核等待上限，默认 2 分钟 |
| `collection.visualReviewMaxAttempts` | 每批候选内容审核总尝试次数，默认 2 |
| `collection.visualReviewMinimumScore` | 候选图片内容审核最低分，默认 60 |
| `collection.maxSearchScrolls` | 为寻找未采集 Pin 执行的最大滚动次数 |
| `collection.searchPlans` | 弹窗、Banner、浮窗各自的配额和搜索词列表 |
| `generation.directionCount` | 原创方向数量 |
| `generation.maxAttempts` | 预览生成总尝试次数，默认 2 |
| `generation.imageTimeoutMinutes` | 单次生图等待上限，默认 5 分钟 |
| `generation.decompositionTimeoutMinutes` | 语义分层单次等待上限，默认 5 分钟 |
| `generation.decompositionMaxAttempts` | 语义分层总尝试次数，默认 2 |
| `chatgpt.dailyProjects` | 是否每天创建或复用一个 ChatGPT 日期项目，默认开启 |
| `chatgpt.projectNamePrefix` | 日期项目前缀，默认 `金融运营素材` |
| `transparentAssets.maxAssets` | 单方向最多拆出的复杂视觉素材数，默认 8 |
| `transparentAssets.maxReconstructedAssets` | 单方向最多由 ChatGPT 去字补全的复杂框架数，默认 2 |
| `transparentAssets.allowTightCrop` | 是否保留主体占比高或贴边的小素材并记录警告，默认开启 |
| `transparentAssets.reconstructionAreaThreshold` | 触发大面积复合框架补全的归一化面积阈值，默认 0.22 |
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
| `collection_complete` | 仅采集测试已成功完成；生图、拆图和 Figma 均未开始 |
| `collection_incomplete` | 仅采集测试未找到足量合格参考图；后续阶段未开始 |
| `awaiting_figma` | ChatGPT 阶段结束，至少一个完整方向可以开始 Figma 同步；失败方向保留审计记录 |
| `complete` | Figma 同步和视觉核验完成 |
| `blocked` | 需要用户处理登录、验证码、权限或其他外部阻塞 |

恢复任务时先读取已有 `run.json` 和 `figma-manifest.json`。如果本地阶段已经完成，只继续 Figma 同步，不要重新运行采集和生成。

参考采集先执行内容审核：每个缺失方向最多扫描 30 个候选、临时下载 8 张，每批最多 4 张且最多提交两次。直接预览生成、语义分层和逐素材透明 PNG 提取分别拥有独立的两次尝试，每次等待最多 5 分钟。最终失败方向保留在 `figma-manifest.json.failures`；只要存在完整 `ready` 方向，仍进入 `awaiting_figma` 并继续同步成功方向。登录失效、验证码、安全验证和权限问题会立即停止并通知用户。

### 输出结构

```text
YYYY-MM-DD/
├── run.json
├── figma-manifest.json
├── reference-rejections.json
├── reference-audit-chats.json
├── reference-audits/
├── references/
└── directions/
    └── 01/
        ├── preview.png
        ├── spec.json（仅旧版运行可能存在）
        ├── layers.json
        └── layers/
            ├── decomposition-report.json
            └── NN-layer-id.png
```

输出根目录还会维护 `reference-history.json` 和 `reference-rejections.json`：前者长期保存已接受的 Pin ID、aHash、来源、尺寸和采集日期；后者保存因标题或视觉结构不符合类型而拒绝的 Pin 及具体原因。每日运行会跳过两类历史记录并继续向下检索。恢复旧运行时，若某个 `ready` 方向引用的素材在重新审计后进入当天拒绝台账，只让该方向失效并使用新合格参考重新生成；其他完整方向继续复用。

- `preview.png`：完整、扁平化的最终预览。
- `spec.json`：仅用于兼容旧版运行；新方向不再生成中间设计规格。
- `layers.json`：ChatGPT 输出的语义图层计划。
- `decomposition-report.json`：每个独立素材的 Alpha、边界质量、警告和限制。
- `layers/*.png`：通过质量检查的源像素素材或明确标记来源的 GPT 去字补全素材。

### Figma 交付规范

每个方向使用左右并排结构：

- `Preview`：左侧完整预览图。
- `Editable`：右侧可见的可编辑重建。
- `Visual Base`：锁定但隐藏，只作为核对参考，不能作为右侧可见交付。
- `Editable Elements`：通过检查的源像素/GPT 补全透明素材、原生文字、卡片、按钮和简单几何图层；保留 raster 已包含的图层会通过 `suppressesLayerIds` 跳过，避免重复。

弹窗右侧画布保持透明，只重构弹窗卡片、阴影、贴附主视觉和卡内元素，不还原弹窗后方的页面界面。Banner 和浮窗从 `layers.json` 的背景图层读取原生背景；旧版方向可使用 `spec.json.palette` 作为补充回退。Figma 完成前必须逐方向截图，并检查：

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

1. Collects higher-resolution visible references from Huaban through a persistent Chrome profile, preserving source URLs and dimensions.
2. Uploads each direction reference once and asks ChatGPT Web to understand it internally and directly generate one brand-neutral, complete preview without exposing an intermediate analysis or prompt.
3. Creates or reuses one dated project per day and keeps preview generation, decomposition, and transparent-asset extraction for each direction in one project chat.
4. Uses the just-generated preview in the same chat, without re-uploading it on the normal path, to identify complex visual elements and produce a semantic `layers.json` plan.
5. Extracts complex visuals from preview source pixels first, and uses ChatGPT in the same direction chat to remove overlays and complete only large composite frames that cannot be separated directly.
6. Syncs previews, accepted transparent assets, and native text/geometry into Figma.

A normal run collects 10 references and generates 10 original directions: six popups, two banners, and two floating creatives, with one type-matched reference per direction.

### Design Principles

- Image generation must use ChatGPT Web. Codex image generation is not a fallback.
- Generate exactly one complete preview; never combine multiple extracted assets into one sheet or image.
- Popup directions generate only the popup body with a clean outer safety margin. They must not generate an App page, search bar, navigation, bottom tabs, page cards, or a blurred interface background.
- Use an 80% native-fidelity threshold: complex hero visuals, 3D objects, people, mascots, gradient folds, embossed badges, envelope shells, and non-reconstructable illustrations below the threshold become separate PNG assets. Truly simple cards, buttons, ordinary icons, charts, and decorations stay native in Figma.
- Match ordinary functional icons against official [Remix Icon](https://remixicon.com/) SVGs first and import them as editable Figma vectors instead of hand-drawing temporary icons or using generic placeholders.
- References provide the visual category, material feel, color relationship, and information hierarchy. Generated work may retain a similar financial subject while redesigning concrete shape details, copy, and local layout instead of copying the full design.
- Transparent assets use local source-pixel matting first. Large composite frames that enclose editable overlays may use a provenance-marked ChatGPT reconstruction fallback in the same chat. Visually connected hero objects stay grouped as one asset.
- Semantic decomposition completes as soon as the newest non-empty `DECOMPOSE_START` / `DECOMPOSE_END` JSON block is available. It does not depend on one assistant-message selector or the stop control disappearing, and resume/retry paths consume an existing complete response before submitting again.
- Local processing only trims transparent margins and validates Alpha and image boundaries.
- Tight or boundary-touching small assets are retained with warnings. Empty assets and assets without recoverable Alpha remain rejected; one failure no longer blocks later assets, and partially usable directions may continue.
- Each run date uses one ChatGPT project named `金融运营素材 YYYY-MM-DD`. The `采集筛选-弹窗/Banner/浮窗` content-audit chats and every direction-generation chat stay inside that dated project. Each design direction still uses exactly one chat for direct generation and decomposition.
- Project chats are explicitly renamed with type-local numbering: `弹窗1`–`弹窗6`, `Banner1`–`Banner2`, and `浮窗1`–`浮窗2`. Isolated validation runs start each included type at 1 instead of using the global direction index.
- Reference images use ChatGPT's image-specific upload input. After the expected filename, rendered thumbnail, and send-ready state are verified, the same message asks ChatGPT to understand the reference internally and directly generate the preview. The normal successful path uploads once and produces no intermediate analysis, design spec, or visible image prompt. Ordinary generation retries reuse the reference already present in the chat; re-upload occurs only when ChatGPT explicitly reports the reference missing.
- Resume from `run.json` and `figma-manifest.json` to avoid duplicate collection, generation, or dated Figma sections.
- Use Huaban as the sole reference provider for every run.
- Collect popup, Banner, and floating references from separate type-matched keyword pools. Queries establish discovery direction, technical checks enforce dimensions where applicable, and ChatGPT Web makes the final decision from actual image content. Floating references may be standalone finance 3D assets, illustrations, red envelopes, coins, badges, or an asset-plus-button composition. Titles only hard-reject candidates that explicitly describe backgrounds, templates, full pages, or unrelated industries.
- For each missing direction, scan up to 30 unseen Pins, rotate after at most three candidates per query, and temporarily download up to eight images. Review up to three attachments per batch in the dated project's type-specific audit chat to reduce attachment quota consumption. Accept only images that pass type match, complete-design, finance relevance, and the default score threshold of 60; treat structure and usability as soft signals. Arabic numerals, `元`, `¥/$/%`, coins, coupons, dashboards, red envelopes, and interest or fee wording all count as finance-relevant signals, then delete rejected temporary files after recording the evidence.
- Popup and Banner references retain the 720 px minimum-width gate, and Banners retain an aspect ratio of at least 1.5. Floating references have no width, aspect-ratio, or Alpha gate at collection time; opaque standalone subjects proceed to later ChatGPT transparent extraction. Ambiguous titles, filenames, and `IMG_*` labels proceed to image-content review instead of being rejected.
- Keep Huaban Pin IDs and image fingerprints in `reference-history.json` to avoid collecting the same image again.
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

Each workflow starts the dedicated Chrome at most once and prepares the selected source search, Pin-detail, and ChatGPT tabs together. Every direction and retry reuses that browser session.

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
| `collection.source` | Collection provider, fixed as `huaban` |
| `collection.referenceCount` | Number of references in a normal run |
| `collection.minReferenceWidthPx` | Minimum detail-image width for popup and Banner references; defaults to 720 and does not apply to floats |
| `collection.maxScannedCandidatesPerDirection` | Maximum Pins browsed per missing direction; defaults to 30 |
| `collection.maxCandidatesPerKeyword` | Maximum candidates taken before rotating a query; defaults to 3 |
| `collection.maxDownloadedCandidatesPerDirection` | Maximum temporary downloads per missing direction; defaults to 8 |
| `collection.visualReviewBatchSize` | Maximum images in one ChatGPT content-audit batch; defaults to 3 |
| `collection.visualReviewTimeoutMinutes` | Maximum wait for one content-audit response; defaults to 2 minutes |
| `collection.visualReviewMaxAttempts` | Content-audit attempts per batch; defaults to 2 |
| `collection.visualReviewMinimumScore` | Minimum image-content score; defaults to 60 |
| `collection.maxSearchScrolls` | Maximum scroll attempts used to find unseen Pins |
| `collection.searchPlans` | Type-specific quotas and queries for popup, Banner, and floating references |
| `generation.directionCount` | Number of original directions |
| `generation.maxAttempts` | Total preview-generation attempts; defaults to 2 |
| `generation.imageTimeoutMinutes` | Maximum wait per image-generation attempt; defaults to 5 minutes |
| `generation.decompositionTimeoutMinutes` | Maximum wait per semantic-decomposition attempt; defaults to 5 minutes |
| `generation.decompositionMaxAttempts` | Total semantic-decomposition attempts; defaults to 2 |
| `chatgpt.dailyProjects` | Create or reuse one dated ChatGPT project per day; enabled by default |
| `chatgpt.projectNamePrefix` | Prefix for dated project names; defaults to `金融运营素材` |
| `transparentAssets.maxAssets` | Maximum non-reconstructable complex assets per direction; defaults to 4 |
| `transparentAssets.maxReconstructedAssets` | Maximum large composite assets reconstructed by ChatGPT per direction; defaults to 2 |
| `transparentAssets.allowTightCrop` | Retain tightly cropped small assets with warnings; enabled by default |
| `transparentAssets.reconstructionAreaThreshold` | Normalized area threshold for composite-frame reconstruction; defaults to 0.22 |
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

Reference collection scans at most 30 Pins and temporarily downloads at most eight images per missing direction. Content-audit batches contain at most four images and receive two submission attempts. Steps 6 through 9 retain independent two-attempt budgets with a five-minute limit per attempt. Remaining failures stay in `figma-manifest.json.failures`, while valid `ready` directions continue to Figma. Login expiry, CAPTCHA, security checks, and permission issues still stop immediately and notify the user.

### Output Layout

```text
YYYY-MM-DD/
├── run.json
├── figma-manifest.json
├── reference-rejections.json
├── reference-audit-chats.json
├── reference-audits/
├── references/
└── directions/
    └── 01/
        ├── preview.png
        ├── spec.json (legacy runs only)
        ├── layers.json
        └── layers/
            ├── decomposition-report.json
            └── NN-layer-id.png
```

- `preview.png`: complete flattened preview.
- `spec.json`: legacy-run compatibility only; new directions do not create an intermediate design spec.
- `layers.json`: semantic layer plan produced by ChatGPT Web.
- `decomposition-report.json`: per-asset Alpha and boundary metrics, warnings, and limitations.
- `layers/*.png`: independently generated transparent assets accepted by the quality gate.

The output root also keeps `reference-history.json` for accepted references and `reference-rejections.json` for content-rejected Pins and their audit reasons. Both ledgers are used to avoid repeating unsuitable results. On resume, a ready direction whose source was newly rejected by the daily re-audit is selectively regenerated with its replacement reference; unrelated complete directions remain reusable.

### Figma Delivery Contract

Each direction uses a side-by-side layout:

- `Preview`: complete flattened preview on the left.
- `Editable`: visible editable reconstruction on the right.
- `Visual Base`: locked and hidden reference only; it must not be used as the visible right-side delivery.
- `Editable Elements`: accepted source-pixel or provenance-marked reconstructed assets plus native text, cards, buttons, and simple geometry. IDs listed in `suppressesLayerIds` are skipped to prevent duplicates.

Popup editable canvases stay transparent and reconstruct only the popup card, shadow, attached hero, and internal elements; the page behind the popup is never rebuilt. Banner and float directions derive native backgrounds from the background layer in `layers.json`; legacy directions may use `spec.json.palette` only as a fallback. Before completion, screenshot every direction and verify:

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
- Never present empty, unrecoverable, or rejected images as valid transparent assets. Tight crops remain visible as warnings, and reconstructed assets must retain explicit provenance.
- Never commit user configuration, authentication data, or daily run artifacts.

Ordinary functional icons use Remix Icon 4.9.1 under the open-source license included with that package. Remix Icon is used only for functional or informational symbols, never as a logo, trademark, or brand identity.
