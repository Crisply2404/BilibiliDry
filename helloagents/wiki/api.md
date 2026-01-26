# API 手册

## 概述
本项目没有对外 HTTP API（方案 1：纯扩展本地化）。本文件记录扩展内部“消息 API”（content script / service worker / UI）与数据契约，便于工程化与测试。

---

## 认证方式
- **Gemini Key:** 用户在扩展设置页填写，存放于 `chrome.storage.local`（仅扩展可读写）
- **禁止:** Key 通过 DOM 注入到页面环境、写入日志、写入 IndexedDB

---

## 接口列表

### runtime messaging

#### `GET_VIDEO_CONTEXT`
**描述:** 获取当前视频的基础信息（BV号、标题、cid、时长、字幕可用性等）。

**请求:**
```json
{ "type": "GET_VIDEO_CONTEXT" }
```

**响应:**
```json
{
  "videoId": "BVxxxx",
  "title": "xxx",
  "durationSec": 1234,
  "hasCC": true
}
```

#### `START_INCREMENTAL_ANALYSIS`
**描述:** 启动增量分析（可重复调用，用于断点续跑/刷新）。

**请求:**
```json
{ "type": "START_INCREMENTAL_ANALYSIS", "videoId": "BVxxxx" }
```

**响应:**
```json
{ "status": "started" }
```

#### `ANALYSIS_UPDATE`
**描述:** 后台推送增量结果（segments/进度/错误）。

**响应:**
```json
{
  "type": "ANALYSIS_UPDATE",
  "videoId": "BVxxxx",
  "progress": 0.4,
  "segments": [{ "startTime": 0, "endTime": 30, "type": "WATER", "confidence": 0.1, "summary": "..." }]
}
```

#### `EXPORT_MARKDOWN`
**描述:** 导出当前视频的 Markdown 笔记（复制/下载）。

**请求:**
```json
{ "type": "EXPORT_MARKDOWN", "videoId": "BVxxxx" }
```

**响应:**
```json
{ "markdown": "# ...", "filename": "BVxxxx.md" }
```

#### `SEARCH_QUERY`
**描述:** 跨视频语义搜索。

**请求:**
```json
{ "type": "SEARCH_QUERY", "query": "RSC 序列化是什么", "topK": 5 }
```

**响应:**
```json
{
  "results": [
    { "videoId": "BVxxxx", "title": "xxx", "startTime": 180, "score": 0.83, "snippet": "..." }
  ]
}
```

