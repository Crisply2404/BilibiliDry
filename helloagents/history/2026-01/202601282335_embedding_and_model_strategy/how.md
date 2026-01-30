# 技术设计: Embedding 与模型策略（已暂缓）

## 结论
本阶段不引入 embedding。跨视频语义检索改为后续可选增强，优先完成“本视频体验”。

## 原因摘要
- `/embeddings` 端点不可用/权限不稳定时，工程风险过高
- 语义检索不是当前 MVP 的阻断项
- 关键词检索可作为阶段性替代

## 后续恢复思路（备忘）
- 若供应商提供 embedding 权限：可恢复“embedding 召回 + LLM 重排”
- 或改用其他 embedding provider（OpenAI/Gemini 等）并保持 BYOK

