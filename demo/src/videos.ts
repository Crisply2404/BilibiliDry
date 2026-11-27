import { agentIntro } from '../../eval/fixtures/agent-intro';
import { braisedPork } from '../../eval/fixtures/braised-pork';
import { buildFixture, type BuiltFixture } from '../../eval/fixtures/build';
import type { CaptionLine } from '../../src/core/types';

/**
 * What the scripted model "writes" for one fixture block. Everything here is
 * prepared by hand from the block's own words; the pipeline still decides how
 * blocks are cut into chunks, scores grounding, and picks the highlights.
 */
export interface BlockNote {
  title: string;
  summary: string;
  keyPoints?: string[];
  importance: number;
}

/**
 * A prepared answer. `steps` are the tool calls the scripted model makes, one
 * array per agent step; `answer` may cite `{blockId}`, which becomes a
 * timestamp inside whatever evidence the tools actually returned.
 */
export interface PreparedAnswer {
  match: RegExp;
  steps: Array<Array<{ name: string; args: Record<string, unknown> }>>;
  answer: string;
}

export interface DemoVideo {
  bvid: string;
  aid: number;
  cid: number;
  owner: string;
  media: string;
  built: BuiltFixture;
  notes: Record<string, BlockNote>;
  digest: { tldr: string; takeaways: string[]; chapters: Array<{ block: string; title: string; summary: string }> };
  /** Answer to "有没有提到具体的数据或例子？", one of the overlay's suggested questions. */
  answers: PreparedAnswer[];
}

const search = (query: string, k = 5) => ({ name: 'search_transcript', args: { query, k } });

