# 架构设计

## 总体架构

```mermaid
flowchart TD
    U[用户在 B站视频页] --> CS[Content Script<br/>注入 UI/读取播放器状态]
    CS --> SW[Service Worker<br/>Agent 调度/LLM 调用/存储]
    SW --> G[Gemini API<br/>BYOK 直连]
    SW --> DB[(IndexedDB<br/>视频/片段/embedding)]
    CS <--> SW
    CS --> UI[页面内 UI<br/>热力图/跳过/搜索/导出]
```

---

## 技术栈
- **扩展:** Chrome MV3
- **前端:** React + TypeScript + Vite
- **数据:** IndexedDB（向量/片段索引），`chrome.storage`（配置）
- **LLM:** Gemini（用户 API Key）

---

## 核心流程

### 1) “边看边出”增量分析

```mermaid
sequenceDiagram
    participant CS as Content Script
    participant SW as Service Worker
    participant B as B站 API
    participant G as Gemini
    participant DB as IndexedDB

    CS->>B: 拉取字幕(仅CC)
    B-->>CS: 带时间戳的字幕
    CS->>SW: 发送字幕分块 + 视频元数据
    SW->>G: 低成本模型(Flash)做分段/注水识别
    G-->>SW: segments(时间段+type+confidence+摘要)
    SW->>DB: 写入 segments + 索引
    SW-->>CS: 增量更新热力图/跳过列表
```

### 2) 一键跳过注水

- Content Script 持有当前播放时间 `t`
- 查找 `t` 所在 segment；若为 `WATER`，跳到下一个 `DRY` 的 `startTime`
- 可选“自动跳过”模式：进入 `WATER` 自动 seek

### 3) 跨视频搜索（本地语义记忆）

- 对 `DRY` segments 的摘要/原文生成 embedding
- 查询时生成 query embedding，做 cosine 相似度排序（MVP 用线性扫描；后续可升级 ANN）
- 返回：视频标题 + 时间戳 + 片段摘要，支持一键跳转到播放器

---

## 重大架构决策

| adr_id | title | date | status | affected_modules | details |
|--------|-------|------|--------|------------------|---------|
| ADR-001 | 纯扩展本地化 + BYOK，不托管后端 | 2026-01-27 | ✅已采纳 | extension/agent/memory | 方案包 `helloagents/plan/202601270145_chrome_extension_mvp/how.md` |
| ADR-002 | 本地向量检索 MVP 先线性扫描 | 2026-01-27 | ✅已采纳 | memory | 同上 |

