# 大模型 Agent 面试复习手册

# 一、常见 Agent 设计模式与差异

| 模式                     | 核心思想                          | 控制逻辑                                           | 适用场景               | 优点                   | 缺点              |
|------------------------|-------------------------------|------------------------------------------------|--------------------|----------------------|-----------------|
| ReAct                  | 交替执行Reasoning 与Action | 模型根据思考决定下一步工具调用                        | 探索式任务、问答、智能客服  | 实现简单、交互灵活        | 易陷入重复调用、成本高 |
| CodeAct                | 以代码作为行动媒介                 | LLM 生成代码后执行,结果反馈                           | 自动化脚本、代码生成、ETL | 可测试、易调试              | 安全要求高、需沙箱   |
| Agentic RAG            | 检索增强推理                        | 检索知识库后Agent 综合推由理                  | 知识密集型、企业知识问答   | factual、token成本低 | 检索质量关键、延迟高  |
| SelfReflection     | 自我反思与修正                       | 任务执行后进行自评、改进                               | 长任务、复杂规划、科研助手  | 提升正确率、自纠错        | 成本高、链路复杂    |
| Multi-AgentPlanner | 规划与分工                         | 中央Planner 生成任务DAG,分配子Agent | 多步骤任务、并行工作流    | 并发、扩展性好              | 协调复杂、一致性难   |
| Auto-GPTstyle      | 自主闭环执行                        | 自生成目标与计划,自回路推进                             | 开放探索型任务            | 自主性强                 | 不可控、易发散         |
| Planner-style          | 计划后执行                         | 先生成完整计划后分步执行                               | 企业级工作流、任务分解    | 可控、可监控、易回滚       | 前期规划负担大         |

### 二、不同设计模式的选型要点

| 任务特征          | 推荐模式                | 理由        |
|---------------|---------------------|-----------|
| 开放式探索(如研究、创意) | Auto-GPT 或ReAct | 高灵活性,允许探索 |

| 可分解、有并行性 | Planner 或Multi-Agent              | DAG 可并行,易扩展         |
|----------|---------------------------------------|---------------------|
| 知识问答型任务  | Agentic RAG                           | 降低hallucination |
| 长期对话与自学习 | Self-Reflection + Long-termMemory | 能逐步修正错误             |
| 程序执行、逻辑强 | CodeAct                               | 程序化、可测试             |

## 三、Auto-GPT-style 与 Planner-style 核心区别

| 维度    | Auto-GPT-style | Planner-style |
|-------|----------------|---------------|
| 控制方式  | 自反馈闭环,持续生成目标   | 一次性规划后执行      |
| 优点    | 灵活、自主探索        | 可控、可审计        |
| 缺点    | 易发散、成本高        | 初始规划可能不佳      |
| 适用任务  | 探索型、开放式        | 工业级、分解明确      |
| 可观测性  | 低              | 高             |
| 回滚能力  | 弱              | 强             |
| 工程落地性 | 原型验证           | 生产部署          |

## 四、Reflective Agent 对系统链路的影响

- 1. 增加执行回路(反思 → 修正 → 再执行),导致链路复杂度上升。
- 2. 增加状态管理需求:需保存中间结果、版本、反思日志。

- 3. 计算成本上升:反思步骤本身消耗 token。
- 4. 有利于可解释性与错误自愈。

#### 设计建议:

- 设置最大反思次数。
- 使用轻量判定器(reflection gate)。
- 保留评估日志便于审计。

# 五、Memory 架构分类与管理策略

| 类型                                           | 描述             | 特征       | 应用                | 风险                 |
|----------------------------------------------|----------------|----------|-------------------|--------------------|
| ScratchpadMemory                         | 临时上下文补全        | 仅在当前会话有效 | 推理链、短期上下文     | 污染上下文、token 过长 |
| SemanticMemory(Embedding+Search) | 向量化检索          | 可跨会话     | 知识库、FAQ、历史问答  | 语义漂移、检索延迟      |
| Long-termMemory (KVStore)            | 可写入更新的长期存储 | 可维护用户状态  | 个性化Agent、任务记忆 | 隐私、同步一致性           |

#### Memory 管理要点

- 控制写入频率、设置 TTL 与重要性分数。
- 定期 condense / summarize。
- 提供 Memory Controller 统一管理读写、清理、索引。

