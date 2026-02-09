# 任务清单：Model Cascade（B）+ 可解释注水（C）

> 范围：先只做 OpenAI-compatible；strong 只精炼 TopK；注水默认过滤：重复/无信息增量/广告。

## 0. 准备与验收口径
- [√] 0.1 明确默认配置：cheapModel/strongModel/TopK=6，cascade 默认关闭
- [√] 0.2 定义 WATER 分类枚举与默认过滤策略（REPEAT/NO_NEW_INFO/AD）
- [√] 0.3 定义 Dashboard 里“耗时/成本”的展示口径（无 usage 时用字符数估算 + 标注）

## 1. 数据结构与存储
- [√] 1.1 扩展 `Segment`：增加 `waterReasonType`/`waterReasonText`（仅 WATER）
- [√] 1.2 新增 `AnalysisRun`（或等价记录）：`runId` + `metrics[]` + 汇总字段
- [√] 1.3 IndexedDB schema 升级：runs/metrics store（或挂在 video 记录下）

## 2. 配置与设置页（OpenAI-compatible）
- [√] 2.1 扩展 `ExtensionConfig`：新增 cascade 配置项与 waterFilter 默认项
- [√] 2.2 Options UI：增加 Cascade 开关与 cheap/strong model 输入框、TopK 设置
- [-] 2.3 Overlay（可选）：展示当前是否启用 cascade（小字提示即可）（先不做）

## 3. Stage 1（cheap）分析增强：注水可解释 + 运行指标
- [√] 3.1 更新 OpenAI chunk 分析 prompt/schema：WATER 输出 reasonType/text
- [√] 3.2 采集 metrics（latency/size）：在分析流水线按调用记录耗时与输入/输出字符数（usage 缺失时可用）
- [√] 3.3 写入 segments 时保存 waterReason 字段（UI 可用）

## 4. Stage 2（strong）精炼 TopK 干货（不阻塞主流程）
- [√] 4.1 定义 strong 精炼 API：输入 TopK DRY 段 + 对应字幕窗口，输出更好的 summary（可选建议时间）
- [√] 4.2 strong 调用失败不影响主流程：记录 *_error 指标（note 含简短报错）
- [√] 4.3 strong 完成后触发 Reflection Gate（或复用现有校验流程）再写回 segments

## 5. Overlay：注水过滤/跳过
- [-] 5.1 增加注水类别过滤 UI（默认勾选：REPEAT/NO_NEW_INFO/AD）（先放到设置页配置）
- [√] 5.2 调整自动跳过逻辑：只对被勾选类别的 WATER 生效
- [√] 5.3 热力图 hover/卡片上展示注水原因（短文案）

## 6. Dashboard：成本/耗时对比展示
- [√] 6.1 Dashboard 新增 “Cascade 指标”模块：cheap vs strong 对比
- [√] 6.2 展示字段：调用次数、总耗时、输入/输出体量（或 tokens），以及“估算/真实”的标注
- [-] 6.3 支持按 runId 查看（若做了版本化 run）（先展示 latest run）

## 7. 文档与知识库同步
- [√] 7.1 更新 `helloagents/wiki/overview.md`：新增 Model Cascade 与可解释注水亮点
- [√] 7.2 更新 `helloagents/wiki/modules/agent.md` / `modules/ui.md`：补充新字段与交互
- [√] 7.3 更新 `helloagents/CHANGELOG.md`：记录新增能力

## 8. 验证与回归
- [?] 8.1 冒烟：开启 cascade → 先出热力图 → strong 后 TopK summary 变更 → Reflection Gate 仍可用（待你在 Chrome 实测）
- [?] 8.2 冒烟：WATER 分类展示正确；默认过滤策略生效；不默认跳过寒暄/跑题（待你在 Chrome 实测）
- [?] 8.3 Dashboard：能看到 cheap/strong 指标对比（至少耗时与体量）（待你在 Chrome 实测）
