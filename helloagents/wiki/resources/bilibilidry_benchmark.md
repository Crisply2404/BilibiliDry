# BilibiliDry 对标报告：对齐业界水平的差距分析与路线图

## 0. 对标对象与结论摘要

本报告对标 `reference/` 中 5 个项目（排除 `bilibilidry0`）：
- AI-Video-Transcriber：下载/ASR/摘要一体化（自托管 Web）
- BibiGPT-v1：可公网运营的“一键总结”Web 服务（缓存/限流/可观测）
- bilibili-video-summary-agent：高可靠字幕/转录/时间戳要点的 CLI 工具（可发评论）
- SummaryExpressive：移动端 BYOK 摘要产品（多 Provider、分享即摘要、历史搜索、隐私）
- VideoAgent：多代理编排框架（意图→工具→图→反思）

**结论（一句话）**：BilibiliDry 的“播放器内热力图 + 跳过注水 + 本地记忆检索”差异化很强；要达到“业界水平”，关键在于把 **可靠性（字幕/任务恢复）**、**成本/性能（缓存/去重/预算）**、**产品化（入口/历史/解释性）**、**工程化（测试/观测/发布）** 做到可规模化维护。

---

## 1. BilibiliDry 当前能力基线（来自现有代码与 wiki）

定位：Chrome MV3 扩展，在 B站视频页渲染热力图，支持跳过注水、Markdown 导出、跨视频搜索（IndexedDB + embedding），BYOK 支持 Gemini 与 OpenAI-compatible。

关键现状来源：
- `README.md`
- `helloagents/wiki/overview.md`
- `helloagents/wiki/arch.md`
- `helloagents/wiki/data.md`
- 代码：`src/background/*`、`src/content-script/*`

---

## 2. 对标维度矩阵（能力项 → 业界实现 → BilibiliDry 差距）

### 2.1 内容获取与可用性（字幕/登录态/兜底）

**业界做法**
- BibiGPT / CLI：字幕接口 + 登录态（SESSDATA）+ 容错重试；必要时 HTML 校验字幕 ID；支持分 P。
- AI-Video-Transcriber：不依赖字幕，直接走下载 + ASR（更强兜底）。

**BilibiliDry 差距**
- 对 “need_login_subtitle / 字幕为空 / CORS 失败 / 分 P / 多语言字幕选择” 的容错与 UX 引导需要更系统化。
- 仅字幕策略意味着“无字幕视频”无法服务，需要明确产品策略（保持范围外 or 提供可选增强）。

### 2.2 长任务稳定性（MV3 SW 休眠/断线/恢复）

**业界做法**
- AI-Video-Transcriber：任务化 + SSE；可恢复查询；生产模式强调稳定连接。
- VideoAgent：任务编排 + 失败重试 + 反思闭环。

**BilibiliDry 差距**
- “分块增量”已具备雏形，但需要更明确的：任务状态机、断点续跑协议、失败重试策略、后台唤醒/保活方案（例如 offscreen document）。

### 2.3 成本控制（缓存/去重/预算/限流）

**业界做法**
- BibiGPT：Redis 缓存 + middleware 前置拦截 + rate limit + key 选择策略。
- CLI：参数优先级清晰；可选转录以成本可控的方式增强。

**BilibiliDry 差距**
- 需要把“同一视频同一 chunk”的结果缓存逻辑做成不可变 cache key 与可视化成本/预算开关；
- 需要更严格的并发/重试/退避策略，避免误触发导致大量扣费。

### 2.4 产物形态（摘要、时间戳要点、可解释性）

**业界做法**
- CLI：输出“时间戳要点”直接可复用（评论区/笔记）。
- SummaryExpressive：支持多内容类型的统一摘要，提供历史与复制/朗读等。

**BilibiliDry 差距**
- 目前重点是 heatmap/segment summary；建议补齐：整体摘要、章节结构、关键概念表、术语/结论抽取等“高阶笔记产物”。
- “为什么判为注水/干货”的解释性与可调参（阈值/偏好）可提升信任。