## 六、Memory 与 Tool 干扰与隔离机制

| 问题           | 解决方案                          |
|--------------|-------------------------------|
| Memory 污染上下文 | 加入namespace 与metadata |
| 重复内容冗余       | 相似度检测(cosinethreshold)    |
| 检索冲突         | Prompt 过滤器/ 二次筛选模型    |
| 工具结果污染记忆     | Memory Controller 中区分来源字段 |
| 历史信息过时       | 设定时间窗口、版本号更新策略            |

## 七、Tools 注入与调用机制

| 维度   | 静态Schema 定义 | 动态注册                         |
|------|-----------------|------------------------------|
| 注册时机 | 启动时固定定义         | 运行时由LLM 推理或动态加载      |
| 参数传递 | prompt 拼接凭  | 结构化输出(JSON/functioncall) |
| 安全性  | 高,可审计           | 低,需权限控制                      |
| 灵活性  | 低               | 高                            |
| 适用场景 | 生产系统、固定API  | 研发阶段、动态扩展                    |

#### 最佳实践:

- 使用统一的 Tool Registry(name, input\_schema, permission)。
- 准备 Tool Selector(根据任务上下文选择工具)。
- 失败处理策略:
  - 重试 + backoff。
  - fallback 工具。
  - 降级(部分输出)。
  - circuit breaker 防连锁故障。
- 所有工具调用必须幂等化并记录 trace。

# 八、多 Agent 并发与任务调度

#### 任务拆分策略

- 按功能拆分(检索、分析、执行)。
- 按子目标拆分(目标分解)。
- 按数据分片拆分(并行数据处理)。

#### 冲突协调

- 优先级策略(predefined priority)。
- 合并规则(schema-based merge)。
- 仲裁 Agent(arbiter agent)。

#### 上下文隔离

- 每个 Agent 独立 Session Buffer。
- 独立 Memory Namespace。
- 控制共享范围(仅共享 schema 限定信息)。

#### 结果融合

- Schema 验证 + 合并。
- 置信度加权融合。
- 投票或 Aggregator 模型决策。

### DAG 调度与执行控制

- 节点幂等(idempotent key)。
- Saga pattern 实现回滚。
- Cancellation Token 支持中断。
- 状态持久化(Pending/Running/Succeeded/Failed)。

## 九、Race Condition 与状态管理

#### 常见问题

- 多 Agent 并行写入同一状态。
- 中途失败造成状态不一致。

#### 解决方案

- 1. 乐观并发控制(version check)。
- 2. 事件溯源(event sourcing)。
- 3. 分布式锁 / 队列串行化。
- 4. 最终一致性合并(conflict resolution)。
- 5. 任务隔离(每 Agent 自有 buffer)。

### 十、性能瓶颈与优化

| 瓶颈来源      | 典型症状          | 优化手段                       |
|-----------|---------------|----------------------------|
| 模型推理慢     | 高延迟           | 模型路由、缓存、streaming          |
| Prompt 过长 | token 成本高     | Prompt condensation、摘要 |
| 工具调用链长    | 链路延迟          | 并行化、缓存结果                   |
| 检索延迟      | vector DB 响应慢 | 索引优化、批量查询                  |
| 反思循环过多    | 成本倍增          | 限制反思次数、earlyexit       |
| I/O 阻塞    | 异步执行慢         | Async/Await、队列调度           |

#### Tracing 工具:

• LangSmith / PromptLayer / OpenTelemetry / OpenAgentMonitor

#### 监控指标:

• token 使用量

- 工具调用延迟
- memory 检索延迟
- 成功率 / 重试率
- 平均反思次数

### 十一、安全与合规设计

| 风险类型      | 防护策略                          |
|-----------|-------------------------------|
| Prompt 注入 | Prompt Sanitization、上下文隔离 |
| 数据越权      | RBAC/ABAC 权限控制                |
| Token 滥用  | 限流与配额控制                       |
| 敏感信息泄露    | 数据脱敏、masking                  |
| 工具越权调用    | Capability Manifest           |
| 缺乏审计      | 不可篡改执行日志                      |
| 合规要求      | 审计导出、删除请求支持                   |

#### 安全模块组成:

- 权限边界控制层
- 审计日志系统
- Red-team prompt 测试
- Policy Engine(限制执行内容)

### 十二、框架选型与架构抽象

