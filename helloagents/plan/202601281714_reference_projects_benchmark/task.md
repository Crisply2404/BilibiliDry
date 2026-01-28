# 任务清单：对标升级（业界水平路线）

> 说明：本任务清单以“阶段交付 + 可验收”为导向；每项都建议带上 `prompt_version` 与可回滚点。

---

## 阶段 0：对标报告与路线图（已完成）
- [x] 输出 5 个参考项目的详细拆解报告（见 `helloagents/wiki/resources/reference-projects/`）
- [x] 输出 BilibiliDry 对标报告与分阶段路线图（见 `helloagents/wiki/resources/bilibilidry_benchmark.md`）

---

## 阶段 1：字幕获取可靠性与 UX（高优先级）
- [ ] 分 P 支持：解析 `?p=` 并确保 `cid` 对齐；对多 P 显示选择器或默认 p=1
- [ ] 字幕语言选择策略统一：`ai-zh`/`zh-CN`/`zh*`/fallback；允许用户设置偏好语言
- [ ] need_login_subtitle 明确引导：解释原因、给出可选方案（登录/提供 cookie/降级）
- [ ] HTML 校验字幕 ID：在 API 返回异常/空列表时用页面 `__INITIAL_STATE__` 做校验/兜底（注意结构变更与降级）
- [ ] 字幕抓取的重试/退避：统一封装 fetch（重试次数、抖动、错误分类）

**验收**
- 覆盖：公开视频/需登录字幕/多语言字幕/分 P 视频四类样例，均有明确可用结果或可解释失败。

---

## 阶段 2：任务状态机与可恢复（MV3 长任务稳定性）
- [ ] 为 `videoId` 建立 Job 状态机（fetch/chunk/analyze/embed/materialize），落入 IndexedDB
- [ ] chunk 的不可变 key：`videoId + subtitle_hash + chunk_window + model + prompt_version`
- [ ] 断点续跑：页面刷新/关掉再打开后可继续，不重复扣费
- [ ] 失败重试：LLM 输出不合法 JSON 时自动重试（最多 N 次），仍失败则降级 heuristic
- [ ] 可取消：用户点击取消后停止后续任务并释放资源
- [ ] （可选）offscreen 文档：减少 SW 休眠对长任务的影响

**验收**
- 在长视频上模拟：SW 重启/页面刷新后继续跑；重复触发不重复请求同一 chunk。

---

## 阶段 3：成本/性能控制（缓存、预算、降级）
- [ ] 缓存策略：segments/embedding/markdown 都按 cache key 存储并复用
- [ ] 并发控制：对 LLM/embedding 并发上限 + 队列
- [ ] 本地预算：每小时/每天最大请求数与 token 估算；触发后提示并自动降级
- [ ] 降级策略：仅关键词检索、仅 heuristic 注水识别、仅导出字幕等

**验收**
- 用户可在设置页看到“已用/剩余预算”；触发预算时不会继续扣费且 UI 有明确提示。

---

## 阶段 4：产物升级（更像“笔记工具”）
- [ ] 生成整体摘要 + 章节结构 + 要点列表（带时间戳链接）
- [ ] 关键概念/术语表（可用于跨视频检索）
- [ ] 解释性：DRY/WATER 判定理由简述（可选开关）
- [ ] Dashboard 历史增强：过滤/标签/导出/回顾

**验收**
- 同一视频可导出结构化 Markdown，并能在 dashboard 按标签/关键词快速定位。

---

## 阶段 5（可选增强）：本机伴生服务（无字幕兜底）
- [ ] 设计扩展 ↔ localhost 通信协议（任务创建/进度/结果）
- [ ] 实现本地服务的下载/ASR（复用 AI-Video-Transcriber 思路）
- [ ] 安全策略：仅监听 localhost、鉴权 token、明确权限与数据清理
- [ ] 与扩展任务状态机对齐：ASR 输出当作“字幕源”接入后续分析

**验收**
- 无字幕视频在开启增强模式时可生成时间戳文本并完成后续热力图/导出/检索闭环。

