# 技术设计: 本视频语义搜索（无 Embedding / BYOK）

## 技术方案

### 核心技术
- MV3 Chrome Extension（CRXJS + Vite + React）
- 复用现有字幕切片与分析产物：`segments`（IndexedDB / idb）
- LLM Provider：沿用现有 OpenAI-compatible / Gemini（只用对话接口，不用 embeddings）

### 实现要点
#### 1) 搜索范围改为“当前视频”
- 入口 UI 在 `src/content-script/overlayApp.tsx`：把“跨视频搜索”区块改成“本视频搜索”
- 搜索请求需要带上 `videoId`（当前 BV + cid）以确保在 SPA/分P 切换时不会串数据

#### 2) 两阶段检索（无 embedding 的“语义搜索”）
目标：尽量快、尽量省 token，让“语义搜索”在单视频内可用。

**阶段A：候选召回（本地）**
- 从 DB 读取当前 `videoId` 的 segments（优先 `ContentType.DRY`，必要时可包含其它类型）
- 用现有 `keywordScore()` 或稍增强的 BM25-lite 做召回
- 取 TopN（建议 8–15），作为 LLM 重排候选
- 若 TopN 为空：直接回退到关键词搜索（或提示“本视频没有可搜索片段/请先分析生成段落”）

**阶段B：LLM 语义重排（远端）**
- 使用同一套 BYOK 的 LLM Provider（与分析一致），让用户只配一个 key
- Prompt 输入：`query` + 候选列表（start/end/summary/rawText 适当截断）
- 要求模型输出严格 JSON：
  - `[{ startTime: number, score: 0..1, snippet: string, reason?: string }]`
- 解析失败/超时/429/5xx：回退到阶段A 的关键词排序结果

**性能与成本控制**
- 候选文本截断：summary 优先，rawText 只作为补充（例如最多 200–400 字）
- TopN 控制：默认 10；可在设置页作为高级项（可选）
- 超时：例如 8–12s（到时回退）

#### 3) 消息与后台路由
- 新增消息类型（建议）：`SEARCH_IN_VIDEO`  
  - 请求：`{ videoId, query, topK }`
  - 响应：`{ items: SearchResultItem[], mode: 'semantic' | 'keyword', note?: string }`
- 后台实现：
  - `src/background/index.ts` 新增 handler
  - `src/background/search.ts` 新增 `searchInVideoKeyword()` 与 `searchInVideoSemantic()`（无 embedding）

#### 4) 暂时下线 embedding
- `src/background/analyze.ts` 中 “DRY segment embedding 生成” 逻辑关闭（或挂在 feature flag）
- `src/options/optionsApp.tsx` 与 `src/shared/storage.ts` 去掉 embedding 模型配置项/文案（保留未来恢复空间：可以把字段先留在存储但不暴露 UI）

## 架构决策 ADR
### ADR-001: 不用 embedding 也提供“语义搜索”
**上下文:** embeddings 在网关/权限上不稳定，且用户对其价值不确定，但又希望在本视频内能“问问题定位时间点”。  
**决策:** 本阶段采用“关键词召回 + LLM 重排”的语义搜索，不引入 embedding。  
**理由:** 成本可控、实现快、无需新模型能力与向量库，且可在单视频范围内达到足够可用的语义定位。  
**替代方案:** 引入 embedding + 向量检索 → 拒绝原因: 权限/可用性与产品价值不确定，短期风险高。  
**影响:** 语义搜索会依赖 LLM 调用，需强制超时/回退策略；未来若恢复 embedding，可在不破坏 UI 的情况下升级为“embedding 召回 + LLM 重排”。

## 安全与性能
- **安全:** 不在日志/错误信息里回显 Key；对模型输出做严格 JSON 解析与兜底；不执行模型输出的任何“指令”
- **性能:** 两阶段检索；小候选集；限制输入长度；设置超时与指数退避（可选）

## 测试与部署
- **手工验证:**
  - 在有字幕且已分析的视频页，输入语义问题能返回可点击时间点并跳转
  - 不配置 key 时会回退关键词搜索并给出提示
  - SPA 切换 BV/分P 后，搜索不会返回上一个视频的数据
- **自动化（可选，轻量）:**
  - 为 `keywordScore()` 与候选截断/JSON 解析写最小单元测试（若仓库已有测试框架则接入）