| 框架        | 特点                  | 适用场景        |
|-----------|---------------------|-------------|
| LangGraph | DAG 调度、可视化、强控制流 | 企业级多Agent系统 |
| CrewAI    | 团队协作、多角色Agent       | 协作任务        |
| AutoGen   | 强通信协议、支持反思          | 多Agent研究    |
| Manus(闭源) | 高并发、可插拔工具系统         | 商业部署        |
| LangChain | 简单、组件丰富             | 原型开发        |

#### 对比维度:

- 调度机制(同步/异步/DAG)
- 扩展性(插件机制)
- 工具注册机制
- 安全与监控支持
- 成本与性能表现

### 十三、常见选型与实现坑

| 问题            | 原因            | 修复策略                                 |
|---------------|---------------|--------------------------------------|
| Prompt 冗长、成本高 | 直接拼接检索结果      | 语义摘要+ Top-k                      |
| 动态工具注入缺乏权限    | 权限校验缺失        | 加入Capability Manifest            |
| Auto-GPT 无限循环 | 缺少Step 限制 | 添加Step Limit + BudgetControl |

| DB 状态重复写入 | 无幂等机制   | Idempotency Key           |
|-----------|---------|---------------------------|
| Memory 过大 | 未压缩、无清理 | Summarization + TTL       |
| Tool 调用卡死 | 无超时机制   | Timeout + Circuit Breaker |

## 十四、Agent 性能调优方向

#### 1. LLM 模型选择

◦ 路由机制:先轻量模型过滤,再重模型推理。

#### 2. Prompt 优化

◦ 结构化、减少上下文重复。

#### 3. 缓存机制

◦ 工具结果缓存、检索缓存、embedding 缓存。

#### 4. 并行化执行

◦ 并行工具调用、子任务异步执行。

#### 5. Pipeline 压缩

◦ 减少中间调用层。

#### 6. 监控与 Trace

◦ 量化每层耗时,定位瓶颈。

### 十五、安全合规落地清单

- 1. 权限边界控制(最小权限原则)
- 2. 工具白名单
- 3. 输入输出审计与脱敏
- 4. Prompt 反注入检测
- 5. 数据持久化加密
- 6. 敏感日志清理
- 7. 合规报告与删除权支持

# 十六、Agent 系统总体架构参考图(文字版)

```
代码块
    User
     └──> API Gateway
           └──> Router / Planner
                 ├──> Agent Executor Pool
                 │ ├── Session Context
                 │ ├── Memory Namespace
                 │ └── Tool Access Layer
                 ├──> Tool Registry & Executor
                 ├──> Vector DB / KV Memory Store
                 └──> Reflection & Evaluation Layer
                       └──> Monitor / Tracing / Audit Log
1
2
3
4
5
6
7
8
9
10
11
```

#### 关键设计点:

- 所有接口使用 schema 约束。
- Memory Controller 独立负责写入策略。
- Tool Executor 带权限与限流。

- DAG 调度系统支持中断与回滚。
- Trace 记录每个节点的 token / latency / error。

## 十七、Agent 面试八大维度

- 1. 设计模式理解与选择能力
- 2. 多 Agent 协作机制设计
- 3. 记忆架构与上下文管理
- 4. 工具调用与注入机制
- 5. 调度控制与任务恢复能力
- 6. 性能优化与监控追踪能力
- 7. 安全与合规意识
- 8. 框架选型与抽象能力

# 十八、高频面试题汇总(精选 60+)

### 1. 设计模式理解

- 1. 讲讲 ReAct 和 CodeAct 的本质区别?
- 2. 为什么 ReAct 在生产中可能不稳定?
- 3. Agentic RAG 相较传统 RAG 的提升点?
- 4. Self-Reflection 模式有哪些优缺点?
- 5. Multi-Agent Planner 如何保证任务一致性?
- 6. 你在什么场景下会混用多个模式?
- 7. Auto-GPT-style 为什么容易陷入死循环?

8. 如何判断 Planner 输出的计划是否合理?

### 2. 多 Agent 协作

- 9. 如何拆分任务?
- 10. 冲突结果如何合并?
- 11. 多 Agent 状态共享如何避免污染?
- 12. 设计过仲裁 Agent 吗?
- 13. 如何实现并行执行?
- 14. 如何在任务失败时做回滚?
- 15. 如何在异步任务中处理 race condition?

