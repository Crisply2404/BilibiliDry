# 参考项目拆解：SummaryExpressive

## 1. 项目定位

**一句话**：Android 上的现代 BYOK（Bring Your Own Key）摘要应用：支持视频/文章/图片/文档，强调多 Provider、分享即摘要、历史搜索与 Material 3 Expressive 体验。

**对 BilibiliDry 的启示**
- “BYOK + 多 Provider + 历史/搜索”在移动端的成熟形态；
- 触发入口做得非常产品化（分享面板/文本选中/剪贴板），可迁移到浏览器扩展的交互设计。

## 2. 代码与工程形态（你仓库内位置）

- 项目根目录：`reference/SummaryExpressive/`
- Android App：`reference/SummaryExpressive/app/`
- 隐私政策：`reference/SummaryExpressive/PRIVACY.md`
- README：`reference/SummaryExpressive/README.md`

## 3. 架构（Android 端的“业界水平”做法）

**技术栈**
- Kotlin + Jetpack Compose + Material 3 Expressive
- MVVM + Repository
- Room（历史记录）
- DataStore（用户配置）
- Hilt（依赖注入）
- Ktor + Jsoup（文章抓取/清洗）
-（可选）ML Kit OCR（图片/文档）

**核心模块划分（按职责）**
- UI：Home / History / Settings / Onboarding
- ViewModel：`SummaryViewModel`、`HistoryViewModel`、`AppViewModel`
- Data：Room DB（history）、DataStore（偏好/Key/登录态）
- LLM：Provider 抽象、Prompt 管理、工具化内容抽取

## 4. 多 Provider 与 BYOK（可对标的关键点）

**支持的 Provider（README 声明）**
- OpenAI、Gemini、Claude、DeepSeek、Mistral、Qwen、OpenRouter、Ollama 等

**配置能力**
- Provider / Model / Base URL / API Key
- 语言/摘要长度等策略参数

> BilibiliDry 当前已经支持 Gemini + OpenAI-compatible，SummaryExpressive 展示了“多 Provider 产品化”的成熟交互与配置管理方式。

## 5. 内容抽取与工具链（“先抽取再摘要”）

SummaryExpressive 的特点是把“不同内容类型”抽象为工具：
- 文章：HTML 拉取 → Jsoup 清洗提取正文
- YouTube：获取 transcript
- BiliBili：通过 SESSDATA 登录态获取字幕
- 文件/图片：PDF/Docx/图片文本提取（含 OCR）

这种“工具化抽取”能让摘要链路稳定，也便于扩展新内容源。

## 6. 触发入口设计（非常产品化）

**多入口触发**
- 分享面板：`ACTION_SEND`（文本/文件/图片）
- 文本选中：`ACTION_PROCESS_TEXT`
- 剪贴板 scheme：`summaryexpressive://clipboard`

**即时摘要体验**
- `InstantSummaryActivity` 以弹窗形式展示结果，支持一键复制

> 对 BilibiliDry：可对标实现“选中字幕片段/复制文本 → 立即生成要点/卡片”的轻量入口。

## 7. 历史与搜索（本地沉淀）

- Room `history` 表记录摘要结果
- History 页面支持搜索、过滤、分页、删除（含撤销）

> 对 BilibiliDry：你已有 IndexedDB 记忆与搜索；可对标更“用户可控”的历史管理（按来源/时间/标签过滤、删除/导出等）。

## 8. 隐私与合规（值得对标但要谨慎迁移）

`PRIVACY.md` 明确说明：
- 用户内容会被发送给第三方 LLM 提供商以完成摘要
- 可能启用分析/稳定性收集（例如 Firebase Analytics）
- 数据保留策略、未成年人限制等

对 BilibiliDry 来说，虽然“纯扩展 + BYOK”更隐私友好，但仍建议：
- 明确告知“会把字幕内容发送给所选模型提供商”
- 提供一键清空/导出/关闭记忆的 UI
- 对 cookie/登录态（若未来需要）做最小化与安全存储说明

## 9. 可直接借鉴到 BilibiliDry 的点

- **多 Provider 配置的 UX 模式**：Provider 选择 + Base URL + Model 管理 + 参数分组。
- **触发入口**：把能力“嵌入用户工作流”（分享/选中/快捷动作），而不是只做一个主页面按钮。
- **历史/搜索的产品化**：可视化、可过滤、可删除、可撤销、可导出。

