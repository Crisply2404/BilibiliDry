# 数据模型

## 概述
方案 1 使用本地存储实现“长期记忆”和跨视频检索：
- 配置：`chrome.storage.local`
- 数据：IndexedDB（可查询、可版本迁移）

---

## IndexedDB（建议）

### 数据库
- **dbName:** `bilibilidry`
- **version:** 2

### Object Stores

#### `videos`
**描述:** 视频元信息与分析状态。

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| videoId | string | 主键 | BV号 |
| title | string |  | 标题 |
| durationSec | number |  | 时长 |
| lastAnalyzedAt | string |  | ISO 时间 |
| analysisVersion | string |  | 便于回滚/重跑 |

**索引:**
- `lastAnalyzedAt`

#### `segments`
**描述:** 时间分段 + 注水识别结果（用于热力图与跳过）。

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | string | 主键 | `${videoId}:${startTime}-${endTime}` |
| videoId | string | 索引 | BV号 |
| startTime | number | 索引 | 秒 |
| endTime | number |  | 秒 |
| type | "DRY" \| "WATER" |  | 片段类型 |
| confidence | number |  | 0-1 |
| summary | string |  | 片段摘要 |
| waterReasonType | string | 可选 | 仅 WATER：注水原因分类（SMALLTALK/REPEAT/OFFTOPIC/AD/NO_NEW_INFO） |
| waterReasonText | string | 可选 | 仅 WATER：注水原因短文案（用于可解释跳过） |
| rawText | string | 可选 | MVP 可不存（节省空间/隐私） |
| verification | object | 可选 | Reflection Gate 校验结果（verdict/evidence 等） |

**索引:**
- `videoId`
- `videoId,startTime`

#### `embeddings`
**描述:** 语义检索向量（只对 DRY 片段生成）。

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | string | 主键 | 同 segment id |
| videoId | string | 索引 | BV号 |
| startTime | number |  | 秒 |
| vector | number[] |  | embedding 向量 |
| text | string |  | 生成 embedding 的文本（摘要优先） |
| model | string |  | embedding 模型名 |

**索引:**
- `videoId`

#### `runs`
**描述:** 一次分析运行的过程指标（用于 Model Cascade 及耗时/体量对比）。

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| runId | string | 主键 | 一次分析的唯一 ID |
| videoId | string | 索引 | 视频 ID |
| startedAt | string |  | ISO 时间 |
| finishedAt | string | 可选 | ISO 时间 |
| cascadeEnabled | boolean |  | 是否启用 Model Cascade |
| provider | "openai" \| "gemini" |  | 推理提供方 |
| cheapModel | string | 可选 | cheap 阶段模型名（OpenAI-compatible） |
| strongModel | string | 可选 | strong 阶段模型名（OpenAI-compatible） |
| strongTopK | number | 可选 | strong 精炼 TopK 数 |
| metrics | array |  | 调用明细：stage/kind/modelTag/latency/requestChars/responseChars/note |

**索引:**
- `videoId`
- `videoId,startedAt`

---

## 配置（chrome.storage.local）

- `llmProvider`：`gemini` / `openai`
- `geminiApiKey`：用户 Gemini Key（仅本地；不得同步/不得日志）
- `openaiBaseUrl`：OpenAI-compatible Base URL（建议包含 `/v1`）
- `openaiApiKey`：OpenAI-compatible Key（仅本地；不得同步/不得日志）
- `openaiModel`：OpenAI-compatible 模型 ID（必填；无默认值）
- `openaiEmbeddingModel`：用于语义检索（当前版本本视频搜索不依赖 embedding；预留字段）
- `qiniuAccessKey` / `qiniuSecretKey` / `qiniuBucket` / `qiniuDomain`：七牛云配置（当前版本仅保存，不上传任何内容）
- `analysis`：
  - `chunkSec`：分块时长（如 60-120s）
  - `concurrency`：并发数（1-2）
  - `autoSkip`：是否自动跳过注水
- `cascade`（OpenAI-compatible）：
  - `enabled`：是否启用 Model Cascade
  - `cheapModel`：cheap 阶段模型（用于分块粗筛）
  - `strongModel`：strong 阶段模型（用于 TopK 精炼 + Reflection Gate）
  - `strongTopK`：strong 精炼的 DRY 段数量（建议 4-8）
- `waterFilter`：
  - `enabledTypes`：自动跳过的注水分类白名单（默认：REPEAT/NO_NEW_INFO/AD）
