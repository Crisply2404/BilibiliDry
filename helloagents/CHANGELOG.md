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

## [0.1.0] - 2026-01-27

### 新增
- Chrome MV3 扩展骨架（Vite + crxjs + Tailwind）。
- B站 CC 拉取 + 分块增量分析（Gemini BYOK）。
- 页面注入浮层：热力图、一键跳过、Markdown 导出、跨视频搜索。
- 本地记忆：IndexedDB（segments/embeddings）+ cosine 语义检索（MVP）。
- 初始化 HelloAGENTS 知识库与方案包。