### 3. Memory 架构

- 16. 你说"挂了 memory"具体是指哪种?
- 17. Memory 写入策略怎么控制?
- 18. 如何清理无效记忆?
- 19. Semantic Memory 与 KV Memory 的区别?
- 20. 如何防止 memory 污染?
- 21. 有用过 agentic memory 吗?

# 4. 工具调用机制

- 22. 工具是如何注册的?
- 23. 动态注册带来的风险是什么?
- 24. 如何对齐参数与 schema?
- 25. 如何做 tool 调用 fallback?
- 26. 设计过 tool selector 吗?
- 27. 如何避免工具滥用?

### 5. 调度与控制流

- 29. 你设计过 DAG 调度流程吗?
- 30. 如何确保幂等性?
- 31. 支持任务中断与恢复吗?
- 32. 如何做状态持久化?
- 33. 怎样实现优先级调度?
- 34. 有遇到过 race condition 吗?

### 6. 性能与系统监控

- 35. 你的 Agent 为什么慢?
- 36. 如何定位性能瓶颈?
- 37. 用过哪些 tracing 工具?
- 38. 怎么降低 token 成本?
- 39. 检索延迟高时如何优化?
- 40. 反思循环导致性能下降如何处理?

# 7. 安全与合规

- 41. 如何防 prompt 注入?
- 42. 如何防止工具越权调用?
- 43. 如何保护敏感数据?
- 44. 如何设计访问边界?
- 45. 有做过执行日志审计吗?
- 46. 如何防止 token 滥用?
- 47. 数据合规如何保障?

### 8. 框架与架构抽象

- 48. LangGraph 与 CrewAI 的区别?
- 49. AutoGen 有什么优缺点?
- 50. Manus 的核心理念?
- 51. 框架适配边界如何选择?
- 52. 如何在 LangGraph 上构建抽象层?
- 53. 什么是 Agent Controller?
- 54. 如何支持跨框架复用?

### 9. 实践与踩坑

- 55. 有没有做过错误的模式选型?
- 56. 记忆系统失效导致过什么问题?
- 57. 工具调用失败如何追踪?
- 58. 反思环节失控的例子?
- 59. 性能优化后提升了哪些指标?
- 60. 你上线的 Agent 系统在生产中表现如何?

## 十九、总结与复盘建议

- 1. 先掌握 模式 → 控制流 → 场景匹配 的体系。
- 2. 理解 memory / tool / planner 的交互边界。
- 3. 会解释 性能、安全、合规 的设计考量。
- 4. 准备 1~2 个实战案例(上线经验或复盘故事)。
- 5. 面试时优先给出"结论 + 理由 + 取舍"。

好的 — 我把你给出的面试要点按 可复用的知识卡 / 备考模板 做成一份详尽的整理(中文),包含:各 类 Agent 模式的本质与选型矩阵、面试中推荐说法、常见坑与补救策略、架构细节(memory、 tools、调度、并发、回滚、trace、性能优化、安全合规)以及可直接背诵的样板回答与复盘问题。内 容尽量实战化、面试友好,方便你记忆与复述。

# 快速总览

- ReAct:LLM 同时做 Reasoning + Action(思考与工具调用 interleaving)。适合交互式问答、探 索性流程、需要工具即时查询的场景。优点快速直观、缺点易产生重复调用/token 增长、可控性 差。
- CodeAct:把动作视为代码片段/脚本执行(LLM 生成"可执行代码"然后运行)。适合需要复杂 状态变更、依赖程序化逻辑或生成代码的任务。优点精确可测试;缺点安全边界/执行环境需严格 管理。
- Agentic RAG(Agent + Retrieval):检索结果 + agent 推理/操作。适用于有大型知识库、需要长 期记忆或上下文扩展的任务(客服、知识型助手)。优点减少 token 成本、提升事实性;缺点检索 质量依赖向量库/检索器配置。
- Self-Reflection(Reflective Agent):Agent 在执行后反思/重写计划/修正自己的输出(loop of evaluate→revise)。适合长任务、错误累积明显的工作流,但会加大链路复杂度与成本。
- Multi-Agent Planner(Planner + Subagents):中心 planner 制定 DAG/子任务并分配给专职 子 Agent 并行处理⸺适合复杂多步骤、可并行拆解的企业级流程。优点并行伸缩、职责清晰;缺 点协调复杂、一致性难以保证。

