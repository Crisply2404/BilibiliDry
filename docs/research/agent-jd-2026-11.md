# 大厂 Agent 开发岗 JD 汇总（2026-11）

> 采集时间：2026-11-26（北京时间）。来源：字节跳动招聘官网（社招 + 校招）、腾讯招聘官网、阿里云招聘官网、LinkedIn（新加坡地区）。
> 正文按官网原文摘录「职位描述 / 职位要求」，略去公司介绍、福利与平等就业声明。岗位可能随时下线，以链接为准。

## 目录

- [一、要求共性：这些 JD 到底在考什么](#一要求共性这些-jd-到底在考什么)
- [二、对 BilibiliDry 的启发](#二对-bilibilidry-的启发)
- [三、字节跳动](#三字节跳动)
- [四、腾讯](#四腾讯)
- [五、阿里巴巴 / 阿里云](#五阿里巴巴--阿里云)
- [六、LinkedIn（新加坡）](#六linkedin新加坡)

---

## 一、要求共性：这些 JD 到底在考什么

把下面 16 个岗位的要求拆成关键词后，出现频率从高到低：

| 能力 | 出现岗位数 | JD 里的原话举例 |
|---|---|---|
| 工具调用 / Function Calling / MCP | 13 | “熟悉工具调用、上下文管理、长程执行”（方舟）；“通过 API、SDK、MCP 等方式建设稳定、可复用的连接能力”（腾讯 IEG） |
| RAG / 知识库 / 检索 | 12 | “优化检索、RAG 和上下文组织”（TikTok Harness）；“熟悉 RAG 全链路技术细节”（阿里伶鹊） |
| 记忆机制（Memory） | 10 | “了解 Memory 机制、RAG、工具调用、规划执行”（豆包） |
| 评测 / Benchmark / 回归 | 8 | “衡量任务成功率、结果质量、执行效率和成本，通过运行轨迹与失败案例分析推动持续迭代”（TikTok Harness） |
| 上下文工程 / 长任务 Harness / 异常恢复 | 8 | “长任务 Harness 构建”（豆包）；“异常恢复及人机协同机制建设”（TikTok） |
| 可观测性（Tracing、日志、成本） | 6 | “自动化评测、回归测试、Tracing、日志监控和反馈闭环”（腾讯 IEG） |
| 规划 / 任务拆解 / Multi-Agent | 9 | “ReAct/PlanAct/CodeAct、Multi-Agent”（AI Platform） |
| 人机交互：进度反馈、用户确认、中断、恢复 | 3 | “做好任务过程反馈、用户确认、人工介入和异常处理”（抖音用户增长） |
| 工程化：测试、CI/CD、灰度、安全 | 6 | “CI/CD、自动化测试、灰度发布、故障恢复、权限控制”（腾讯 IEG） |
| 多模型统一接入、高可用、成本 | 4 | “在准确率、响应延迟、成本控制之间寻找最优解”（阿里伶鹊） |
| 有可展示的独立 Agent 项目 / 开源 | 7 | “欢迎在简历中附上项目、代码仓库或 Demo……你如何验证它做得更好了”（TikTok Harness） |

校招岗位反复强调的三件事：

1. **能讲清设计选择**：为什么这样切块、为什么这样召回、为什么这样校验。
2. **能证明效果**：有评测集、有指标、有对照实验，而不是“我感觉好用”。
3. **有人真的在用**：独立完成或长期维护的项目、开源项目、完整产品实践。

## 二、对 BilibiliDry 的启发

| JD 要求 | BilibiliDry 重构后对应的模块 |
|---|---|
| Agent Loop + Function Calling | 「问这个视频」Agent：ReAct 循环，工具有 `search_transcript`、`read_transcript`、`get_outline`、`search_library`，回答必须带可点击的时间戳引用 |
| RAG 全链路 | 字幕滑窗切块 → BM25（`Intl.Segmenter` 中文分词）+ 向量召回 → RRF 融合 → MMR 去冗余 → 可选 LLM 重排 |
| Memory | 跨视频知识库（本地 IndexedDB）：所有分析过的视频可被 Agent 检索；每个视频保留对话记忆 |
| 评测体系 | `npm run eval`：带标注的字幕样例，算检索 Recall@k / MRR / nDCG、注水识别 F1、引用落地率；CI 里跑不需要 Key 的部分 |
| 可观测性 | 每次分析、每轮问答都记 Trace（LLM 调用、工具调用、耗时、token、费用），开发者模式可查看 |
| 长任务 Harness / 异常恢复 | 分析任务按块持久化、断点续跑；LLM 调用统一做超时、指数退避重试、结构化输出校验与修复 |
| 多模型统一接入 | 统一的 OpenAI 兼容客户端 + 预设（DeepSeek、通义千问、Kimi、智谱、硅基流动、OpenRouter、Gemini、Ollama） |
| 工程化 | Vitest 单测、TypeScript strict、GitHub Actions（类型检查 + 测试 + 构建 + 打包 zip） |

---

## 三、字节跳动

### 1. AI Agent应用开发工程师/架构师 - 火山引擎（社招，杭州）

- 链接：https://jobs.bytedance.com/experienced/position/7616302352991750453/detail
- 职位 ID：A127692B

**职位描述**

1、负责Agent应用的整体架构设计与核心功能开发，包括大模型适配、记忆库、知识库、Skills等核心模块；
2、基于业务场景需求，设计并实现Agent的任务规划、逻辑推理、决策执行等核心能力，提升智能体自主解决复杂问题的能力；
3、负责Agent应用的性能优化与稳定性保障，包括响应延迟优化、并发能力提升、错误容灾机制设计等；
4、集成记忆库、知识库、Skills等核心技术，沉淀通用Agent开发框架、组件库与技术解决方案，支撑业务快速落地；
5、跟踪Agent领域前沿技术动态，调研最新的智能体架构与技术，落地到业务场景中提升产品技术竞争力；
6、与产品、算法等团队紧密协作，推动AI Agent产品从需求到上线的全流程落地，持续迭代优化产品体验与业务价值。

**职位要求**

1、本科及以上学历，计算机、软件工程、人工智能、数学等相关专业；
2、2年以上后端开发或AI应用开发经验，有Agent项目开发经验者优先；
3、熟悉大语言模型基本原理、能力边界与应用场景，对AI技术探索有强烈兴趣，学习能力强；
4、良好的团队协作能力与沟通能力，能够跨团队推动项目落地；
5、熟练掌握Python/Go/Node.js至少一门编程语言，有良好的编码习惯与工程能力。

### 2. Agent技术研发工程师 - 火山方舟大模型平台（社招，杭州）

- 链接：https://jobs.bytedance.com/experienced/position/7654959567977466165/detail
- 职位 ID：A158269A

**职位描述**

1、负责火山引擎-方舟平台的Agent核心系统研发，建设面向复杂任务的通用Agent基础设施能力；
2、设计并实现高可靠、可扩展的Agent运行时与执行引擎，提升Agent的执行效率、安全性和稳定性；
3、推进Agent平台能力产品化，提升开发者使用Agent技术的效率，支持更多复杂业务场景落地；
4、探索Agent方向的创新方法与技术动态，提出更先进的Agent范式，引领行业技术发展。

**职位要求**

1、熟练掌握Python/Golang/Rust/Java等至少一门语言，具备扎实的代码功底和系统设计能力，熟练使用AI Coding工具；
2、理解大模型与Agent技术原理，熟悉工具调用、上下文管理、长程执行、Self-involve等关键机制，有Agent系统落地经验者优先；
3、熟悉云原生、分布式系统、任务调度、可观测性、资源隔离、网络访问控制等基础技术，有企业级平台或基础设施系统研发经验者优先；
4、对AI原生应用有强烈热情，关注前沿技术发展，具备快速复现论文及工程化能力，论文或开源项目贡献者优先。

### 3. Agent技术研发工程师 - 豆包（社招，上海）

- 链接：https://jobs.bytedance.com/experienced/position/7634034954359572741/detail
- 职位 ID：A254286A

**职位描述**

1、负责豆包办公与生产力方向的Agent技术研发，包括通用复杂任务的通用Agent架构、Office工具相关的Agent解决方案等，设计Multi-Agent框架、复杂上下文管理、长任务Harness构建等；
2、探索Agent方向的创新方法与技术，提出更先进的Agent范式，引领行业技术发展；
3、设计并实现易用高效的Agent开发周边套件工具，提升开发效率，降低使用Agent技术的门槛，保障交付质量。

**职位要求**

1、熟练掌握Python/Java/Go等至少一门语言，精通计算机基础技术，有AI项目开发经验者优先；
2、对大模型有深入理解，熟悉LLM技术原理与应用方法，有Agent系统设计与实现经验；了解Memory机制、RAG、工具调用、规划执行等Agent关键技术，有相关实践经验；
3、对AI Native应用有热情，具备快速复现Paper及工程化能力，顶会论文或开源项目贡献者加分。

### 4. Agent算法工程师 - AI Platform（社招，深圳）

- 链接：https://jobs.bytedance.com/experienced/position/7599598898747656453/detail
- 职位 ID：A190164A

**职位描述**

1、负责Agent的设计与效果优化，通过Agent架构优化（工具、上下文管理、编排等）和模型优化（Agentic RL等具体任务的Post-Training），产出效果领先的Agent；
2、探索AgentArchitectures/Structures的上限，在Agent应用研究中最大程度释放模型的能力，研究Self-Evolving AI System，实现Self-Improving Agents；
3、设计和开发领先AI应用和解决方案原型，验证产品概念和需求，构建应用评估并优化Agent效果，为智能客服场景的AI应用提供领先的Agent解决方案。

**职位要求**

1、熟悉Agentic RL的方法，了解Agentic RL Infra（例如CodeRL，Reward System），熟悉模型的Post-Training训练技术，能针对特定模型能力问题进行SFT、RL训练优化；
2、精通Python的编程技能，并有构建生产应用程序的经验，具备在Linux开发环境下的开发能力，熟悉至少一种主流大模型应用框架（如LangGraph、LlamaIndex、OpenAI AgentsSDK、GoogleADK等）；
3、对大模型和Agent有较深入的理解，熟悉常见的LLM实施模式、提示工程、评估框架、检索框架等，了解Agent Architectures/Structures（Multi-Agent、Context Engineering/Mangemant、ReAct/PlanAct/CodeAct），了解Agent相关的交互协议（MCP、A2A、FunctionCall）；
4、具备技术沟通能力，能够创建可扩展的内容（文档、教程、示例代码），同时有项目管理能力和多团队协同能力；了解大模型服务生态，有AI算法相关领域技术背景、AI产品工作经验的优先。

### 5. Agent基础系统研发工程师 - 火山方舟（2027 届校招，上海/北京/杭州/深圳）

- 链接：https://jobs.bytedance.com/campus/position/7669725958044518661/detail
- 职位 ID：A135637

**职位描述**

1、负责火山引擎-方舟平台的Agent系统研发，建设面向复杂任务的通用Agent基础设施能力；
2、设计并实现高可靠、可扩展的Agent运行时与执行引擎，提升Agent的执行效率、安全性和稳定性；
3、推进Agent平台能力产品化，提升开发者使用Agent技术的效率，支持更多复杂业务场景落地；
4、探索Agent方向的创新方法与技术动态，提出更先进的Agent范式，引领行业技术发展。

**职位要求**

1、2027届获得本科及以上学历；
2、熟练掌握Python/Golang/Rust/Java等至少一门语言，具备扎实的代码功底和系统设计能力，熟练使用AI Coding工具；
3、理解大模型与Agent技术原理，熟悉工具调用、上下文管理、长程执行、Self-Involve等关键机制，有Agent系统落地经验者优先；
4、熟悉云原生、分布式系统、任务调度、可观测性、资源隔离、网络访问控制等基础技术，有企业级平台或基础设施系统研发经验者优先；
5、对AI原生应用有强烈热情，关注前沿技术发展，具备快速复现论文及工程化能力，顶会论文或开源项目贡献者优先。

### 6. Agent开发工程师 - AI Platform（2027 届校招，上海/北京）

- 链接：https://jobs.bytedance.com/campus/position/7667885791859837237/detail
- 职位 ID：A04133

**职位描述**

1、基于业务场景核心诉求，主导Agent架构设计、深度迭代与落地，适配复杂业务需求，解决Agent工程化落地的核心痛点；
2、设计并落地Agent自进化全链路体系，构建自主反思、迭代优化的闭环能力，实现Agent基于业务反馈的持续能力升级；
3、打磨Agent任务拆解、推理规划、工具调用、多智能体协作等核心模块，持续优化架构性能，沉淀业务场景最佳实践；
4、跟进Agent领域前沿技术，开展自进化、多模态智能体等方向的技术预研，结合业务完成创新落地，提升核心竞争力。

**职位要求**

1、2027届获得本科及以上学历，计算机、人工智能、自动化、数学相关专业优先；
2、精通Go、Python、C++等一种或多种编程语言，具备扎实的编程技能和算法设计能力；
3、对AI Agent技术有深入了解，熟悉LangChain等框架，熟悉LangSmith等平台；
4、具备出色的团队协作精神和良好的英文阅读及沟通能力。

**加分项**

1、在LLM工程领域有落地经验；
2、对AgentOps平台熟悉，如LangSmith、Langfuse等；
3、具备优秀的研究和探索精神，对最新Agent技术趋势和论文有深入的了解。

### 7. 大模型Agent研发工程师（Agent Harness与平台方向）- TikTok算法（2027 届校招，北京/上海）

- 链接：https://jobs.bytedance.com/campus/position/7698700771944646965/detail
- 职位 ID：A00036A

**职位描述**

1、参与研发Agent Harness核心能力：参与任务规划与执行、工具调用、上下文与记忆管理、多Agent协作、异常恢复及人机协同机制建设，提升复杂任务的完成质量与可靠性；
2、构建面向研发的知识库：整合技术文档、代码和实验记录等知识，建设知识处理、索引与更新能力，优化检索、RAG和上下文组织，使Agent能够获取并使用准确、相关的知识；
3、建设Benchmark与评测体系：围绕真实研发任务构建可复现的评测基准与自动化流程，衡量任务成功率、结果质量、执行效率和成本，通过运行轨迹与失败案例分析推动持续迭代；
4、建设一站式云端Agent平台：支持Agent的开发、调试、部署与运行，完善沙箱环境、任务调度、版本管理及运行观测，提升平台的稳定性、可扩展性与开发者体验；
5、推动Agent在算法研发中落地：与推荐算法工程师合作，接入代码、数据、训练及实验分析工具，将实际研发需求沉淀为可复用的Agent能力与平台组件；
6、持续跟进Agent领域的前沿技术，主动发现有价值的问题，提出方案，通过原型开发、实验评测和用户反馈验证想法。

**职位要求**

1、2027届获得本科及以上学历，计算机、软件工程、人工智能等相关专业；
2、具备扎实的计算机基础、数据结构与算法知识，以及良好的编程能力，熟悉Python/C++等，对大模型与Agent有持续的兴趣和实际搭建经验；个人项目、课程项目、科研、开源或实习经历均可，能够清晰说明自己的设计选择、遇到的问题与改进过程；
3、理解并实践过工具调用、任务编排、上下文管理、RAG、记忆机制或Agent评测中的若干项，能够结合任务需求设计方案并验证效果；
4、有想法、积极主动、愿意动手，能够从模糊需求中发现并定义问题，拆解为可验证的假设与实验，持续推动方案落地；
5、具备良好的工程习惯和沟通协作能力，关注工具的实际使用效果，愿意通过调试、评测和用户反馈提升系统质量；
6、欢迎在简历中附上项目、代码仓库或Demo，我们期待了解：你主动解决过什么问题、如何设计和搭建Agent，以及如何验证它做得更好了。

**加分项**

1、有Agent Harness、Coding Agent、多Agent系统、知识库或自动化评测相关项目经验；
2、有开发者工具、云端平台、后端服务或开源项目建设经验；
3、了解推荐、搜索或机器学习，有召回、排序、模型训练或实验分析经验。

### 8. Agent研发工程师 - 抖音用户增长（2027 届校招，北京/深圳）

- 链接：https://jobs.bytedance.com/campus/position/7667554460750989573/detail
- 职位 ID：A84202A

**职位描述**

1、参与用户增长方向Agent产品和工具的设计、开发与优化；
2、深入理解业务场景，主动发现适合通过Agent提效或创新的机会，完成方案验证并推动落地；
3、参与模型接入、知识检索、工具调用、任务编排等Agent能力的开发；
4、探索Agent场景下的人机交互方式，做好任务过程反馈、用户确认、人工介入和异常处理；
5、关注Agent的实际使用效果，结合测试、用户反馈和问题分析持续优化产品体验。

**职位要求**

1、2027届获得本科及以上学历，计算机、软件工程、人工智能等相关专业优先；
2、具备扎实的计算机基础，熟悉数据结构、算法、计算机网络、操作系统和数据库等基础知识；
3、熟练掌握至少一门编程语言，具备良好的编程能力和代码习惯，能够快速学习并使用新的技术解决实际问题；
4、具备基本的全栈研发能力，了解前端、后端、API、数据库和鉴权等基础知识，能够独立完成完整功能的开发与联调；
5、了解大语言模型和Agent的基本原理，有Agent或大模型应用实践，能够清楚说明项目中的问题、方案和迭代过程；
6、关注Agent场景下的人机交互，能够从用户视角思考任务反馈、用户确认、执行中断和异常恢复等问题；对业务有好奇心，愿意主动发现和解决问题，具备良好的学习、沟通和团队协作能力。

**加分项**

1、有独立完成或长期维护的Agent项目；
2、使用过Agent框架、MCP或相关工具调用协议；
3、有使用AI Coding工具改善研发流程的实践；
4、有开源项目、技术比赛或完整产品实践经历；
5、对用户增长、推荐、广告或营销业务有一定了解。

### 9. AI Agent开发实习生 - 计算（ByteIntern，2027 届，上海/杭州/北京）

- 链接：https://jobs.bytedance.com/campus/position/7600764543892031749/detail
- 职位 ID：A31360A

**职位描述**

1、构建高性能、多语音版本的Agent开发框架，与Agent Infra平台协同服务用户；
2、设计并开发企业级Agent系统，涵盖多Agent协作、记忆、知识、鉴权、观测等全生命周期；
3、探索业界最新的技术或工具，如Agent Skills、OpenCode、Moltbot等应用和落地。

**职位要求**

1、2027届本科及以上学历在读，计算机、通信等相关专业；
2、掌握算法、数据结构等基础知识，至少熟练使用一门编程语言（C/C++/Python/Go/Java等）；
3、积极乐观，责任心强，工作认真细致，具有良好的团队沟通与协作能力；
4、热爱编程，有较强的学习能力，有强烈的求知欲、好奇心和进取心，能及时关注和学习业界最新技术；
5、有Agent开发、Agent框架、Agent Skills等相关经验者优先。

> 同一次搜索还看到但未展开的字节校招岗位：Agent后端开发工程师 - Aime、大模型Agent算法工程师 - Aime、Agent算法工程师 - AI for Science、大模型Agent Infra工程师 - 模型数据工程、大模型Agent研发（Agent Harness与平台方向）实习生 - TikTok算法。

---

## 四、腾讯

### 10. Agent开发工程师 - IEG 腾讯游戏商务部（社招，深圳）

- 链接：https://careers.tencent.com/search.html?keyword=Agent%E5%BC%80%E5%8F%91 （搜索结果第 1 条，更新于 2026-09-03）

**岗位职责**

1.负责部门 Agent 产品研发，与业务、Agent 产品及运营团队紧密合作，将业务需求转化为可实现、可验证、可量化的技术方案，承担架构设计、前后端开发、测试、部署及持续迭代的完整闭环。
2.负责 Agent 核心能力建设，包括企业知识库、RAG、记忆系统、工具调用、业务 Agent、MCP，以及 Multi-Agent 与人机协作流程的设计和实施。
3.负责 Agent 与腾讯内部基础设施及产品的集成，包括模型与 Agent 平台、权限身份体系、知识库及数据平台，并通过 API、SDK、MCP等方式建设稳定、可复用的连接能力。
4.建设部门 Agent Benchmark、评测与可观测体系，通过自动化评测、回归测试、Tracing、日志监控和反馈闭环，持续优化任务成功率、生成质量、稳定性、响应速度及成本。
5.建设生产级工程与安全保障体系，包括 CI/CD、自动化测试、灰度发布、故障恢复、权限控制、操作审计和数据隔离，保障 Agent 产品安全稳定运行。

**岗位要求**

1.本科及以上学历，5 年以上软件研发经验，具备复杂系统或产品从0到1交付经验；能力和作品突出者可适当放宽。
2.熟练掌握 JavaScript/TypeScript，熟悉 React 或 Vue 中至少一种主流前端框架。熟练使用 Python、Go、Java或基于 Node.js 的服务端开发技术，熟悉 API、数据库、缓存及异步任务，具备独立全栈交付能力。
3.理解 Agent Loop、Memory、Tool Calling、RAG、MCP、Planning及 Multi-Agent 等技术，并具备实际 Agent 项目开发或生产落地经验。
4.具备良好的工程、产品和跨团队协作能力，重视代码质量、测试、可观测性、安全性及上线结果，能够熟练使用 AI Coding 工具提升研发效率。

**加分项**

生产级 Agent、开发者工具或企业知识助手的落地经验。企业知识图谱、agent/LLM评测或反馈数据闭环经验。企业数据库系统建设，多来源数据库治理经验。

### 11. 微信小程序 - AI Agent 开发工程师 - 小工具（社招，广州，WXG）

- 链接：同上搜索结果（更新于 2026-10-28，两年以上工作经验）

**岗位职责**

1.负责Agent开发框架的设计与实现，构建支持Multi-Agent的分布式架构，提供高效、可扩展的框架支撑小工具线上业务以及算法模型训练；
2.负责小工具业务以及模型训练的沙箱环境、云环境、消息链路、数据存储、账号等基础建设的架构设计；
3.负责框架的性能优化与稳定性维护，支持全链路质量建设，保障整体小工具线上业务以及训练架构高扩展、保障业务逻辑的高可用和高性能、保障线上数据的一致性；
4.协作算法团队落地算法成果，将研究成果转化为工程实现，设计并支持算法团队进行大模型/Agent分布式训练的架构，推动Agent框架在业务场景中的高效部署与迭代。

### 12. 腾讯游戏 - AI agent开发 - 数据产品方向（深圳，IEG）

- 链接：同上搜索结果（更新于 2026-09-14）

**岗位职责**

1.参与开发部门内数据产品，推进数据分析、数据管理与数据应用平台的功能迭代与工程落地；
2.负责业务场景下数据产品的开发与优化，包括但不限于数据采集、数据处理、数据分析、数据可视化及数据应用等产品的数据能力建设与工作流整合；
3.持续调研数据产品、数据分析及 AI+Data 等领域的前沿技术，探索数据智能、自动化分析、指标体系、数据资产管理等方向的应用，并评估可行性推动落地；
4.与用研及业务团队协作，理解业务需求和数据使用场景，负责数据产品的方案设计与技术实现，将数据能力深度融入业务工作流，提升数据获取、分析与决策效率。

> 腾讯校招站（join.qq.com）的岗位按大类发布，不支持按 “Agent” 关键词检索，本次未收录。

---

## 五、阿里巴巴 / 阿里云

### 13. ATH事业群 - 大模型Agent应用专家 - 伶鹊（社招，杭州/北京）

- 链接：https://careers.aliyun.com/off-campus/position-detail?lang=zh&positionId=100055400003

**职位描述**

1. 核心架构设计：参与通义晓蜜下一代企业级对话Agent的技术架构设计，在准确率、响应延迟、成本控制之间寻找最优解，制定具备行业竞争力的技术方案。
2. 对话Agent工程化落地：负责对话Agent运行时的架构设计与开发，包括但不限于提示词工程、记忆、规划、工具调用以及复杂任务编排。
3. 高可用系统建设：针对大模型应用特有的长尾延迟和高并发挑战，优化系统吞吐与稳定性；主导代码Review，通过全链路调试与优化，确保线上服务的高可靠性。
4. 数据闭环建设：参与构建“人机协作”的数据反馈机制，通过线上数据回流反哺Agent能力的持续迭代。
5. 前沿技术跟踪与ConvAI规划，持续追踪业界ConvAI、Agentic Rag、Multi-modal Interaction（多模态交互）等前沿技术动态。

**职位要求**

1. 扎实的工程底座： 精通Java开发，深入理解分布式系统设计原理；熟练掌握MySQL、Redis、ES、MQ、Spring Boot/Cloud等常用中间件及框架，具备高并发系统构建经验。
2. 大模型应用架构能力：深刻理解LLM原理（Transformer、Attention机制等），熟悉RAG（检索增强生成）全链路技术细节。熟悉主流大模型应用开发框架（如LangChain、Semantic Kernel等）者优先。
3. 架构演进思维： 具备优秀的抽象建模能力，能设计出满足未来2-3年业务演进（从单一Bot到多Agent协作）的系统架构；对系统稳定性、可观测性有极高的标准。
4. 业务敏锐度与创新： 具备极强的Owner意识和创新思维，不仅关注技术实现，更关注AI如何重塑业务流程；能够跨团队高效协作，推动技术方案在不同行业的商业化落地。
5. 加分项：有对话式AI Agent、智能客服、知识问答（AgenticRag）等开发落地经验者优先。

> 阿里云社招站搜索 “Agent” 共 56 个岗位，同页还有：AI测试开发工程师（Agent产品质量保障/研发效能/评测方向）、Agent Infra 研发专家、Agent 平台数据智能研发技术专家、可观测 AI Agent 研发专家、Agentic Tools开发专家（SDK团队）、Voice Agent 研发工程师等。阿里校招站当前批次检索为 0 个岗位。

---

## 六、LinkedIn（新加坡）

搜索词 “AI Agent Engineer”，地点新加坡，99+ 条结果。大厂相关岗位：TikTok、字节跳动、蚂蚁集团、OpenAI、Google、Sea、Binance、AMD、Apple、Manus AI。

### 14. AI Agent Engineer - TikTok LIVE（Singapore，全职）

- 链接：https://www.linkedin.com/jobs/view/4487347184/

**Core Responsibilities（节选）**

1. Design and develop the core capabilities of the Performance Analysis Agent: automatic data inspection and attribution; automation of experimental analysis (A/B reports); thematic analysis assistance; shift-left code performance review.
2. Build and evolve the Agent platform and services — upgrading traditional APIs to an MCP service framework; strengthen the data and tooling foundation for scalability, reusability and reliability.
3. Continuously improve Agent core performance: Prompt Engineering and CoT; Retrieval-Augmented Generation (RAG); Function Calling; Memory Mechanism and Evaluation Iteration — “establishing a robust, scientific evaluation system”.
4. Drive the AI value closed loop with business, product and R&D teams, turning AI solutions into measurable outcomes.

**Minimum Qualifications**

1. Strong engineering and implementation skills; at least one mainstream backend language (Go, Python, Java, Rust, C++).
2. Familiarity with the LLM and Agent technology ecosystem; practical experience integrating AI into real-world workflows.
3. Excellent problem decomposition and system design skills.
4. Strong technical curiosity and learning ability.

**Preferred**：Hands-on AI Agent project experience; performance analysis / observability / data analysis; live-streaming stack basics; active open-source participation.

### 15. AI Agent Engineer Graduate（TikTok Shop - SEA）- 2027 Start

- 链接：https://www.linkedin.com/jobs/view/4447682422/

**Responsibilities**

- Responsible for the design, development, and iteration of AI Agents in TikTok Shop business scenarios, covering the full cycle from requirement analysis to architecture design, development, and launch.
- Implement Agent capabilities into core e-commerce scenarios: intelligent customer service, product operation assistance, business decision support, content generation, and business process automation.
- Continuous development and optimization of the Agent technology stack, covering Context Engineering, Harness, RAG, Multi-Agent collaboration, Memory systems, Reinforcement Learning, workflow orchestration, and knowledge base construction.
- Understand e-commerce business logic and merchant needs so Agents can execute specialized and complex business requirements.
- Track cutting-edge developments in AI and LLMs and apply them to product iteration.

**Minimum Qualifications**

- Completing or recently completed a Bachelor's or Master's degree in CS, SE, or related discipline.
- Excellent coding skills.
- Familiarity with the design principles and tuning approaches of core Agent architecture components; understanding of mainstream open-source Agent frameworks (such as LangGraph, Pi); hands-on experience with Prompt tuning, Harness, RAG, Context Engineering, and Skill development.
- Strong communication and cross-team collaboration; passionate about technology and open source.

### 16. AI Agent Engineer - 蚂蚁集团（Singapore，全职）

- 链接：https://www.linkedin.com/jobs/view/4485443545/

**Responsibilities（节选）**

1. Lead end-to-end technical delivery for clients: solution architecture, system integration, implementation, testing, deployment.
2. Design, prototype, and integrate AI Agent solutions: agentic workflows, LLM integration, RAG, tool or API integration.
3. Design scalable big data processing solutions (batch and streaming).
4. Write maintainable, robust, secure, and testable code; review code, designs and test cases.

**Requirements（节选）**

- Singapore Citizen or PR only; 5+ years of experience; strong Java / Spring.
- Hands-on experience designing or developing AI Agent solutions (PoCs, prototypes or production).
- Practical knowledge of LLM integration, prompt engineering, RAG, tool/function calling, agent orchestration, and evaluation.
- Kafka / Spark / Flink data pipelines; distributed systems architecture.
