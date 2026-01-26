# 任务清单: Chrome 插件 MVP（纯扩展本地化）

目录: `helloagents/history/2026-01/202601270145_chrome_extension_mvp/`

---

## 1. 工程化：从 Demo 到 MV3 扩展
- [√] 1.1 设计目录结构（`src/background` / `src/content-script` / `src/options` / `src/popup`），明确 content script / service worker / UI 页面边界，验证 why.md#需求-边看边出-低等待
- [√] 1.2 新增 MV3 manifest（`manifest.config.ts` → 构建产物 `dist/manifest.json`，权限最小化），验证 why.md#需求-一键跳过注水片段-用户边看边跳过
- [√] 1.3 搭建 message 总线与类型契约（`src/shared/messages.ts`），验证 why.md#需求-跨视频搜索-学过的内容回忆

## 2. 字幕获取（仅 CC）
- [√] 2.1 在 content script 中解析页面拿到 `bvid`（URL），`cid/aid/title/duration` 由后台接口补齐，验证 why.md#需求-边看边出（低等待）-首屏快速可用
- [√] 2.2 在 service worker 中拉取字幕文件并解析为时间戳文本片段（`src/background/bilibili.ts`），验证 why.md#需求-边看边出（低等待）-首屏快速可用
- [√] 2.3 错误与回退：无字幕/接口失败提示，验证 why.md#需求-边看边出（低等待）-首屏快速可用

## 3. Agent：增量分析与注水识别
- [√] 3.1 定义 `Chunk` 与 `Segment` 合并规则（ID 去重 + 增量覆盖；支持断点续跑跳过已完成 chunk），验证 why.md#需求-边看边出（低等待）-首屏快速可用
- [√] 3.2 实现 Flash 模型 prompt + JSON schema 输出（segments 优先），验证 why.md#需求-一键跳过注水片段-用户边看边跳过
- [√] 3.3 增量更新 UI：热力图与跳过列表随结果流式更新，验证 why.md#需求-边看边出（低等待）-首屏快速可用

## 4. 一键跳过注水（核心闭环）
- [√] 4.1 注入浮层按钮并实现 seek（next DRY），验证 why.md#需求-一键跳过注水片段-用户边看边跳过
- [√] 4.2 增加“自动跳过”开关（设置页配置 + 页面轮询），验证 why.md#需求-一键跳过注水片段-用户边看边跳过

## 5. 本地记忆与跨视频搜索
- [√] 5.1 建立 IndexedDB schema（videos/segments/embeddings），验证 why.md#需求-跨视频搜索-学过的内容回忆
- [√] 5.2 接入 embedding 生成与缓存（仅 DRY，基于 segment.summary），验证 why.md#需求-跨视频搜索-学过的内容回忆
- [√] 5.3 实现 query embedding + cosine Top-K + 跳转（失败回退 keyword），验证 why.md#需求-跨视频搜索-学过的内容回忆

## 6. Markdown 导出（Notion 前置）
- [√] 6.1 实现 Markdown 生成器（摘要/要点/时间索引/链接），验证 why.md#需求-Notion 导出（Markdown）-复制到-notion
- [√] 6.2 UI：复制 + 下载（当前不做复杂预览），验证 why.md#需求-Notion 导出（Markdown）-复制到-notion

## 7. 安全检查
- [√] 7.1 安全检查：API Key 仅在 `chrome.storage.local`；content script 不读取 Key；不落日志/不注入 DOM；host/permissions 最小化

## 8. 文档更新
- [√] 8.1 更新 `helloagents/wiki/*`（模块状态与接口/数据一致），同步 README 与 Changelog

## 9. 测试
- [-] 9.1 单元测试：按用户请求本轮先不做（后续补）
- [-] 9.2 冒烟流程：按用户请求本轮先不做（后续补）

## 10. 求职交付（1 周投递）
- [-] 10.1 按用户请求本轮先不做（后续补）
- [-] 10.2 按用户请求本轮先不做（后续补）