# 1. 各设计模式详解

### ReAct

本质:把"思考(reasoning)"和"行动(tool call)"交替进行,prompt 里通常包含"Thought / Action / Observation"三段式。

适合:即时问答、需要交互检索/命令执行、探索式任务(问诊、客服、机器人控制)。

优缺点:实现简单、直观;但很容易出现多次重复工具调用、token 爆炸、难以做严格回滚。

面试表述要点:说明你如何通过 step-limits、action dedup、缓存来控制cost与重复调用。

## CodeAct

本质:LLM 生成"代码/脚本"作为行动指令,执行环境(沙箱)运行代码并返回结果。Action→执行 →结果,偏"程序化执行"。

适合:需要复杂数据处理、事务化操作、或自动化脚本生成(数据 ETL、格式化、批处理)。

优缺点:可读性、可测试、回滚实现更容易;但要解决执行安全(沙箱、资源限制)、输入校验、死 循环风险。

面试表述要点:强调运行时 sandbox、lint/类型校验、权限分层、执行审计设计。

### Agentic RAG(Retrieval-Augmented Agent)

本质:把检索到的语义上下文作为 agent 推理的输入,agent 可结合检索结果选择动作或生成回答。

适合:知识密集型任务、长时间记忆、法规/知识库问答、企业内部助手。

优缺点:降低 token 成本、提高 factuality;检索质量成为瓶颈,需做检索管控(chunking、 pipeline)。

面试表述要点:谈检索策略(chunk size、doc scoring)、condense(摘要)模块和embedding质 量监控。

## Self-Reflection(Reflective Agent)

本质:执行—评估—修正的闭环:agent 在一个子任务结束后对结果做自我评价,然后决定是否重试或 修改计划。

适合:长任务、复杂目标、需逐步验证的决策流程(科研、规划、多回合合约草拟)。

优缺点:提高正确率,可捕捉逻辑错误;但增加多次 LLM 调用,链路复杂且需管理中间状态和版本。

面试表述要点:说明你如何用 checklists、testsuite、cost-threshold 来决定是否触发 reflection。

## Multi-Agent Planner(Planner + Subagents)

本质:central planner 生成任务 DAG,把子任务分配给专责 agent/worker(可并发),最终汇总结 果并 resolve conflicts。

适合:企业级多步骤流程(订单处理、复杂审批链、数据流水线),可并行化的工作。

优缺点:横向扩展好、职责分明;但需解决状态一致性、失败回滚、结果合并冲突。

面试表述要点:阐述 planner 的粒度决定、subagent contract(输入/输出 schema)、以及冲突解决 策略(优先级/merge rules)。

# 2 — Auto-GPT-style vs Planner-style 的核心区别

- Auto-GPT-style(开放式自回路):agent 联续自主生成下一步动作/目标,执行—观察—继续。 优点灵活、能探索未知;缺点易发散、控制差、测试难。
- Planner-style(先规划再执行):先生成明确 plan(DAG/sequence),然后有序或并行执行。 优点可控、易监控与回滚、并发友好;缺点初期规划可能欠佳,需要 planner 质量好。

#### 面试示例回答:

"Auto-GPT 更像人类自发探索,适合研发原型或高度开放任务;生产场景通常更偏 plannerstyle,因为我们需要可审计、可回滚和并行调度能力。"

# 3 — Reflective Agent 对链路结构的影响

- 增加循环/反馈环:每个任务会有 extra evaluation step → 需要状态(checkpoints)保存与版本 管理;
- token 与延迟成本上升:反复调用 LLM;需要控制反思频率(失败率阈值∕confidence threshold);
- 链路复杂度:state machine 或 workflow engine 设计更复杂,需要记录评估元数据 (who/when/why);
- 可审计性提升:反思模块提供决策理由,利于合规与回溯。

面试点:说明你会用"局部评估器 + 轻量合格/不合格判定 + 最多重试次数 + 审计日志"来控制成本和 并发。

### 4 — Memory("挂了 memory "是指哪种?如何回答面试问 法)

当面试官问"挂了 memory"或问你怎么理解 memory,你应主动区分并表述:

#### 1. Scratchpad / short-term context(临时上下文补全)

