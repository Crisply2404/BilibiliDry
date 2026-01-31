# 任务清单: Reflection Gate（字幕证据对齐校验）

目录: `helloagents/plan/202601311913_reflection_gate_v1/`

---

## 1. 数据结构与消息协议
- [√] 1.1 在 `types.ts` 为 `Segment` 增加可选字段 `verification`（verdict/score/reason/evidence/checkedAt/modelTag），确保旧数据兼容
- [√] 1.2 在 `src/background/db.ts` 的 `SegmentRecord` 对齐新增字段（可选），并确保 put/get 不因字段缺失报错
- [√] 1.3 在 `src/shared/messages.ts` 增加新的 push 消息 `REFLECTION_UPDATE`（或确认复用 `ANALYSIS_UPDATE`），并更新相关类型引用

## 2. LLM 校验能力（OpenAI-compatible）
- [√] 2.1 在 `src/background/openai.ts` 新增 `reflectSegmentsWithOpenAI(...)`：输入 segments + evidence，输出严格 JSON（含 verdict/score/reason/evidence）
- [√] 2.2 在 `src/background/llm.ts` 为 active LLM 暴露 `reflectSegments(...)` 能力，并生成 `modelTag`（如 `openai:gpt-5.2`）
- [√] 2.3 失败策略：校验失败不影响主结果，只记录 warning 并跳过（不引入 /responses fallback）

## 3. 分析流水线集成（先出结果，再校验）
- [√] 3.1 在 `src/background/analyze.ts`：`ANALYSIS_DONE` 之后启动 Reflection Gate（不阻塞 DONE）
- [√] 3.2 选择 TopK DRY 段并构造字幕证据窗口（±10s，限制长度），并将校验结果写回 segments（verdict/score/reason/evidence…）
- [√] 3.3 push `REFLECTION_UPDATE`（包含 progress 与增量 segments），Overlay 可实时更新 badge
- [√] 3.4 置信度修正：weak/fail 自动下调 confidence（写回 DB + push）

## 4. Overlay 可视化（可解释）
- [√] 4.1 在 `src/content-script/overlayApp.tsx` 订阅并处理 `REFLECTION_UPDATE`，将校验字段合并到当前 segments
- [√] 4.2 在 `components/PluginView.tsx` 增加 “校验状态”展示（例如：已校验 x/y；weak/fail 数量）
- [√] 4.3 为 Top 干货段提供可展开卡片：显示 verdict 与 reason，展开展示 evidence 字幕片段

## 5. Dashboard 展示与导出
- [√] 5.1 在 `components/DashboardView.tsx` 增加 “校验结果”区域（同 Overlay：列表+展开证据）
- [√] 5.2 在 `src/background/markdown.ts` 导出的 Markdown 中加入校验标记（例如 ✅/⚠️ + reason），并在证据段落中附上字幕片段（可选）

## 6. 安全检查
- [√] 6.1 安全检查：证据文本长度限制、日志脱敏、避免把 key/证据写入不受控位置（仅 local DB）

## 7. 文档更新（用于面试叙事）
- [√] 7.1 更新 `helloagents/wiki/overview.md`：新增 Reflection Gate 卖点、demo 讲解点、与“降低幻觉率”对应关系

## 8. 验证清单
- [?] 8.1 手动回归：分析到 100% 立即展示结果；随后校验结果渐进出现；weak/fail 可展开证据；导出包含标记
- [X] 8.2 Dev 下验证 `https://right.codes/codex/v1` + `gpt-5.2`（按 `.env.local` 配置）能跑通 `chat/completions`

---

## 任务状态符号
- `[ ]` 待执行
- `[√]` 已完成
- `[X]` 执行失败
- `[-]` 已跳过
- `[?]` 待确认
