# extension

## 目的
提供 Chrome MV3 运行时与页面注入能力：在 B 站播放器上渲染“干货热力图”，并承载交互入口（跳过/搜索/导出/设置）。

## 模块概述
- **职责:**
  - content script：识别 B 站播放器 DOM、订阅播放时间、渲染热力图与控制按钮
  - service worker：统一调度（拉字幕、调用 Gemini、写入存储、消息分发）
  - UI：弹窗/侧边栏/页面内浮层（按迭代演进）
- **状态:** 🚧开发中
- **最后更新:** 2026-01-27

## 规范

### 需求: 在 B 站页面渲染热力图与跳过
**模块:** extension
在 `https://www.bilibili.com/video/*` 页面识别播放器进度条，叠加热力图，并提供“一键跳过注水”按钮。

#### 场景: 用户点击跳过
前置条件：已产生 segments 或已有历史记录
- 预期结果：若当前为注水片段，seek 到下一个干货片段开头；否则 seek 到下一个干货片段

## 依赖
- agent（生成 segments）
- memory（读取历史 segments/embedding）