◦ 用法:把中间推理、临时变量放到 prompt buffer。

◦ 特点:即时、无长期写入、随着会话滑动窗口过期。

◦ 风险:污染 prompt、重复冗余导致token浪费。

#### 2. Embedding + search(semantic memory / RAG)

◦ 用法:将重要文档/段落做向量化,检索 top-k 作为补充。

◦ 特点:适合知识库、历史对话查询;需要向量DB(FAISS/Weaviate/Pinecone)和检索策略。

◦ 风险:检索延迟、语义漂移(过时信息)、重复检索。

#### 3. KV-based / Long-term memory(长期记忆)

◦ 用法:key→value 结构、或专业 schema(user:preferences / user:tasks)。

◦ 特点:支持写入/更新/删除,适合长期个性化。

◦ 风险:版本管理、隐私合规、删除/更新一致性。

#### 面试建议语句:

"当我说'挂 memory',我会先澄清是 short-term scratchpad 还是 semantic RAG。生产系统会 把三类 memory 分层:session buffer(短期)、semantic store(检索)、KV store(长期),每 层有不同的写策略/TTL/审计。"

# 5 — memory 与 tool 干扰(污染/冗余)与控制手段

常见问题:memory 与 tool output 混用导致检索到过时或不正确的信息;重复内容被多次检索。 可行策略:

- 命名空间(namespacing)与元数据:每条 memory 加 source/tool/tag/time。检索时用 metadata filter。
- condense/summary pipeline:定期把 raw observations 做摘要并替换原数据(减少重复)。
- dedup + similarity threshold:插入前做相似度检测(cosine threshold)避免重复。

- memory controller(独立服务):统一提供 write/evict/compact API,支持策略(LRU、timebased、importance score)。
- prompt-time filtering:检索后做 secondary filter(模型或规则)决定哪些片段进入最终 prompt。
- cache + TTL:热点检索缓存结果,减小 DB 负载。

面试要点:展现你理解"检索不只是向量召回,还要 metadata 筛选、摘要、替换"的流程。

# 6 — tools 注入与工具调用设计(面试必问)

### 注入方式(两类对比)

- 静态 schema 注册(compile-time)
  - 优点:可校验、类型安全、便于权限管理。
  - 常见做法:定义工具 manifest(name, input\_schema, output\_schema, permissions)。
- 动态注册(runtime / LLM-driven)
  - 优点:灵活、支持插件式扩展(第三方 runtime 注册)。
  - 风险:安全、版本冲突、权限控制复杂。

#### 参数传递方式

- Prompt 拼接(自由文本):最简单,但 brittle(易错、难自动化解析)。
- Structured output / JSON schema / function-calling(推荐)
  - 优点:自动校验、便于 router/selector 判定。

◦ 常见实践:使用模型的 function-call 或者 JSON schema validator 在执行前校验。

### 调用失败处理

- 重试(指数退避 + 上限)
- fallback tool / alternative(tool router)
- 降级策略(返回部分结果或转人工)
- idempotency & transactional design(防重入)
- error taxonomy(transient / permanent / invalid\_input)并据此处理

#### 是否构建可插拔执行系统?(面试回答建议)

• 强烈建议说明你倾向于\*\*可插拔、统一执行接口\*\*的设计(Registry + Router + Executor + Monitor + Circuit-Breaker),而不是硬编码 tool 调用。这样便于扩展、权限管理和测试。

# 7 — 多 Agent 并发执行(任务拆分/冲突协调/隔离/融合)与 DAG 调度

### 任务拆分策略(planner 的核心)

- 按职责(functional split):按功能拆(NLP、检索、执行器)
- 按子目标(goal decomposition):分成互相可并行的子任务
- 按数据分片(data shard):按数据域并行处理(大规模数据处理)

### 冲突协调(合并策略)

- 优先级规则:predefined priority 或时间戳优先(last-write)
- 合并器(merge rules):定制化合并逻辑(union / conflict resolution / voting)
- 仲裁 agent:引入一个决策 agent 在冲突时评估输出并裁决(或者人工介入)

#### 上下文隔离

- 每个 subagent 拥有 自己的 session buffer + own memory namespace + own permissions
- 共享 context 通过明确的 contract(schema)流动,仅传递必要信息(最小权限)

### 结果融合(result fusion)

