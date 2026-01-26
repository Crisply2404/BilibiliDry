# 数据模型

## 概述
方案 1 使用本地存储实现“长期记忆”和跨视频检索：
- 配置：`chrome.storage.local`
- 数据：IndexedDB（可查询、可版本迁移）

---

## IndexedDB（建议）

### 数据库
- **dbName:** `bilibilidry`
- **version:** 1

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
| rawText | string | 可选 | MVP 可不存（节省空间/隐私） |

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

---

## 配置（chrome.storage.local）

- `geminiApiKey`：用户 API Key（仅本地；不得同步/不得日志）
- `analysis`：
  - `chunkSec`：分块时长（如 60-120s）
  - `concurrency`：并发数（1-2）
  - `autoSkip`：是否自动跳过注水

