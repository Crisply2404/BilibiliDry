# 大厂 Agent 开发岗 JD 分析（2026-11）

> 2026-11-26 从字节跳动、腾讯、阿里云的招聘官网和 LinkedIn（新加坡）收集了 16 条 Agent 开发岗 JD。JD 原文和逐条标签存在作者的私有资料库里，这里只放统计、解读和岗位链接；岗位可能随时下线，以官网为准。
>
> 每个能力标签都对应 JD 里的一句原话，并标明出自任职要求、职责还是加分项，下表由这些标签自动统计。样本只有 16 条，只看方向。

## 一、能力出现频率

“要求”= 写在任职要求里；“职责/加分”= 只出现在职责或加分项里（带“优先”的算加分）。

| 能力 | 出现 | 占比 | 要求 | 职责 | 加分 |
|---|---|---|---|---|---|
| 有落地项目（`shipped-project`） | 12 | 75% | 5 | 0 | 7 |
| RAG / 知识库（`rag`） | 11 | 68% | 7 | 4 | 0 |
| 工具调用（`tool-calling`） | 11 | 68% | 7 | 4 | 0 |
| 跟进前沿 / 复现论文（`research`） | 10 | 62% | 3 | 6 | 1 |
| 规划与推理（`planning`） | 9 | 56% | 5 | 4 | 0 |
| 多 Agent（`multi-agent`） | 9 | 56% | 3 | 6 | 0 |
| 可观测（`observability`） | 8 | 50% | 4 | 2 | 2 |
| 记忆（`memory`） | 8 | 50% | 3 | 5 | 0 |
| 平台与开发者工具（`platform`） | 8 | 50% | 0 | 8 | 0 |
| Agent 运行时（`harness`） | 7 | 43% | 4 | 3 | 0 |
| 上下文工程（`context-engineering`） | 6 | 37% | 5 | 1 | 0 |
| 安全与隔离（`security`） | 6 | 37% | 3 | 3 | 0 |
| 开源（`open-source`） | 6 | 37% | 1 | 0 | 5 |
| 数据闭环 / 自进化（`feedback-loop`） | 6 | 37% | 0 | 6 | 0 |
| 性能与稳定性（`performance`） | 6 | 37% | 0 | 6 | 0 |
| 分布式与云原生（`distributed-systems`） | 5 | 31% | 4 | 1 | 0 |
| Agent 框架（`agent-frameworks`） | 5 | 31% | 3 | 0 | 2 |
| 评测（`eval`） | 5 | 31% | 3 | 2 | 0 |
| 提示词工程（`prompt-engineering`） | 5 | 31% | 3 | 2 | 0 |
| AI Coding（`ai-coding`） | 4 | 25% | 3 | 0 | 1 |
| Agent 协议（`protocols`） | 4 | 25% | 2 | 1 | 1 |
| 人机协同（`human-in-the-loop`） | 4 | 25% | 1 | 3 | 0 |
| 数据工程（`data-engineering`） | 3 | 18% | 1 | 1 | 1 |
| 工程实践（`engineering-practice`） | 3 | 18% | 1 | 2 | 0 |
| 模型训练（`model-training`） | 3 | 18% | 1 | 2 | 0 |
| Agent Skills（`skills`） | 3 | 18% | 1 | 2 | 0 |
| 成本（`cost`） | 3 | 18% | 0 | 3 | 0 |
| 工作流编排（`workflow`） | 3 | 18% | 0 | 3 | 0 |
| 全栈（`fullstack`） | 2 | 12% | 2 | 0 | 0 |

## 二、解读