- schema-based merge:先校验每个子结果的 schema,再合并;
- confidence weighting:基于各 agent 自报告的置信度或历史准确率做加权;
- voting / aggregator model:用小模型评估/融合多个候选答案。

### DAG 任务调度(幂等∕回滚∕中断)

- 幂等:确保每个 node 可重复执行(使用 idempotency key / op id)。
- 失败回滚:通常采用 Saga pattern(补偿事务) 或 checkpoint + compensating actions。
- 中断(cancellation):任务携带 cancellation token;long-running 子任务需定期检查 token。
- 实现要点:任务状态机(Pending → Running → Succeeded → Failed → Compensated),持久 化每个节点的输入/输出/元数据。

## Race condition & 状态错乱的常用解决

- 乐观并发 + versioning:写时校验版本号,冲突重试并合并。
- 悲观锁(broker/queue):只允许一个 worker 修改共享实体。
- 事件溯源 / append-only log:通过事件流回放重建状态,便于 audit 与恢复。

• 隔离策略:每 agent 写到自己 buffer,最终由 aggregator 执行冲突合并,避免直接并写共享内 存。

# 8 — 中断、回滚与可观测性(Tracing & 性能诊断)

### 当 Agent "慢" 的常见原因

- 1. LLM 调用延迟(模型选择、冷启动)
- 2. token 数过多(prompt 太长、重复插入)
- 3. 外部工具/DB 检索慢(vector DB、API rate limit)
- 4. 序列化执行(不做并行)或 blocking I/O
- 5. 过多反思∕重试循环(reflective loops)

### 优化手段(面试要点)

- Model cascade / routing:先用 cheap model 做 routing,再调用 expensive model。
- Prompt condensation & retrieval quality:用 summary/condense 减少 prompt 长度;只检 索 top-k 必需片段。
- 并行化工具调用:把可并行的子任务并发触发(注意后合并)。
- 缓存热点结果(embeddings+tool results)并合理设置 TTL。
- 异步流式返回(streaming)减低 perceived latency。
- 批量/合并请求:对向量 DB 做批查询,减少 round-trip。
- 使用 trace 工具:LangSmith / PromptLayer / OpenTelemetry 等做端到端 tracing,定位是 LLM、network 还是 DB 问题。

面试说明方式:给出你排查步骤(measure→isolate→optimize→verify),并列出你会收集的 metric(LLM latency, tool latency, token counts, retriever latency, queue lengths, error rates)。

# 9 — 安全性与合规(面试一定会问)

威胁模型:prompt injection、data exfiltration、权限越界、滥用 token、日志泄露。

防护手段:

- 最小权限原则:工具执行严格权限分离与签名(每个工具有 capability list)。
- 输入/输出 sanitize:对 LLM 输出做正则/模型二次校验,不能直接把 output 作为命令执行。
- 审计日志 & 不可篡改链:记录每次 action / tool call / memory write(包含 who/when/input/output)。
- 访问控制:RBAC/ABAC 以及操作审批(高风险操作需要人工二次确认)。
- prompt sandboxing:对 model 可见的外部数据做 redaction(敏感字段 masking)。
- red-team 测试:专⻔的 prompt injection 测试套件并定期跑。

合规点:数据保留策略、删除请求支持、审计导出、PII 检测/脱敏。

# 10 — 框架选型与抽象(面试实战要点)

当被问到 LangGraph、CrewAI、Manus 等框架时(或者面试官问选型理由),你的回答可以按下列 维度展开:

- 调度模型(同步 vs 异步 vs DAG)
- 扩展性/插件能力(是否支持 runtime tool registration)
- 观测/Tracing 支持(是否集成 tracing、metrics)
- 安全模型(权限、审计)
- 社区/生态/部署成本

面试建议:不要光说喜好,给出权衡矩阵(如:小团队希望快速上线用 A 框架;企业级建议 B 框架因 为有 RBAC + tracing;如果需要高度并行与 DAG,优先选择支持 DAG 的平台)。

# 11 — 常见面试问题 + 样板答案(可背诵)

(只列 10 个最可能的问法,给出要点式回答)

#### 1. "你如何选择 ReAct 还是 Planner?"

答:根据任务可分解性、需要并行性、可控性来选。交互探索选 ReAct;生产级需要可审计/并行选 Planner。列出成本控制与安全措施。

#### 2. "Memory 怎么设计?"

