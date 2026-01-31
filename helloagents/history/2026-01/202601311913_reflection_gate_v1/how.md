# 技术设计: Reflection Gate（字幕证据对齐校验）

## 技术方案

### 核心技术
- Chrome Extension MV3（现有）
- 本地存储：IndexedDB（现有 `videos/segments`）
- LLM：OpenAI-compatible（现有 `chat/completions` + JSON 输出约束回退）
- 证据来源：B 站字幕（CC）（现有 background 拉取）

### 实现要点

#### 1) 两阶段流水线（“先出结果，再校验”）
- **阶段A：分析生成（现有）**
  - 分块字幕 → LLM 产出 segments → 逐块落库 → push `ANALYSIS_UPDATE`（带增量 segments）
  - 最后一块完成后 push `ANALYSIS_DONE`
- **阶段B：Reflection Gate（新增）**
  - 选择需要校验的 TopK 干货段（默认 3~6 段）
  - 对每段构造“证据窗口字幕”（segment 时间窗前后各扩 10 秒，且限制最大字符）
  - 调用 LLM 校验接口，返回 `verdict/score/reason/evidence`
  - 将校验结果写回本地 DB，并 push 增量更新给 Overlay（Dashboard 通过刷新/后续增强自动刷新）

> 关键：用户要求“100% 就直接展示结果”。因此 Reflection Gate 绝不阻塞 `ANALYSIS_DONE`，而是作为异步后置校验阶段。

#### 2) 校验选择策略（v1）
- 仅校验 `type=DRY` 的 segments
- 按 `confidence` 排序取 TopK
- 如 TopK 不足，再补充“用户更可能点击的段”（例如更长时长段、或更接近当前播放时间段）——可选，v1 可不做

#### 3) 校验输出与自动置信度修正
- verdict：
  - `pass`：不改
  - `weak/fail`：对该段 `confidence` 乘一个系数（例如 `weak*0.7`、`fail*0.4`），并在 UI 标记“需确认”
- reason：一句话中文解释
- evidence：字幕证据片段（数组或拼接文本）

## 架构决策 ADR

### ADR-001: 校验结果存储位置（推荐：写回 segments 记录）
**上下文:** 我们需要在 Overlay 与 Dashboard 中展示校验结果，并能导出到 Markdown。  
**决策:** 将 `verification` 结果作为可选字段写回 `segments`（IndexedDB record 增量字段）。  
**理由:**
- IndexedDB 的 object store 记录可扩展字段，不需要复杂迁移
- 查询更简单：拿 segments 就能展示，不必 join 额外 store
**替代方案:** 新建 `reflections` store（segmentId 为 key）  
→ 拒绝原因: 增加 join 与一致性处理成本，v1 收益不高。  
**影响:** segments 记录会变大，需要做证据长度限制与抽样控制。

## API 设计

### Push: REFLECTION_UPDATE（新增）
用于 Overlay “增量刷新校验状态”：
- `progress`：0~1（仅反映校验阶段的进度）
- `segments`：包含更新后校验字段的 segment 列表（仅推变更段）

（也可复用 `ANALYSIS_UPDATE` 推送带校验字段的 segments；但语义上拆分更清晰。）

## 数据模型

### Segment（新增可选字段）
- `verification?: {`
  - `verdict: 'pass' | 'weak' | 'fail'`
  - `alignmentScore: number`（0~1）
  - `reason: string`
  - `evidence: string[]`（字幕证据，长度受限）
  - `checkedAt: string`
  - `modelTag: string`（例如 `openai:gpt-5.2`）
`}`

### 证据窗口构造（建议）
- 证据时间窗：`[start-10s, end+10s]` clamp 到 `[0, duration]`
- 证据长度：最大 1500~2500 字符（或 20~40 行字幕）

## 安全与性能
- **安全:**
  - BYOK：不将 key 传到自建后端
  - 日志脱敏（沿用现有 `redactSecrets`）
  - 证据只取字幕文本，不抓取用户账号信息
- **性能:**
  - 抽样 TopK，限制证据长度
  - 校验串行执行（v1 稳定优先）；后续可并发但需限流与取消支持

## 测试与验证
- **手动验证（核心）:**
  1) 分析完成后立即看到结果（100% 不回退空态）
  2) 随后出现“校验中→校验完成”的状态变化
  3) weak/fail 段显示 reason，并可展开看到证据字幕片段
  4) 导出 Markdown 包含校验标记
- **回归点:**
  - 不影响无 CC 视频的错误提示
  - 不影响本视频搜索与跳过

## 兼容性约束（按用户决策）
- 本次仅支持 `chat/completions` 路径；若 `https://right.codes/codex/v1` 不兼容，则后续再加 `/responses` fallback（不在本次范围）。

## 后续增强（不在本次执行）
- **Model Cascade（B）**：先 cheap 模型粗筛，后 strong 模型重排/总结，并在 dashboard 展示成本/耗时对比。
- **可解释注水（C）**：为 WATER 段输出 reason 分类（寒暄/重复/跑题/广告/无信息增量），并支持按类别跳过/过滤。

