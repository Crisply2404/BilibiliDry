# BilibiliDry

> 本文件包含项目级别的核心信息。详细的模块文档见 `modules/` 目录。

---

## 1. 项目概述

### 目标与背景
面向 B 站长视频（网课/访谈）场景，把“信息密度”可视化到播放器进度条，并提供一键跳过注水段落、导出笔记与本视频搜索，降低用户获取干货的时间成本。

### 范围
- **范围内:**
  - Chrome 插件（MV3），在 B 站视频页工作
  - 仅依赖 CC/字幕（不做 OCR）
  - BYOK：用户自备 OpenAI-compatible / Gemini Key（扩展端直连，不上传 Key 到任何后端；支持从 `.env.local` 自动导入）
  - 本视频搜索：语义重排优先，失败回退关键词（不依赖 embedding）
  - Notion 导出：先做 Markdown 复制/下载（不接入 Notion API）
  - Reflection Gate：分析完成后抽样校验关键干货段（字幕证据对齐），对 weak/fail 自动降置信度（证据面板仅“开发者模式”可见）
  - Model Cascade（可选）：cheap 模型先粗筛分块，strong 模型仅精炼 TopK 干货摘要（指标面板仅“开发者模式”可见）
  - 可解释注水：WATER 段输出原因分类与短文案，并支持按类别配置自动跳过（默认保守）
  - 开发者模式：可在设置页“高级（开发者）”开启；也支持通过 `.env.local` 的 `VITE_DEVELOPER_MODE=1` 作为默认值
- **范围外:**
  - 无字幕视频的 OCR（后续可做增量）
  - 托管后端 / 统一推理路由（与“用户只装扩展 + BYOK”冲突）
  - 账号体系/云同步（默认本地）

### 干系人
- **负责人:** 你（Owner）+ Codex（协作开发）

---

## 2. 模块索引

| 模块名称 | 职责 | 状态 | 文档 |
|---------|------|------|------|
| extension | MV3 运行时（content script / service worker / UI） | 🚧开发中 | `modules/extension.md` |
| agent | 分段/注水识别/摘要与“边看边出”调度 | 🚧开发中 | `modules/agent.md` |
| memory | 本地记忆/跨视频检索（预留，暂不启用 embedding） | 💤预留 | `modules/memory.md` |
| notion_export | Markdown 导出（复制/下载） | 🚧开发中 | `modules/notion_export.md` |
| ui | 热力图进度条、跳过、搜索面板 | 🚧开发中 | `modules/ui.md` |

---

## 3. 快速链接
- [技术约定](../project.md)
- [架构设计](arch.md)
- [API 手册](api.md)
- [数据模型](data.md)
- [开发历程与踩坑复盘](dev_journey.md)
- [变更历史](../history/index.md)
- [资源归档](resources/index.md)
