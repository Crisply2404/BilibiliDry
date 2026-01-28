# 参考项目拆解（reference/）

本目录汇总了 `reference/` 下（排除原型 `bilibilidry0`）的对标项目拆解报告，并给出 BilibiliDry 的对标路线与落地方案。

## 报告列表

- [AI-Video-Transcriber](AI-Video-Transcriber.md)：多平台下载 + Faster-Whisper 转写 + 摘要/翻译（Web + FastAPI + SSE + Docker）
- [BibiGPT-v1](BibiGPT-v1.md)：Web 端一键总结（Next.js Edge + Upstash 缓存/限流 + B站/YouTube 字幕抓取 + 流式输出）
- [bilibili-video-summary-agent](bilibili-video-summary-agent.md)：CLI 工具（字幕优先 + 可选转录 + 时间戳要点 + 可选自动发评论）
- [SummaryExpressive](SummaryExpressive.md)：Android BYOK 应用（多 Provider + 分享即摘要 + 历史搜索 + 隐私政策）
- [VideoAgent](VideoAgent.md)：多模态 Agent 框架（意图→工具→图编排→反思闭环）

## 对标与方案

- `helloagents/wiki/resources/bilibilidry_benchmark.md`：BilibiliDry 对标这些项目的差距分析、目标能力与“业界水平”路线图（产品/工程/质量/合规）

