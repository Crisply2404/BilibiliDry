# agent

## 目的
把字幕转成“可执行的观看策略”：分段、注水识别、摘要与增量更新，保证“边看边出”体验。

## 模块概述
- **职责:**
  - 字幕分块（按时间窗口）
  - 注水识别输出：`segments[]`（WATER/DRY + confidence + 可解释注水原因）
  - Model Cascade（可选）：cheap 先粗筛分块，strong 再精炼 TopK 干货摘要
  - 运行指标记录：按 runId 记录耗时/体量（Dashboard 可展示对比）
  - Reflection Gate：用字幕证据校验关键干货段，对 weak/fail 自动降置信度（必要时修正时间窗）
- **状态:** 🚧开发中
- **最后更新:** 2026-02-02

## 规范

### 需求: 增量分析（边看边出）
**模块:** agent
从 0 秒开始按 chunk 分块分析，优先产出“可跳过信息”（WATER/DRY + 时间段），随后补齐摘要与 embedding。

#### 场景: 首屏 30 秒内可用
前置条件：字幕可拉取
- 预期结果：在用户打开视频后 30 秒内，热力图出现第一批结果（至少覆盖前 3-5 分钟或前 N 个 chunk）

#### 场景: Model Cascade（cheap→strong）
- cheap 阶段：分块输出 WATER/DRY + 置信度 +（WATER 的）原因分类/短文案，快速驱动热力图与跳过。
- strong 阶段：仅对 TopK DRY 片段做摘要精炼（不全量重跑），并复用 strong 模型执行 Reflection Gate 校验。

## 依赖
- extension（字幕输入、播放状态）
- memory（持久化结果、断点续跑）
