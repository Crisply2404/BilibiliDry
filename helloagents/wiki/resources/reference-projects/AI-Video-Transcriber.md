# 参考项目拆解：AI-Video-Transcriber

## 1. 项目定位

**一句话**：把「视频 URL」变成「转写稿 +（可选）翻译 + 摘要」，支持 30+ 平台，提供 Web UI、实时进度（SSE）与 Markdown 下载。

**典型用户/场景**
- 内容学习者：把长视频快速变成可检索文本与总结
- 内容生产者：把口播/直播回放变成文字稿
- 多语言场景：转写语言 ≠ 目标输出语言时自动翻译

**对 BilibiliDry 的启示**
- “从视频到文本”的闭环（下载/音频处理/ASR）是扩展侧难点；该项目展示了可自托管的实现路径（FastAPI + yt-dlp + ffmpeg + Faster-Whisper）。

## 2. 代码与工程形态（你仓库内位置）

- 项目根目录：`reference/AI-Video-Transcriber/`
- 后端：`reference/AI-Video-Transcriber/backend/main.py`（FastAPI 应用与 API）
- 启动器：`reference/AI-Video-Transcriber/start.py`（依赖检查 + uvicorn 启动；支持 `--prod`）
- 前端：`reference/AI-Video-Transcriber/static/index.html` + `reference/AI-Video-Transcriber/static/app.js`（纯静态页面）
- 部署：`reference/AI-Video-Transcriber/Dockerfile`、`reference/AI-Video-Transcriber/docker-compose.yml`
- 依赖：`reference/AI-Video-Transcriber/requirements.txt`

## 3. 技术栈与部署策略

**后端**
- FastAPI + Uvicorn
- yt-dlp：多平台下载音视频
- ffmpeg：音频转码/切分/修复
- Faster-Whisper：ASR（默认 CPU int8，默认模型 base）
- OpenAI SDK：用于“转写文本优化/翻译/摘要”

**前端**
- 纯 HTML/CSS/JS
- Marked.js 渲染 Markdown、Prism 高亮（CDN 引入）

**部署**
- Docker：镜像内安装 ffmpeg，默认 `python start.py --prod`
- docker-compose：支持 env 注入、端口映射、重启策略与内存限制

## 4. 核心数据流（端到端）

### 4.1 任务型异步流水线

该项目把“处理视频”设计为**任务**：
- 创建任务：`/api/process-video` 返回 `task_id`
- 前端监听：`/api/task-stream/{id}`（SSE）持续收到状态更新
- 兜底轮询：`/api/task-status/{id}` 用于断线后恢复
- 产出下载：`/api/download/{filename}` 提供 Markdown 文件下载

### 4.2 处理阶段（典型顺序）

1) 视频解析/下载（yt-dlp）
2) 音频规范化（ffmpeg 转单声道 16k m4a 等）
3) ASR 转写（Faster-Whisper + VAD）
4) 转写优化（LLM：错别字/补全/分段）
5) 条件翻译（当“选择的摘要语言”与“检测到的转写语言”不一致）
6) 摘要生成（LLM，可分块汇总）
7) 产物落盘（Markdown），前端下载

## 5. 关键实现点（工程与产品可用性）

### 5.1 进度体验（SSE + 前端平滑进度）
- SSE 推送真实进度；前端同时做“模拟平滑增长”，避免长任务卡在某个百分比导致用户误判。
- README 明确建议长视频用 `--prod`（关闭热重载）减少 SSE 断连。

### 5.2 大文本处理策略（成本/长度控制）
- 摘要模块对长文本走分段汇总（先 chunk summary，再合并 summary）。
- 当没有 API Key 时，摘要/优化会降级（回退到原始文本或简化摘要），保证功能可用。

### 5.3 下载安全（最基本的路径防护）
- 下载接口对文件名做白名单/路径分隔符拦截，降低路径穿越风险（仍属于轻量防护）。

## 6. 风险点与改造机会（对标时需注意）

**安全/运维**
- 默认 CORS 全开、无鉴权/限流：对公网暴露会有风险（应加网关、鉴权、速率限制）。

**数据与隐私**
- 任务与文件保存在 `temp/`；缺少自动清理策略，可能累积隐私/存储压力。

**一致性**
- 部分状态更新/删除逻辑存在“内存状态与落盘不一致”的风险（例如删除未同步保存），需要更严谨的任务持久化策略。

## 7. 可直接借鉴到 BilibiliDry 的点

在不改变 BilibiliDry “纯扩展 + BYOK”的前提下，可借鉴为：
- **可选本地伴生服务（Local Companion）**：把下载/ASR 放在本机服务（类似该项目），扩展通过 `http://localhost` 调用，避免把音频上传云端。
- **任务进度协议**：对 BilibiliDry 的“分块分析/embedding 生成”也可以做任务状态机 + 渐进式 UI（你已经做了增量更新，但可以更统一地描述状态与可恢复性）。
- **产物结构化**：Markdown/下载、分语言输出、可复用的“转写→优化→摘要”分层。

