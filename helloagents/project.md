# 项目技术约定

## 技术栈
- **目标形态:** Chrome Extension (MV3)
- **语言:** TypeScript
- **UI:** React + Tailwind（当前 Demo 使用 Tailwind CDN，后续会迁移到构建期方案）
- **构建:** Vite
- **LLM:** Gemini（用户自备 API Key，扩展端直连）
- **本地存储:** `chrome.storage`（配置）+ IndexedDB（记忆/向量/视频索引）

---

## 开发约定
- **代码规范:** TypeScript strict；避免 `any`（仅在第三方边界适当使用）
- **命名约定:** 组件 PascalCase、函数/变量 camelCase、常量 SCREAMING_SNAKE_CASE
- **模块边界:** UI 与 Agent 逻辑分离（UI 不直接持有 API Key）

---

## 错误与日志
- **策略:** 用户可见错误提示 + 开发态控制台日志；不得打印/上报 API Key、字幕全文等敏感数据
- **日志级别:** `debug/info/warn/error`；生产默认关闭 debug

---

## 测试与流程
- **测试:** 关键算法（分段/跳过/相似度检索）单元测试；核心页面（B站）至少 1 条 E2E 冒烟用例
- **提交:** Conventional Commits（可选，但建议用于后续求职作品展示）

