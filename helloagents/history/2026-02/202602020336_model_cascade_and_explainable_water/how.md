# 实施方案：Model Cascade（B）+ 可解释注水（C）

## 1. 设计总览

### 1.1 新增能力
- **Cascade 两阶段流水线（OpenAI-compatible）**
  - Stage 1（cheap）：全量 chunk 分析，产出 segments（DRY/WATER + confidence + summary），并对 WATER 产出 reason 分类。
  - Stage 2（strong）：仅对 TopK DRY 段做精炼（summary 重写/边界微调可选/与证据对齐增强可选），并更新段落记录。
- **运行指标采集**
  - 每次 LLM 调用记录：`stage`、`model`、`latencyMs`、`requestSize`、`responseSize`、`usageTokens?`、`estimatedCost?`。
- **UI/交互**
  - Overlay：增加注水类别过滤（默认只勾选：重复/无信息增量/广告），跳过逻辑按过滤器生效。
  - Dashboard：展示两阶段耗时与用量/成本估算对比（表格/条形图均可）。

### 1.2 数据结构（建议）

#### Segment 扩展（仅对 WATER）
- `waterReasonType`: `'SMALLTALK' | 'REPEAT' | 'OFFTOPIC' | 'AD' | 'NO_NEW_INFO'`
- `waterReasonText`: `string`（<= 12 字）

#### AnalysisRun（新增记录，供 Dashboard）
按 `videoId + runId` 存储本次分析的元信息与指标汇总：
- `runId`：时间戳或 uuid
- `startedAt / finishedAt`
- `provider`：openai-compatible
- `cascadeEnabled`
- `metrics[]`：每次调用的明细（用于对比与调试）

> 注：先做“可展示的对比”即可，不强求绝对准确计费；后续再补供应商价格表/真实 usage 解析。

---

## 2. Stage 1（cheap）设计细节

### 2.1 LLM 输出格式
在现有 `analyzeCaptionChunkWithOpenAI` 的 JSON 输出基础上，扩展 WATER 段字段：
```json
{
  "segments": [
    {
      "startTime": 0,
      "endTime": 10,
      "type": "WATER",
      "confidence": 0.2,
      "summary": "寒暄",
      "waterReasonType": "SMALLTALK",
      "waterReasonText": "开场寒暄"
    }
  ]
}
```
要求：
- DRY 段不必提供 water 字段。
- WATER 的 `waterReasonText` 控制在极短，便于 UI 展示。

### 2.2 运行指标采集
在 OpenAI 请求封装层增加“计时与统计”：
- 请求前 `t0 = performance.now()`
- 请求后 `t1` 记录 `latencyMs`
- 记录 `requestChars`（system+user 拼接长度）与 `responseChars`
- 如果响应里有 `usage`：记录 token；否则留空并用字符数估算（Dashboard 备注“估算”）

---

## 3. Stage 2（strong）设计细节（只精炼 TopK）

### 3.1 触发时机
Stage 1 分析完成后（或在后台空闲时），对以下集合执行 strong 精炼：
- `TopK` DRY 段（按 confidence 排序，K 可配置，默认 6）
- 可选：低置信度但用户点击频繁段（后续迭代）

### 3.2 精炼内容
最小可落地版本（先做这个）：
- 只重写 `summary`：更贴近字幕、更短、更信息密度高
- 可选：对时间边界做微调（如果 strong 给出建议时间窗，沿用 Reflection Gate 的 repair 思路）

### 3.3 与 Reflection Gate 的关系
建议策略（最稳）：
- strong 精炼完成后，照常跑 Reflection Gate（verify→repair）对 TopK 做证据对齐校验与自动修正。
- 这样“强模型的提升”能在 UI 上形成闭环：summary 更好 + 证据更对齐。

---

## 4. Overlay：可解释注水与过滤/跳过

### 4.1 默认过滤策略（用户已选择）
默认勾选：
- `REPEAT`（重复）
- `NO_NEW_INFO`（无信息增量）
- `AD`（广告）

不默认勾选：
- `SMALLTALK`（寒暄）
- `OFFTOPIC`（跑题）

### 4.2 跳过逻辑
当播放落在 WATER 段：
- 若该段 `waterReasonType` 在勾选列表中 → seek 到下一个 DRY
- 否则 → 不自动跳（用户可手动跳）

### 4.3 展示
- 热力图 hover：显示 `waterReasonText`
- 段落卡片：显示分类 badge（可选）

---

## 5. Dashboard：耗时/成本对比展示

最小展示组件：
- 卡片 1：Stage 1（cheap）总耗时、调用次数、请求/响应体量（或 tokens）
- 卡片 2：Stage 2（strong）总耗时、调用次数、同上
- 备注：若无真实 tokens/费用，仅展示“估算”并说明口径

---

## 6. 配置与兼容性（先 OpenAI-compatible）

### 6.1 设置项（建议）
- `cascade.enabled`（默认 false）
- `cascade.cheapModel`（字符串）
- `cascade.strongModel`（字符串）
- `cascade.strongTopK`（默认 6）
- `waterFilter.defaultEnabledTypes`（默认：REPEAT/NO_NEW_INFO/AD）

### 6.2 兼容性策略
- 若用户不开启 cascade：保持现有单模型流程不变。
- 若用户开启 cascade 但 strong 模型调用失败：不影响 Stage 1 主流程，Dashboard 标注“strong 阶段失败/跳过”。

