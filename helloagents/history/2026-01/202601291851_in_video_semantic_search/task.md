# 任务清单: 本视频语义搜索（无 Embedding / BYOK）

目录: `helloagents/plan/202601291851_in_video_semantic_search/`

---

## 1. UI：本视频搜索入口
- [√] 1.1 在 `src/content-script/overlayApp.tsx` 将“跨视频搜索”改为“本视频搜索”，点击结果在当前视频内 `seek`（验证 why.md#需求:-本视频语义搜索-场景:-语义问题定位）
- [√] 1.2 在 `src/content-script/overlayApp.tsx` 搜索请求携带当前 `videoId`，在 SPA/分P 切换后结果不串（验证 why.md#需求:-本视频语义搜索-场景:-SPA-切换视频/分P切换）

## 2. 消息协议：新增本视频搜索消息
- [√] 2.1 在 `src/shared/messages.ts` 新增 `SEARCH_IN_VIDEO` 请求/响应类型（验证 why.md#需求:-本视频语义搜索-场景:-语义问题定位）
- [√] 2.2 在 `src/background/index.ts` 实现 `SEARCH_IN_VIDEO` handler，并返回 `mode`/`note`（验证 why.md#需求:-本视频语义搜索-场景:-未配置-Key-/-语义搜索失败）

## 3. 后台搜索：无 embedding 的语义重排
- [√] 3.1 在 `src/background/search.ts` 增加 `searchInVideoKeyword({ videoId, query, topK })`（仅查当前视频 segments，验证 why.md#需求:-本视频语义搜索-场景:-未配置-Key-/-语义搜索失败）
- [√] 3.2 在 `src/background/search.ts` 增加 `searchInVideoSemantic({ videoId, query, topK, llm })`（关键词召回→LLM重排→失败回退，验证 why.md#需求:-本视频语义搜索-场景:-语义问题定位）
- [√] 3.3 在 `src/background/*` 复用现有 LLM Provider（OpenAI-compatible/Gemini）实现“重排 prompt + JSON 解析 + 超时”（验证 why.md#需求:-本视频语义搜索-场景:-语义问题定位）

## 4. 下线 embedding（阶段性）
- [√] 4.1 在 `src/background/analyze.ts` 关闭/移除 DRY segment 的 embedding 生成调用（验证 why.md#变更内容）
- [√] 4.2 在 `src/options/optionsApp.tsx` 去掉 embedding 相关 UI/文案，错误提示不特化某家模型（验证 why.md#变更内容）
- [√] 4.3 在 `src/shared/storage.ts` 保持向后兼容：老配置存在也不影响运行（验证 why.md#变更内容）

## 5. 安全检查
- [√] 5.1 执行安全检查（按G9: 不打印 Key、严格解析模型输出、输入长度限制、错误回退策略）

## 6. 验证
- [?] 6.1 手工回归：有字幕视频页→分析→本视频语义搜索→跳转→切换分P/BV→再次搜索不串数据
  > 备注: 需要你在 Chrome 里手工验证（本次执行已通过 `npm run build`）
