# 技术与产品方案：对标升级的实现路径

## 1) 产出物结构（本轮）

### 文档
- 参考项目拆解：`helloagents/wiki/resources/reference-projects/`
- 对标与路线图：`helloagents/wiki/resources/bilibilidry_benchmark.md`

### 可执行任务清单
- `helloagents/plan/202601281714_reference_projects_benchmark/task.md`

## 2) BilibiliDry 目标架构（在约束下对标业界）

### 2.1 统一任务状态机（增强可恢复性）

为每个 `videoId` 维护 Job：
- `fetch_subtitle`：字幕拉取（多语言/分P/登录态/重试）
- `chunk_plan`：分块计划生成（窗口大小、hash、可跳过）
- `chunk_analyze[i]`：LLM 输出 segments（schema 校验 + 重试 + 降级）
- `embed[i]`：embedding（可暂停/预算控制/失败回退关键词）
- `materialize`：产物（heatmap/markdown/dashboard）生成与缓存

关键原则：
- **可重入**：重复触发不会重复扣费（靠 cache key 与已完成标记）
- **可恢复**：SW 休眠后可从 DB 继续
- **可取消**：用户离开页面或点击取消时停止后续任务

### 2.2 缓存键与 Prompt 版本化（对标 BibiGPT）

建议定义稳定的 cache key：
- `videoId`
- `subtitle_source`（api/html/other）与 `subtitle_version_hash`
- `chunk_window_sec`
- `llm_provider + model`
- `prompt_version`（每次改提示词递增）

用途：
- 防止“同一 chunk”重复扣费
- 支持回滚/重跑：改 prompt_version 即可重算

### 2.3 字幕获取可靠性（对标 CLI / BibiGPT）

策略组合：
- API 拉字幕（已有）
- need_login_subtitle 的 UX 引导（明确提示登录/可选 cookie）
- HTML 校验字幕 ID（提高稳定性）
- 多语言优先级统一（zh/ai-zh/zh-CN 等）
- 分 P 支持（p 参数解析、cid 对齐）

### 2.4 产物升级（对标 CLI / SummaryExpressive）

在现有 segments 的基础上增加：
- overall summary（整段总结）
- outline/chapters（章节结构）
- key takeaways（要点列表，带时间戳链接）
- glossary（关键概念/术语表）
- actions（行动项/复习题）

并提供：
- 解释性：为什么该段是 DRY/WATER（基于字幕特征/LLM 理由简述）
- 可调参：阈值/偏好（更“学习型”/更“省流型”）

### 2.5 可选增强：本机伴生服务（对标 AI-Video-Transcriber）

仅作为“增强模式”，不改变默认交付：
- 当无字幕或用户主动选择时，扩展调用 `localhost` 服务：
  - 下载音频（yt-dlp）→ ASR（Faster-Whisper）→ 返回带时间戳文本
  - 后续仍走同一套 chunk_analyze/embed/materialize

优势：
- 提供“无字幕视频兜底”
- 避免把音频上传云端（更隐私）

## 3) 工程化与质量（对标：可长期维护）

- 单元测试优先级：BV/URL 解析、字幕选择、chunk 切分、segments 合并、schema 校验、markdown 生成、检索排序
- 诊断能力：本地日志 ring buffer + 一键导出（替代服务端 Sentry）
- 发布与版本：明确版本号策略与 changelog 习惯

