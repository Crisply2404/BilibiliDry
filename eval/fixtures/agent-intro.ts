import type { Fixture } from './types';

export const agentIntro: Fixture = {
  id: 'agent-intro',
  title: '大模型 Agent 入门：从 ReAct 到工具调用，一期讲透',
  blocks: [
    {
      id: 'greet',
      kind: 'water',
      reason: 'smalltalk',
      text: '哈喽大家好，欢迎回到我的频道。最近天气突然变冷了，大家记得多穿点衣服。我前两天也感冒了，所以这期声音可能有点哑，大家多担待。好，废话不多说，我们直接开始。'
    },
    {
      id: 'definition',
      kind: 'dry',
      key: true,
      text: '首先说什么是 Agent。我给的定义是：Agent 等于大模型加上一个循环，再加上工具。大模型负责决定下一步做什么，循环负责把结果喂回给模型，工具负责真正去执行动作。单独一个大模型只能一问一答，它没法自己去查资料，也没法根据中间结果改主意。'
    },
    {
      id: 'react',
      kind: 'dry',
      key: true,
      text: '最经典的范式叫 ReAct，就是推理加行动。模型先写一段思考，然后选一个工具和参数，程序执行工具，把观察结果拼回上下文，模型再继续思考。这样一轮一轮下去，直到模型认为信息够了，给出最终答案。ReAct 的论文是二零二二年发的，现在几乎所有 Agent 框架的核心循环都是这个结构。'
    },
    {
      id: 'sponsor',
      kind: 'water',
      reason: 'ad',
      text: '在继续之前插播一下本期的赞助商。某某云服务器，新用户首年只要九十九元，两核四 G，带宽五兆，非常适合用来部署你自己的小项目。评论区置顶有专属链接，用我的优惠码还能再打八折。感谢某某云对本频道的支持。'
    },
    {
      id: 'function-calling',
      kind: 'dry',
      key: true,
      text: '好，回到正题。早期的 ReAct 是让模型用文本格式输出动作，然后程序用正则去解析，经常解析失败。现在主流的做法是函数调用，也叫 function calling。你把工具写成 JSON Schema 传给模型，模型直接返回结构化的工具名和参数，解析出错的概率大大降低。OpenAI、Claude、通义、DeepSeek 都支持这个格式。'
    },
    {
      id: 'tool-design',
      kind: 'dry',
      text: '设计工具的时候有三个经验。第一，工具的描述要写清楚什么时候该用，模型是靠描述来选工具的。第二，返回结果要短，只返回模型需要的信息，不然上下文很快就爆了。第三，参数尽量少，能用默认值就用默认值。'
    },
    {
      id: 'repeat1',
      kind: 'water',
      reason: 'repeat',
      text: '所以我再强调一遍啊，工具描述一定要写清楚，返回结果一定要短，参数一定要少。这三点非常非常重要，大家一定要记住，描述清楚，结果要短，参数要少。'
    },
    {
      id: 'memory',
      kind: 'dry',
      key: true,
      text: '接下来讲记忆。Agent 的记忆一般分两种。短期记忆就是当前对话的上下文窗口，窗口满了就要做压缩，比如把早期的对话总结成一段摘要。长期记忆是存在外部的，比如向量数据库，需要的时候再检索出来放进上下文，本质上就是 RAG。'
    },
    {
      id: 'rag',
      kind: 'dry',
      text: '说到 RAG，很多人只做向量检索，其实效果不一定好。专有名词、人名、数字这类东西，关键词检索 BM25 反而更准。比较稳的做法是混合检索，关键词和向量各召回一批，再用 RRF 倒数排名融合，最后可以再接一个重排模型。'
    },
    {
      id: 'eval',
      kind: 'dry',
      key: true,
      text: '最后也是最容易被忽略的一点，就是评测。没有评测集，你根本不知道改了提示词之后是变好了还是变差了。我的建议是先手工标注五十条真实问题，记录每条的正确答案在哪里，然后每次改动都跑一遍，看召回率、答案准确率和平均调用次数。'
    },
    {
      id: 'cost',
      kind: 'dry',
      text: '还有成本问题。Agent 一轮可能调用模型五六次，比普通问答贵好几倍。常见的省钱办法是大小模型级联：便宜的小模型做路由和初筛，只有难的步骤才交给大模型。'
    },
    {
      id: 'outro',
      kind: 'water',
      reason: 'smalltalk',
      text: '好，这期视频就到这里。如果觉得有帮助的话，别忘了一键三连，点赞投币收藏，你们的支持是我更新的最大动力。我们下期再见，拜拜。'
    }
  ],
  queries: [
    { q: 'ReAct 是什么意思', gold: ['react'], style: 'lexical' },
    { q: 'Agent 的定义', gold: ['definition'], style: 'lexical' },
    { q: '为什么不让模型用文本输出动作再用正则解析', gold: ['function-calling'], style: 'paraphrase' },
    { q: '工具应该怎么设计', gold: ['tool-design', 'repeat1'], style: 'lexical' },
    { q: '对话太长上下文装不下怎么办', gold: ['memory'], style: 'paraphrase' },
    { q: '只用向量检索有什么问题', gold: ['rag'], style: 'lexical' },
    { q: '怎么知道改了 prompt 以后效果是变好还是变差', gold: ['eval'], style: 'paraphrase' },
    { q: '怎么降低调用大模型的花费', gold: ['cost'], style: 'paraphrase' },
    { q: '本期赞助商的服务器多少钱', gold: ['sponsor'], style: 'paraphrase' },
    { q: 'RRF 倒数排名融合', gold: ['rag'], style: 'lexical' }
  ]
};