答:分层(session/scratchpad、semantic RAG、KV long-term),每层写策略不同,统一 memory controller 管理写入/清理/保全。

#### 3. "工具调用失败怎么办?"

答:做 error taxonomy→重试/备用工具/降级或转人工,并保证幂等与事务边界。引入 circuit breaker。

#### 4. "多 agent 冲突如何解决?"

答:定义清晰 contract + metadata + merge rules;必要时设计仲裁 agent;用 versioning 控制并 发。

#### 5. "如何保证任务可以回滚?"

答:尽量让 node 幂等;用 Saga 补偿事务或 checkpoint + compensating action;记录所有 state 以 便回放。

#### 6. "Agent 为什么慢?"

答:说明排查流程(metrics 收集→区分 LLM/DB/tool latency→缓存/condense/parallel)并举例优 化措施。

#### 7. "如何防 prompt injection?"

答:sanitize、权限边界、output validator、人工审批与 red-team。

#### 8. "有没有踩过选型坑?"(面试喜欢问)

答:给出 1‒2 个小故事(示例见下面"常见坑"),并总结学到的 lesson。

#### 9. "你如何做 observability?"

答:LLM trace(prompt+response+token counts)、tool traces、vector DB metrics、end-toend latency,集成 LangSmith/PromptLayer/OpenTelemetry。

#### 10. "如何做合规审计?"

答:详细记录 action log、memory write、tool call,导出审计报告与删除支持,实行最小权限与审 批流程。

# 12 — 常见坑(面试喜欢挖真实经历)⸺可拿来复盘或当成面 试举例

- 坑 1:把检索结果直接全部拼进 prompt → 导致 token 爆炸与慢。\*\*修复\*\*:摘要/condense + top-k + metadata filter。
- 坑 2:动态注册工具没做权限控制 → 第三方插件任意调用敏感 API。\*\*修复\*\*:引入 capability manifest + runtime ACL。
- 坑 3:用 Auto-GPT 在生产直接跑长链路任务 → 出现无限循环、成本暴涨。\*\*修复\*\*:加 budget limit、step cap、planner 模式替代或混合模式(planner + Auto-GPT for subtask)。
- 坑 4:没有幂等设计直接操作数据库 → 重试导致重复扣款/重复操作。\*\*修复\*\*:idempotency keys + transaction log。
- 坑 5:memory 无淘汰策略,DB 膨胀 → 成本和检索延迟上升。\*\*修复\*\*:定期 condensation/压 缩与基于重要性的淘汰策略。

面试讲法:用一个 2-3 行 STAR 案例(Situation, Task, Action, Result)来描述,最后强调学到的 lesson。

# 13 — 面试准备清单(背诵用)

- 能清晰区分 5 种模式的"控制流"与"适配场景"。
- 对 memory 三层结构(scratchpad/RAG/KV)的写策略、淘汰策略说得清楚。
- 能画出 planner → subagent → aggregator 的数据流(输入 schema / output schema / metadata)。
- 能说出 3 个降低延迟的具体方案并描述 trade-offs(例如:缓存 vs staleness)。
- 能举出 2 个安全控制点并说明为什么必须存在。
- 有 1‒2 个"踩坑故事"并给出你当时的补救措施与最终改进。

# 14 — 一套可复用的 Architecture Blueprint(面试展示用)

组件:API Gateway → Router (cheap model) → Planner / Router → Agent Executor Pool(每 agent 有 session context + memory namespace)→ Tool Registry & Executor (adapters) → Vector DB + KV store → Monitor/Tracing/Policy Engine → Audit Log.

#### 关键设计点:

- 所有 agent 的输入/输出必须符合 contract(JSON schema);
- Memory 写入需经过 memory controller(验证/metadata/tagging);
- Tool 调用必须经过权限网关 + circuit breaker;
- Planner 生成 DAG,并把执行交给 Worker Queue(支持 priority/timeout/cancel);
- Observability:记录 prompt/response/token\_count/tool\_calls/latencies。

| 画一张手绘结构图,再解释每个组件的作用与接口。你可以在面试里按这个blueprint |  |
|----------------------------------------------------|--|
|                                                    |  |
|                                                    |  |
|                                                    |  |
|                                                    |  |
|                                                    |  |
|                                                    |  |
|                                                    |  |
|                                                    |  |