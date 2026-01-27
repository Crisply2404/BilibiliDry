# BilibiliDry（Chrome 插件）

B 站长视频“脱水”与知识挖掘：在播放器上渲染“干货热力图”，支持一键跳过注水、Markdown 导出、跨视频搜索（本地记忆 + BYOK）。

## 核心特性（MVP）

- 仅基于 CC/字幕（不做 OCR）
- “边看边出”：字幕分块增量分析，热力图逐步更新
- 一键跳过注水（可选自动跳过）
- 导出 Markdown（复制/下载，可粘贴到 Notion）
- 跨视频搜索：关键词 + 语义检索（embedding + cosine）

## 开发与构建

**Prerequisites:** Node.js

1. 安装依赖：`npm install`

### 开发（热更新）
1. 启动开发服务器：`npm run dev`
   - 默认端口 `3000`，若被占用会自动切换到下一个可用端口（看终端输出）
2. Chrome 加载扩展：打开 `chrome://extensions` → 开启开发者模式 → “加载已解压的扩展程序” → 选择 `dist/`
3. 配置 Key：扩展菜单 → “打开设置” → 填写 Gemini API Key（仅保存在本地 `chrome.storage.local`）
4. 打开任意 `https://www.bilibili.com/video/*`，右侧会出现 BilibiliDry 浮层

> 说明：页面 UI（popup/options/content-script）支持 HMR；service worker 变更通常需要在 `chrome://extensions` 手动点击“更新/重新加载扩展”。

### 构建（发布）
1. 构建扩展：`npm run build`
2. Chrome 加载：同上，选择 `dist/`

## 目录结构（关键文件）

- `manifest.config.ts`：MV3 manifest（由 Vite 构建生成 `dist/manifest.json`）
- `src/background/`：后台（字幕抓取、Gemini 调用、IndexedDB 记忆、搜索与导出）
- `src/content-script/`：页面注入 UI（热力图/跳过/导出/搜索）
- `src/options/`：设置页（Key、分块、自动分析/自动跳过、清空记忆）
