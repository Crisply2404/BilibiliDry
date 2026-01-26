# BilibiliDry

> 本文件包含项目级别的核心信息。详细的模块文档见 `modules/` 目录。

---

## 1. 项目概述

### 目标与背景
面向 B 站长视频（网课/访谈）场景，把“信息密度”可视化到播放器进度条，并提供一键跳过注水段落、导出笔记与跨视频检索，降低用户获取干货的时间成本。

### 范围
- **范围内:**
  - Chrome 插件（MV3），在 B 站视频页工作
  - 仅依赖 CC/字幕（不做 OCR）
  - 用户自备 Gemini API Key（扩展端直连，不上传 Key 到任何后端）
  - 本地记忆：跨视频搜索（IndexedDB + embedding）
  - Notion 导出：先做 Markdown 复制/下载（不接入 Notion API）
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
| extension | MV3 运行时（content script / service worker / UI） | 📝规划中 | `modules/extension.md` |
| agent | 分段/注水识别/摘要与“边看边出”调度 | 📝规划中 | `modules/agent.md` |
| memory | 本地语义记忆（索引、embedding、检索） | 📝规划中 | `modules/memory.md` |
| notion_export | Markdown 导出（复制/下载） | 📝规划中 | `modules/notion_export.md` |
| ui | 热力图进度条、要点索引、搜索面板 | 📝规划中 | `modules/ui.md` |

---

## 3. 快速链接
- [技术约定](../project.md)
- [架构设计](arch.md)
- [API 手册](api.md)
- [数据模型](data.md)
- [变更历史](../history/index.md)
- [资源归档](resources/index.md)