### 2.5 产品化入口（触发方式、历史/搜索、跨端）

**业界做法**
- SummaryExpressive：分享即摘要、文本选中即摘要、历史可搜索可管理。
- BibiGPT：Web 链接输入 + 直接分享结果。

**BilibiliDry 差距**
- 除播放器浮层外，可加“右键/快捷键/选中字幕/复制文本”快速触发（类似移动端 share sheet 思路）。
- Dashboard/历史能力可进一步产品化：按视频、日期、标签、主题过滤；一键导出/清空；可生成“学习回顾”。

### 2.6 工程化（测试、CI、发布、可观测）

**业界做法**
- CLI：Vitest 单测起步。
- BibiGPT：Sentry、CI、语义化发布。

**BilibiliDry 差距**
- 缺少最小单测（解析、分块、合并、检索排序、markdown 生成、schema 校验）。
- 缺少“诊断/日志导出”用于用户反馈定位（扩展无法轻易接入服务端观测）。

---

## 3. 建议的“业界水平”目标架构（保持 BYOK + 纯扩展为主）

### 3.1 双路径架构：纯字幕 MVP + 可选增强

**Path A（默认）**：纯扩展字幕分析（继续保持当前定位）
- 字幕拉取（含登录态/多语言/分 P）→ 分块 → LLM segments → 缓存 → UI 增量更新 → 本地记忆

**Path B（可选增强）**：本机伴生服务（Local Companion）
- 当无字幕/字幕不可访问/用户选择更高质量时：
  - 扩展 → `localhost` 服务 → 下载/ASR（Faster-Whisper）→ 返回带时间戳文本 → 继续走同样的分块/摘要/记忆链路

这样可把 AI-Video-Transcriber 的“ASR 兜底能力”以可选方式嫁接进来，且不破坏 BYOK（伴生服务也可 BYOK 或纯本地）。

### 3.2 “任务状态机 + 可恢复协议”

为每个 `videoId` 建立统一任务状态：
- `subtitle_fetch`、`chunk_analyze[n]`、`embedding[n]`、`export_ready`
- 每个步骤可重试、可跳过已完成、可取消
- UI 展示清晰的进度与失败原因（以及用户可操作项）

### 3.3 “缓存键规范 + 成本预算”

参考 BibiGPT：
- 定义不可变 cache key：`videoId + subtitleVersion + chunkWindow + modelTag + promptVersion`
- 建立本地预算：每小时/每天最大请求数、最大并发、最大 token 估算
- 当预算触发时：自动降级（仅 heuristic/仅关键词检索/暂停 embedding）

---

## 4. 路线图（建议按阶段交付）

### 阶段 1：可靠性与可恢复（“像产品一样稳定”）
- 字幕抓取增强：分 P、语言选择、need_login_subtitle 引导、HTML 校验字幕 ID（可参考 CLI）
- 任务状态机：断点续跑、失败重试、取消
- schema 校验与自动修复：LLM 输出 JSON 严格校验，失败重试/降级

### 阶段 2：成本/性能与体验（“像服务一样可控”）
- cache key 规范化 + UI 成本提示（本地统计）
- 并发/退避/重试策略系统化
- 本地检索从线性扫描升级到可选 ANN（数据量增长后）

### 阶段 3：产物升级（“像笔记工具一样好用”）
- 生成“整体摘要 + 章节结构 + 关键概念/术语表 + TODO/行动项”
- 对干货/注水提供解释与可调参（阈值/偏好）
- Dashboard 历史页增强：过滤、标签、导出、回顾

### 阶段 4：可选增强与生态（“从 B站到更多内容源”）
- 可选本机伴生服务：无字幕视频的 ASR 兜底
- 更多内容源（可选）：网页文章、播客、YouTube（参考 BibiGPT/AI-Video-Transcriber）

---

## 5. 落地方案（已生成可执行方案包）

详见：`helloagents/plan/202601281714_reference_projects_benchmark/`

