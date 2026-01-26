# notion_export

## 目的
把分析结果导出成可复用的笔记格式，MVP 先做 Markdown 复制/下载，后续再接 Notion API。

## 模块概述
- **职责:**
  - 将 `AnalysisResult`/segments/logicBlocks 渲染为 Markdown
  - 生成可点击的 B站时间戳链接
- **状态:** 📝规划中
- **最后更新:** 2026-01-27

## 规范

### 需求: Markdown 导出
**模块:** notion_export
用户点击“导出”，得到一份 Markdown（可复制或下载）。

#### 场景: 复制到 Notion
前置条件：有 analysisResult
- 预期结果：Markdown 结构清晰：摘要、要点、时间索引、参考链接