export const DEMO_VIDEOS: DemoVideo[] = [
  {
    bvid: 'BV1dryAgent1',
    aid: 9001,
    cid: 90011,
    owner: '示例UP · 代码',
    media: 'media/agent-intro.mp4',
    built: buildFixture(agentIntro),
    notes: {
      greet: { title: '开场寒暄', summary: 'UP 主打招呼，聊了几句天气和感冒，然后进入正题。', importance: 1 },
      definition: {
        title: 'Agent 的定义',
        summary: 'Agent 等于大模型加上一个循环，再加上工具：大模型决定下一步做什么，循环把结果喂回给模型，工具负责执行动作。',
        keyPoints: ['单独一个大模型只能一问一答，没法自己去查资料', '有了循环，模型能根据中间结果改主意'],
        importance: 5
      },
      react: {
        title: 'ReAct：推理加行动',
        summary: '模型先写一段思考，再选一个工具和参数；程序执行工具，把观察结果拼回上下文，一轮一轮直到信息够了再给最终答案。',
        keyPoints: ['ReAct 的论文是二零二二年发的', '现在几乎所有 Agent 框架的核心循环都是这个结构'],
        importance: 5
      },
      sponsor: { title: '云服务器广告', summary: '插播赞助商某某云服务器：新用户首年九十九元，评论区置顶有优惠码。', importance: 1 },
      'function-calling': {
        title: '用函数调用代替正则解析',
        summary: '早期 ReAct 让模型用文本输出动作再用正则解析，经常失败；现在把工具写成 JSON Schema 传给模型，模型直接返回结构化的工具名和参数。',
        keyPoints: ['OpenAI、Claude、通义、DeepSeek 都支持 function calling'],
        importance: 5
      },
      'tool-design': {
        title: '设计工具的三个经验',
        summary: '工具描述要写清楚什么时候该用，返回结果要短，参数尽量少。',
        keyPoints: ['模型是靠描述来选工具的', '返回太长上下文很快就爆了', '能用默认值就用默认值'],
        importance: 4
      },
      repeat1: { title: '重复强调三点', summary: '把工具设计的三点经验又重复说了一遍。', importance: 1 },
      memory: {
        title: '短期记忆和长期记忆',
        summary: '短期记忆是当前对话的上下文窗口，满了要压缩成摘要；长期记忆存在外部，比如向量数据库，需要时检索出来放进上下文，本质上就是 RAG。',
        importance: 5
      },
      rag: {
        title: '混合检索比纯向量稳',
        summary: '专有名词、人名、数字这类内容用关键词检索 BM25 更准；关键词和向量各召回一批，用 RRF 倒数排名融合，最后可以再接重排模型。',
        importance: 4
      },
      eval: {
        title: '先建评测集',
        summary: '没有评测集就不知道改了提示词之后是变好还是变差；先手工标注五十条真实问题，每次改动都跑一遍。',
        keyPoints: ['看召回率、答案准确率和平均调用次数'],
        importance: 5
      },
      cost: {
        title: '大小模型级联省钱',
        summary: 'Agent 一轮可能调用模型五六次，比普通问答贵好几倍；便宜的小模型做路由和初筛，只有难的步骤才交给大模型。',
        importance: 4
      },
      outro: { title: '结尾求三连', summary: '求一键三连，下期再见。', importance: 1 }
    },
    digest: {
      tldr: 'Agent = 大模型 + 循环 + 工具；讲了 ReAct、函数调用、工具设计、记忆与混合检索，以及评测和成本。',
      takeaways: [
        'Agent 由大模型、循环和工具组成，循环让模型能根据中间结果改主意',
        'ReAct：先思考，再调用工具，把观察结果喂回模型，循环到信息足够',
        '用 function calling 返回结构化的工具调用，代替正则解析文本',
        '工具描述写清楚、返回结果要短、参数要少',
        '检索用 BM25 + 向量混合召回，再用 RRF 融合',
        '先手工标注评测集，每次改动都跑一遍'
      ],
      chapters: [
        { block: 'definition', title: 'Agent 与 ReAct', summary: 'Agent 的定义和 ReAct 循环' },
        { block: 'function-calling', title: '函数调用与工具设计', summary: '为什么用函数调用，工具怎么设计' },
        { block: 'memory', title: '记忆与检索', summary: '短期/长期记忆，以及混合检索' },
        { block: 'eval', title: '评测与成本', summary: '先建评测集，用大小模型级联省钱' }
      ]
    },
    answers: [
      {
        match: /数据|数字|例子|举例/,
        steps: [[search('二零二二年 论文'), search('五十条 评测')], [search('五六次 贵'), search('九十九元')]],
        answer:
          '提到了几处具体的数字：\n\n- ReAct 的论文是二零二二年发的 {react}\n- 评测建议先手工标注五十条真实问题，每次改动都跑一遍 {eval}\n- Agent 一轮可能调用模型五六次，比普通问答贵好几倍 {cost}\n- 云服务器新用户首年九十九元 {sponsor}，不过这段是广告\n\n例子方面，UP 主用专有名词、人名、数字说明关键词检索 BM25 有时比向量检索更准 {rag}。'
      },
      {
        match: /ReAct|推理加行动/i,
        steps: [[search('ReAct 推理 行动')]],
        answer:
          'ReAct 就是“推理加行动” {react}：\n\n1. 模型先写一段思考，再选一个工具和参数；\n2. 程序执行工具，把观察结果拼回上下文；\n3. 模型接着思考，一轮一轮下去，直到认为信息够了才给最终答案。\n\nUP 主还提到，现在几乎所有 Agent 框架的核心循环都是这个结构 {react}。'
      },
      {
        match: /检索|RAG|BM25|向量|RRF/i,
        steps: [[search('向量检索 关键词检索 BM25'), search('长期记忆 向量数据库')]],
        answer:
          '视频的建议是别只做向量检索：\n\n- 专有名词、人名、数字这类内容，关键词检索 BM25 反而更准 {rag}\n- 比较稳的做法是混合检索：关键词和向量各召回一批，用 RRF 倒数排名融合，最后可以再接一个重排模型 {rag}\n\n前面讲记忆时也提到，长期记忆存在向量数据库里、需要时检索出来，本质上就是 RAG {memory}。'
      },
      {
        match: /评测|变好|变差|提示词|prompt/i,
        steps: [[search('评测集 变好 变差')]],
        answer:
          '靠评测集 {eval}：\n\n- 先手工标注五十条真实问题，记录每条的正确答案在哪里；\n- 每次改动都跑一遍，看召回率、答案准确率和平均调用次数。\n\nUP 主说这是最容易被忽略的一点，没有评测集就不知道改了提示词之后是变好了还是变差了 {eval}。'
      },
      {
        match: /成本|花费|省钱|便宜|贵/,
        steps: [[search('成本 省钱 小模型 大模型')]],
        answer: '用大小模型级联 {cost}：便宜的小模型做路由和初筛，只有难的步骤才交给大模型。原因是 Agent 一轮可能调用模型五六次，比普通问答贵好几倍 {cost}。'
      },
      {
        match: /工具.*(设计|怎么写)|设计.*工具/,
        steps: [[search('设计工具 经验')]],
        answer: '视频给了三个经验 {tool-design}：\n\n1. 工具描述要写清楚什么时候该用，模型是靠描述来选工具的；\n2. 返回结果要短，只返回模型需要的信息，不然上下文很快就爆了；\n3. 参数尽量少，能用默认值就用默认值。\n\n后面还有一段把这三点又重复了一遍，可以跳过 {repeat1}。'
      },
      {
        match: /赞助|广告|服务器/,
        steps: [[search('赞助商 云服务器')]],
        answer: '赞助商是某某云服务器：新用户首年九十九元，两核四 G、带宽五兆，评论区置顶有专属链接，用优惠码还能再打八折 {sponsor}。这一段是广告，可以直接跳过。'
      }
    ]
  },
  {
    bvid: 'BV1dryPork01',
    aid: 9002,
    cid: 90021,
    owner: '示例UP · 厨房',
    media: 'media/braised-pork.mp4',
    built: buildFixture(braisedPork),
    notes: {
      intro: { title: '开场寒暄', summary: '老王打招呼，说评论区好多人催更红烧肉。', importance: 1 },
      'choose-meat': {
        title: '选五层五花肉',
        summary: '选肥瘦相间、分得很清楚的五层五花肉，肉皮要薄，用手按一下回弹快的比较新鲜。',
        keyPoints: ['一斤半左右够一家三口吃'],
        importance: 5
      },
      blanch: {
        title: '冷水下锅焯水',
        summary: '肉切成三厘米左右的方块，冷水下锅，放姜和料酒，水开后再煮两分钟，撇干净血沫；捞出用温水冲洗。',
        keyPoints: ['千万别用冷水冲，冷水一激肉会发紧，后面就炖不烂了'],
        importance: 5
      },
      story: { title: '学厨往事', summary: '回忆刚学厨时焯了一个礼拜的肉，还有当年的工资和宿舍。', importance: 1 },
      sugar: {
        title: '炒糖色',
        summary: '少量油加三十克冰糖小火慢炒，炒到枣红色、冒小泡泡时马上下肉。',
        keyPoints: ['火大了糖会发苦', '颜色太浅又上不了色'],
        importance: 5
      },
      stew: {
        title: '调味和炖煮',
        summary: '加生抽、老抽、八角、桂皮、香叶，再加没过肉的开水，大火烧开转小火，盖上盖子炖一个小时。',
        keyPoints: ['一定要加开水，加冷水肉会变柴'],
        importance: 5
      },
      repeat: { title: '重复：要加开水', summary: '把“一定要加开水”又说了三遍。', importance: 1 },
      ad: { title: '铸铁锅广告', summary: '推荐某某牌铸铁锅，旗舰店买锅送铲子，链接在简介里。', importance: 1 },
      reduce: {
        title: '大火收汁',
        summary: '炖到筷子能轻松戳透就好了；开大火收汁，不停翻动防止糊锅，汤汁浓稠能挂在肉上就可以出锅。',
        keyPoints: ['最后撒一点葱花点缀'],
        importance: 5
      },
      tips: {
        title: '防腻小技巧',
        summary: '炖的时候放几块土豆或者鹌鹑蛋，能吸掉一部分油；收汁时加一点点醋能解腻提香，但别多。',
        importance: 4
      },
      outro: { title: '结尾', summary: '求关注，预告下期做糖醋排骨。', importance: 1 }
    },
    digest: {
      tldr: '红烧肉做法：选五层五花肉，冷水焯水后温水冲，炒糖色，加开水炖一个小时，最后大火收汁。',
      takeaways: [
        '选肥瘦相间的五层五花肉，肉皮要薄',
        '冷水下锅焯水，捞出用温水冲，别用冷水',
        '三十克冰糖小火炒到枣红色、冒小泡就下肉',
        '加没过肉的开水，小火炖一个小时',
        '筷子能戳透后大火收汁；怕腻可加土豆或一点醋'
      ],
      chapters: [
        { block: 'choose-meat', title: '选肉和焯水', summary: '五花肉怎么选，焯水的要点' },
        { block: 'sugar', title: '炒糖色', summary: '火候和颜色' },
        { block: 'stew', title: '调味和炖煮', summary: '香料、开水和时间' },
        { block: 'reduce', title: '收汁和小技巧', summary: '判断熟度、收汁、防腻' }
      ]
    },
    answers: [
      {
        match: /数据|数字|例子|举例|用量|多少/,
        steps: [[search('三厘米 两分钟'), search('三十克 冰糖')], [search('一个小时'), search('一斤半')]],
        answer:
          '提到的具体用量和时间：\n\n- 五花肉一斤半左右，够一家三口吃 {choose-meat}\n- 切成三厘米左右的方块，水开以后再煮两分钟 {blanch}\n- 冰糖三十克，小火炒到枣红色 {sugar}\n- 生抽一勺、老抽半勺，八角两个、香叶两片，小火炖一个小时 {stew}'
      },
      {
        match: /糖色|发苦|苦/,
        steps: [[search('炒糖色 冰糖 发苦')]],
        answer: '关键是小火 {sugar}：锅里放少量油，加三十克冰糖小火慢炒，炒到冰糖化开、颜色变成枣红色、冒小泡泡时马上下肉。火大了糖会发苦，颜色太浅又上不了色，这一步要盯紧 {sugar}。'
      },
      {
        match: /开水|冷水|温水/,
        steps: [[search('开水 冷水'), search('温水冲洗')]],
        answer: '视频里有两处讲水温：\n\n- 焯完水捞出来要用温水冲，千万别用冷水，冷水一激肉会发紧，后面就炖不烂了 {blanch}\n- 炖的时候要加开水、没过肉，加冷水肉会变柴 {stew}'
      },
      {
        match: /多久|炖好|熟了|时间/,
        steps: [[search('炖 一个小时'), search('筷子 戳透')]],
        answer: '大火烧开后转小火，盖上盖子炖一个小时 {stew}。判断标准是用筷子能轻松戳透，然后开大火收汁 {reduce}。'
      },
      {
        match: /腻|油/,
        steps: [[search('怕腻 解腻')]],
        answer: '视频给了两个办法 {tips}：\n\n- 炖的时候放几块土豆或鹌鹑蛋一起炖，能吸掉一部分油；\n- 收汁时加一点点醋，能解腻提香，但别多，多了就酸了。'
      },
      {
        match: /香料|八角|桂皮|调料/,
        steps: [[search('八角 桂皮 香叶')]],
        answer: '香料是八角两个、桂皮一小块、香叶两片，调味用一勺生抽、半勺老抽 {stew}。'
      }
    ]
  }
];

export function videoByBvid(bvid: string): DemoVideo | undefined {
  return DEMO_VIDEOS.find((v) => v.bvid === bvid);
}

export function videoByTitle(text: string): DemoVideo | undefined {
  return DEMO_VIDEOS.find((v) => text.includes(v.built.video.title));
}

/** The fixture block a moment of the video belongs to (gaps between blocks count as the next block). */
export function blockAt(v: DemoVideo, time: number): string {
  let last = '';
  for (const [id, span] of v.built.spans) {
    last = id;
    if (time < span.end) return id;
  }
  return last;
}

export function lineBlock(v: DemoVideo, line: CaptionLine): string {
  return blockAt(v, (line.from + line.to) / 2);
}
