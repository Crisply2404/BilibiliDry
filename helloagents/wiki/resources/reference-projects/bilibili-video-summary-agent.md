# 参考项目拆解：bilibili-video-summary-agent

## 1. 项目定位

**一句话**：一个可发布到 npm 的 CLI 工具：输入 BV 号/链接 → 自动拉字幕（优先）/可选转录音频 → LLM 输出“摘要 + 时间戳要点” → 可选自动发到评论区。

它解决的问题更偏“自动生成评论区课代表”，而不是播放器交互体验。

## 2. 代码与工程形态（你仓库内位置）

- 项目根目录：`reference/bilibili-video-summary-agent/`
- CLI 入口：`reference/bilibili-video-summary-agent/src/index.ts`
- B站 API 客户端：`reference/bilibili-video-summary-agent/src/bilibili.ts`
- AI/ASR/摘要策略：`reference/bilibili-video-summary-agent/src/ai.ts`
- 类型：`reference/bilibili-video-summary-agent/src/types.ts`
- 测试：`reference/bilibili-video-summary-agent/test/`（Vitest）
- 构建/发布：`reference/bilibili-video-summary-agent/tsdown.config.ts`、`reference/bilibili-video-summary-agent/.releaserc.json`

## 3. 核心数据流

1) 解析输入（BV 或 URL，含分 P 参数）
2) 获取视频信息（标题、cid/aid、时长）
3) 获取字幕（优先）：
   - HTML 校验字幕 ID（用 `__INITIAL_STATE__` 抽取）以提升可靠性
   - API 拉字幕列表与字幕内容
4) 若无字幕且启用 `--transcribe`：下载音频 → 切分 → ASR 转录
5) 格式化为带时间戳的文本
6) LLM 生成摘要/要点（纯文本，含时间戳）
7) 输出到 stdout / 文件；可选发布评论（需要 Cookie）

## 4. 字幕获取与容错（对 BilibiliDry 很实用）

### 4.1 双来源校验：HTML + API

- 先请求 `https://www.bilibili.com/video/{bvid}`，从 `window.__INITIAL_STATE__` 抽取字幕 ID 列表用于校验；
- 再请求 `x/player/v2` 获取 subtitle 列表与 URL；
- 这种“交叉校验”可以显著降低因 API 返回异常/缓存导致的“拿到错误字幕”的概率。

### 4.2 字幕选择策略（中文优先）

优先级大致为：
- `ai-zh` → `zh-CN` → `zh*` → fallback 第一个

并对 subtitle_url 的 `//...` 做 `https` 补全。

## 5. 音频下载与转录（扩展外的“增强能力”）

### 5.1 音频获取

- 通过 `x/player/playurl?fnval=16` 取 DASH 音频 URL
- stream 下载到本地临时文件夹（`temp_audio` 等）

### 5.2 分片策略（解决 API 文件大小限制）

- 当音频超过阈值（例如 24MB）：
  - 用 ffmpeg 按 600 秒切片
  - 逐片转录并通过 timeOffset 叠加时间轴，保持全局时间戳正确

### 5.3 多 ASR Provider

- 优先火山语音识别（配置 `VOLC_APP_KEY`/`VOLC_ACCESS_KEY`）
- 否则走 OpenAI Whisper（`verbose_json` + segments）

> 对 BilibiliDry：即使坚持“仅字幕”，也建议在 roadmap 里保留“可选转录增强”路径（例如本地伴生服务）。

## 6. 摘要产物设计

### 6.1 输入格式

把字幕格式化为 `[mm:ss] text`，用于让 LLM 更容易输出可跳转的时间戳要点。

### 6.2 输出约束

提示词要求：
- 摘要 + 关键要点
- 带时间戳
- 适合评论区的纯文本（避免 Markdown）

## 7. 测试与发布（工程化亮点）

**测试**
- 采用 Vitest 做“可离线”的单元测试：输入解析、评论格式化等。
- 仍缺少网络层/字幕选择/转录等集成测试（常见于 CLI 项目）。

**发布**
- 语义化发布（semantic-release）自动更新 changelog/version
- 同时存在 tsdown 与 tsup 配置，可能是遗留/迁移痕迹（值得清理）

## 8. 风险点/注意事项

- CLI 版本号硬编码可能滞后于 package version（会造成用户困惑）。
- HTML 结构变更会影响 `__INITIAL_STATE__` 抽取（需做更健壮的解析/兜底）。

## 9. 可直接借鉴到 BilibiliDry 的点

- **字幕抓取的可靠性工程**：HTML 校验、重试、随机参数规避缓存。
- **分 P / 多字幕语言选择策略**：优先中文、兜底策略一致化。
- **时间戳要点产物**：你的热力图/跳过本质需要“可信的时间戳段落”，该项目的格式化思路可复用。
- **测试切入点**：对“BV/URL 解析”“字幕选择”“分段合并”等，优先补充单元测试（无需真实网络）。

