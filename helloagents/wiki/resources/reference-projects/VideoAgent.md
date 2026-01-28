# 参考项目拆解：VideoAgent

## 1. 项目定位

**一句话**：一个面向“视频理解/编辑/重制”的多模态 Agent 框架：把用户自然语言需求拆成意图，自动选择工具并生成 Agent Graph，执行后再做反思迭代。

它不是“B站摘要工具”，而是更通用、更重的“多代理编排框架”，但其中的编排机制对 BilibiliDry 的“边看边出 + 多工具”长期演进有启发。

## 2. 代码与工程形态（你仓库内位置）

- 项目根目录：`reference/VideoAgent/`
- 入口：`reference/VideoAgent/main.py`
- 多代理编排核心：`reference/VideoAgent/environment/agents/multi.py`
- 意图配置：`reference/VideoAgent/environment/config/intents.yml`
- Graph 提示词：`reference/VideoAgent/environment/config/graph.txt`
- 工具注册/扫描：`reference/VideoAgent/environment/agents/base.py`、`reference/VideoAgent/environment/roles/`
- registry：`reference/VideoAgent/environment/config/registry.json`

## 3. 核心机制（意图→工具→图→执行→反思）

### 3.1 意图分析

- `MultiAgent.intents_analysis` 用 LLM（配置里强调 Claude）把用户输入解析为意图列表；
- 意图集合由 `intents.yml` 定义（相当于“能力清单/路由表”）。

### 3.2 工具选择与图生成

- 意图映射到工具集合（工具来自 registry + 自动扫描）；
- `generate_agent_graph` 通过 graph prompt 生成一个可执行的 JSON 图；
- 生成后做结构校验（可行性判断/参数连线）。

### 3.3 执行链与参数编排

- `execute_agent_chain` 以“上下文 key（Agent.param）”串联输入输出；
- 无入边参数的节点会向用户交互请求输入；
- 工具类按 registry 动态加载并执行。

### 3.4 反思闭环（提升成功率）

- 图生成或 judge 失败，会触发反思与重试（多次迭代）；
- 这是“复杂任务稳定性”的关键工程手段。

## 4. 工具生态（多模态、多外部依赖）

该项目把大量能力做成工具节点，例如：
- 音频提取/合并（ffmpeg）
- 转写（Whisper + 外部 CLI）
- 视频索引检索（VideoRAG）
- TTS/SVC（CosyVoice / fish-speech / seed-vc / DiffSinger）
- MLLM（Gemini）做帧/字幕等细粒度理解

## 5. 风险点/工程注意事项（对标时应吸取教训）

- 部分解析逻辑用 `eval` 处理 LLM 输出，鲁棒性与安全性较差（应改为 JSON schema 严格解析）。
- 个别工具 schema/实际返回字段不一致，可能导致编排失败（编排系统必须强一致、强校验）。

## 6. 对 BilibiliDry 的可借鉴方向（“轻量化落地”）

在 BilibiliDry 这样的浏览器扩展场景，不能照搬重框架，但可借鉴：

- **能力清单化（intent registry）**：把“字幕抓取/分块/注水识别/embedding/搜索/导出/聊天”做成可组合的子任务，并声明输入输出契约。
- **任务图（轻量 DAG）**：对长视频把任务拆成 DAG，支持断点续跑与失败重试（MV3 SW 易休眠尤其需要）。
- **反思与校验**：对 LLM 输出（segments JSON）做“严格 schema 校验 + 自动纠错提示 + 重试策略”。

