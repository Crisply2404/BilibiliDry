# 参考项目拆解：BibiGPT-v1

## 1. 项目定位

**一句话**：Web 端“一键总结”平台，支持 B 站/YouTube 等内容源，基于 Next.js Edge Functions + 流式输出，强调**缓存/限流/成本控制**与可观测性（Sentry）。

**典型用户/场景**
- “省流神器”：快速看懂长视频/播客/讲座核心要点
- 可扩展到网页/音频等（v1 主要聚焦 B站/YouTube）

## 2. 代码与工程形态（你仓库内位置）

- 项目根目录：`reference/BibiGPT-v1/`
- Web：Next.js（pages router）`reference/BibiGPT-v1/pages/`
- Edge API：`reference/BibiGPT-v1/pages/api/sumup.ts`
- 中间件（缓存/限流）：`reference/BibiGPT-v1/middleware.ts`
- 字幕抓取：
  - B站：`reference/BibiGPT-v1/lib/bilibili/fetchBilibiliSubtitleUrls.ts`、`reference/BibiGPT-v1/lib/bilibili/fetchBilibiliSubtitle.ts`
  - YouTube：`reference/BibiGPT-v1/lib/youtube/fetchYoutubeSubtitle.ts`
- Prompt/LLM：
  - Prompt：`reference/BibiGPT-v1/lib/openai/prompt.ts`
  - OpenAI streaming：`reference/BibiGPT-v1/lib/openai/fetchOpenAIResult.ts`
- 缓存键：`reference/BibiGPT-v1/utils/getCacheId.ts`
- 部署/可观测：`reference/BibiGPT-v1/vercel.json`、`reference/BibiGPT-v1/sentry.*.config.js`、`reference/BibiGPT-v1/Dockerfile`

## 3. 总体架构（重点：Edge + Redis）

### 3.1 流程概览

1) 前端输入 URL → 解析 videoId
2) 调 `/api/sumup`（Edge Runtime）
3) 在 Edge 侧：
   - 拉字幕/描述
   - 生成 Prompt
   - 调 OpenAI（流式）
4) 返回流式文本给前端
5) 完成后将结果写入缓存（Upstash Redis），下次命中直接返回

### 3.2 为什么这套架构“业界水平”

它把一个“看起来只是 Prompt 工程”的项目，做成了**可公网上线**的服务形态：
- 缓存避免重复扣费
- 限流防滥用
- Sentry 等可观测性
- 多环境部署（Vercel/Docker）

## 4. B站字幕抓取策略（值得对标）

**API + Cookie 登录态**
- 先通过 `x/web-interface/view` 获取 `aid/pages` 等元数据；分 P 场景需要依据 page 取对应分 P。
- 再通过 `x/player/v2` 拿到 subtitle 列表。
- 通过 `BILIBILI_SESSION_TOKEN`（SESSDATA）作为 Cookie 注入请求（否则部分视频字幕不可见/不可取）。

**字幕选择与容错**
- 优先中文（`zh-CN`）否则取第一个；
- subtitle_url 可能是 `//...` 形式，需要补全为 `https:...`。

**字幕压缩/切分**
- 使用 `reduceSubtitleTimestamp` 将字幕压缩到约 30 组，并控制每组最少句数；
- 可选拼入时间戳，增强“要点定位”能力。

## 5. LLM 调用与 Prompt（成本、长度控制是关键）

**流式调用**
- Edge 端调用 OpenAI Chat Completions，并把流式数据转发给前端。

**Prompt 参数化**
- Prompt 通过参数控制：语言、摘要长度、细节级别、是否时间戳、emoji 等。

**超长文本处理**
- 通过 `getSmallSizeTranscripts` 把字幕压到字节上限（例如 6200 bytes）；
- 牺牲部分覆盖率换取稳定性与成本可控。

## 6. 缓存与限流（对 BilibiliDry 极有启发）

**缓存键设计**
- 缓存 key 由 `videoId + outputLanguage + detailLevel + showTimestamp` 组合形成（避免不同配置互相污染）。

**middleware 前置拦截**
- 在进入 `/api/sumup` 前做：
  - 限流（按 IP/邮箱等维度；使用 Upstash fixed window）
  - 缓存命中直接返回，跳过 LLM

> BilibiliDry 虽然是“纯扩展”，但同样需要“缓存与去重”来避免重复调用模型、降低延迟与费用。

## 7. 部署与可观测（上线工程）

- Vercel：`vercel.json` 管理路由跳转、入口页等
- Sentry：客户端/服务端/Edge 三端配置，便于线上问题定位
- Docker：提供生产镜像与 compose；可用 build-time 开关禁用 Sentry

## 8. 可直接借鉴到 BilibiliDry 的点

- **缓存键与结果复用**：对同一视频同一 chunk 的分析结果做“不可变 key”（你已有增量缓存思路，可进一步规范化）。
- **限流/节流**：扩展侧对并发与请求频率做硬限制；必要时按“小时预算/日预算”做用户可见的成本控制。
- **“可观测性”替代方案**：扩展不能直接上 Sentry 也可做本地日志环形缓冲 + 一键导出诊断包（用于用户反馈）。
- **字幕抓取登录态**：对 “need_login_subtitle” 等场景要有明确 UX 引导（如何登录/如何获取字幕/如何降级）。