1. **“有落地项目”几乎人人提，但多半是加分项。** 16 条里 12 条提到，只有 5 条写进硬性要求，其余 7 条是“优先”。码良统计十家大厂的应用开发社招 JD，38% 写了要有 AI 项目或落地经验（[原文](https://x.com/cxjwin/status/2124416197055877275)），口径更硬。
2. **工具调用和 RAG 是底座。** 各 11 条，其中 7 条写在要求里，是出现在硬性要求里最多的两项能力。
3. **不少岗位是在“造 Agent 平台”。** 8 条在职责里写了要建平台、框架或组件；其中方舟（社招、校招）、豆包、TikTok Harness、腾讯 WXG、字节实习这 6 条，主要工作就是 Agent 框架、运行时或平台，不是做某个业务 Agent。投这类岗位时，项目要讲运行时、断点续跑、隔离和可观测，而不只是“接了个模型”。
4. **评测在这批 JD 里只占 5 条，但最在乎它的岗位写得最重。** TikTok Harness 校招岗要求“理解并实践过……Agent评测”，还要说明“如何验证它做得更好了”。外部的大样本统计（面试题指南引用的 426 条应用开发社招 JD）说评测提及率超过一半，所以这里的低频更可能是样本小。
5. **校招和实习另有侧重。** 6 条里上下文工程、Agent 框架、Agent 运行时都占一半，比全量更高；字节 AI Platform 校招岗把 LangChain / LangSmith 写进了硬性要求。

这批数据的已知偏差：

- 方舟的社招“Agent技术研发工程师”和校招“Agent基础系统研发工程师”几乎是同一份 JD，相关标签会被算两次。
- 腾讯“AI agent开发 - 数据产品方向”标题带 Agent，内容是数据产品，几乎不涉及 Agent 机制。
- 腾讯 WXG 那条只有职责，没有任职要求；LinkedIn 的两条是节选。

校招 JD 反复强调的三件事（主要来自 TikTok Harness 和抖音用户增长两条）：

1. **能讲清设计选择**：为什么这样设计，遇到了什么问题，怎么改进的。
2. **能证明效果**：有评测、有对照，能说明“做得更好了”是怎么验证的。
3. **有拿得出手的东西**：独立完成或长期维护的项目、代码仓库或 Demo。

更大样本的统计可以看：[AI Engineering Field Guide](https://github.com/alexeygrigorev/ai-engineering-field-guide)（9,760 条海外 AI Engineer JD）、码良的[《我数了十家大厂 4,821 个 AI 岗位》](https://x.com/cxjwin/status/2124416197055877275)和 [Agent 高频面试题](https://github.com/smartcai87/agent-interview-guide)。

## 三、BilibiliDry 对应的地方

| 标签 | BilibiliDry 里对应的东西 |
|---|---|
| `tool-calling` | 跨视频知识库 Agent 的原生 function calling：`list_videos`、`search_library`、`read_transcript`；DeepSeek 开思考时把工具调用那一轮的思考内容传回 |
| `harness` | 知识库 Agent 的工具循环（最多 6 步，最后一步强制作答）；整片分析每出一个片段就存一次，Service Worker 被杀后从断点续跑 |
| `rag` | 只用在跨视频知识库：40 秒重叠字幕窗口 + 片段摘要；`Intl.Segmenter` 中文分词 BM25，可选向量，RRF 融合 + MMR 去冗余。单视频问答实测不检索更好（见下） |
| `context-engineering` | 单视频问答把整份字幕放进上下文，放在 prompt 最前面且每次不变，连续提问命中前缀缓存（实测 83%）；字幕按 `[行号\|时间]` 喂给模型，模型只回行号 |
| `planning` | 整片分析一次调用：模型读完全片，按顺序切段、判断注水、挑重点；超长视频按上下文分窗口 |
| `eval` | 8 个真实 B 站视频、55 个问题的对照评测：分块 vs 整片分析（注水 F1 64% → 76%），检索 vs 全文问答（引用准确 59% → 76%，成本减半）；另有离线检索评测在 CI 里跑 |
| `observability` | 每次分析、每轮问答记 span 级 Trace：耗时、token、缓存命中、费用、错误 |
| `cost` | 整片分析 1 次调用替代 10 次；问答走前缀缓存；按 DeepSeek 价格（含高峰时段）算每次调用的费用 |
| `performance` | LLM 客户端超时、指数退避、遵守 Retry-After；服务商不支持 `response_format`/流式时自动降级；B 站接口限流时退回备用字幕 |
| `security` | API Key 只存本地，错误信息里打码；发布包和在线演示都扫描疑似 Key；模型服务域名按需申请权限 |
| `engineering-practice` | TypeScript strict、52 个单元测试、真实 Chromium 端到端测试、在线演示的端到端测试、GitHub Actions |
| `human-in-the-loop` | 自动跳过可撤销；分析可停止、可继续；点“停止”即取消正在进行的回答 |
| `shipped-project` | Chrome 扩展 + 在线演示（GitHub Pages）；B 站自己的 AI 总结不配 Key 也能用 |

## 四、收录的岗位

| 公司 | 岗位 | 类型 | 城市 |
|---|---|---|---|
| 字节跳动（火山引擎） | [AI Agent应用开发工程师/架构师](https://jobs.bytedance.com/experienced/position/7616302352991750453/detail) | 社招 | 杭州 |
| 字节跳动（火山方舟大模型平台） | [Agent技术研发工程师](https://jobs.bytedance.com/experienced/position/7654959567977466165/detail) | 社招 | 杭州 |
| 字节跳动（豆包） | [Agent技术研发工程师](https://jobs.bytedance.com/experienced/position/7634034954359572741/detail) | 社招 | 上海 |
| 字节跳动（AI Platform） | [Agent算法工程师](https://jobs.bytedance.com/experienced/position/7599598898747656453/detail) | 社招 | 深圳 |
| 字节跳动（火山方舟） | [Agent基础系统研发工程师](https://jobs.bytedance.com/campus/position/7669725958044518661/detail) | 校招 2027 届 | 上海、北京、杭州、深圳 |
| 字节跳动（AI Platform） | [Agent开发工程师](https://jobs.bytedance.com/campus/position/7667885791859837237/detail) | 校招 2027 届 | 上海、北京 |
| 字节跳动（TikTok算法） | [大模型Agent研发工程师（Agent Harness与平台方向）](https://jobs.bytedance.com/campus/position/7698700771944646965/detail) | 校招 2027 届 | 北京、上海 |
| 字节跳动（抖音用户增长） | [Agent研发工程师](https://jobs.bytedance.com/campus/position/7667554460750989573/detail) | 校招 2027 届 | 北京、深圳 |
| 字节跳动（计算，ByteIntern） | [AI Agent开发实习生](https://jobs.bytedance.com/campus/position/7600764543892031749/detail) | 实习 2027 届 | 上海、杭州、北京 |
| 腾讯（IEG 腾讯游戏商务部） | Agent开发工程师 | 社招 | 深圳 |
| 腾讯（WXG 微信小程序 - 小工具） | AI Agent 开发工程师 | 社招 | 广州 |
| 腾讯（IEG 腾讯游戏 - 数据产品方向） | AI agent开发 | 社招 | 深圳 |
| 阿里巴巴（ATH事业群 - 伶鹊） | [大模型Agent应用专家](https://careers.aliyun.com/off-campus/position-detail?lang=zh&positionId=100055400003) | 社招 | 杭州、北京 |
| TikTok（TikTok LIVE） | [AI Agent Engineer](https://www.linkedin.com/jobs/view/4487347184/) | 社招 | 新加坡 |
| TikTok（TikTok Shop - SEA） | [AI Agent Engineer Graduate](https://www.linkedin.com/jobs/view/4447682422/) | 校招 2027 | 新加坡 |
| 蚂蚁集团 | [AI Agent Engineer](https://www.linkedin.com/jobs/view/4485443545/) | 社招 | 新加坡 |

腾讯的三个岗位没有固定的详情页链接，在[腾讯招聘](https://careers.tencent.com/search.html?keyword=Agent%E5%BC%80%E5%8F%91)搜“Agent开发”可以找到。
