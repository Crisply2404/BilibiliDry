# Changelog

本文件记录项目所有重要变更。
格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/),
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]
### 新增
- 参考项目拆解报告（`helloagents/wiki/resources/reference-projects/`）。
- BilibiliDry 对标报告与路线图（`helloagents/wiki/resources/bilibilidry_benchmark.md`）。
- 对标升级方案包（`helloagents/history/2026-01/202601281714_reference_projects_benchmark/`）。
- Reflection Gate：字幕证据对齐校验（pass/weak/fail）+ 自动降置信度 + UI 展示（Overlay/Dashboard）+ Markdown 导出标记。
- Overlay UI：可拖拽面板 + 悬浮球（缩小/关闭），并在刷新后提供悬浮球作为重新入口。
- BYOK：支持从 `.env.local` 自动导入 OpenAI-compatible 配置（无需在设置页重复输入）。
- Model Cascade（OpenAI-compatible）：cheap 分块粗筛 + strong TopK 干货摘要精炼（不全量重跑）。
- 可解释注水：WATER 段输出原因分类与短文案，并支持按类别配置自动跳过（默认：REPEAT/NO_NEW_INFO/AD）。
- 运行指标：新增 runs 记录（runId + metrics），Dashboard 展示 cheap/strong 的耗时/体量对比（字符数口径）。
- 开发者模式开关：在设置页“高级（开发者）”开启后，才显示 Model Cascade 指标与关键干货校验（字幕证据）面板。

### 修复
- 干货含量计算改为对 DRY 时间段取并集（避免重叠/多批 segments 导致 >100%）。
- 刷新视频页时增加“历史加载中”态，避免先闪“暂无此视频的分析记录”后再回填历史。
- 刷新历史读取改为优先解析 `bvid+cid`（`videoId`）再查本地 DB，避免只用 BV 查询导致误判“无记录”。
- 修复开发态热更新偶发“无法连接 Vite Dev Server”（Windows `localhost` 的 IPv4/IPv6 解析差异导致只监听单栈）。

### 变更
- 支持从 `.env.local` 自动启用 Model Cascade：当配置了 cheap model + strong model 时，运行时自动开启并使用这两个模型。
- 支持用 `.env.local` 的 `VITE_DEVELOPER_MODE=1` 作为“开发者模式”默认值（设置页仍可覆盖）。

## [0.1.0] - 2026-01-27

### 新增
- Chrome MV3 扩展骨架（Vite + crxjs + Tailwind）。
- B站 CC 拉取 + 分块增量分析（Gemini BYOK）。
- 页面注入浮层：热力图、一键跳过、Markdown 导出、跨视频搜索。
- 本地记忆：IndexedDB（segments/embeddings）+ cosine 语义检索（MVP）。
- 初始化 HelloAGENTS 知识库与方案包。
