import type { Fixture } from './types';

export const braisedPork: Fixture = {
  id: 'braised-pork',
  title: '十年老厨师教你做红烧肉，肥而不腻入口即化',
  blocks: [
    {
      id: 'intro',
      kind: 'water',
      reason: 'smalltalk',
      text: '各位老铁大家好，我是老王。今天外面下着大雨，正好在家做个硬菜。上期视频好多人在评论区催更红烧肉，今天它来了。'
    },
    {
      id: 'choose-meat',
      kind: 'dry',
      key: true,
      text: '先说选肉。一定要选五花肉，而且要选五层的，就是肥瘦相间分得很清楚的那种。肉皮要薄，用手按一下回弹快的比较新鲜。一斤半左右够一家三口吃。'
    },
    {
      id: 'blanch',
      kind: 'dry',
      key: true,
      text: '肉切成三厘米左右的方块，冷水下锅焯水。水里放两片姜和一勺料酒，水开以后再煮两分钟，把血沫撇干净。捞出来用温水冲洗，千万别用冷水，冷水一激肉会发紧，后面就炖不烂了。'
    },
    {
      id: 'story',
      kind: 'water',
      reason: 'offtopic',
      text: '说到这个我想起我刚学厨那会儿，师傅让我焯了一个礼拜的肉，天天就干这一件事。那时候觉得特别委屈，现在想想还挺感谢他的。那会儿工资一个月才八百块，住在饭店后面的宿舍里，冬天冷得睡不着。'
    },
    {
      id: 'sugar',
      kind: 'dry',
      key: true,
      text: '接下来是关键，炒糖色。锅里放少量油，加三十克冰糖，小火慢慢炒，一直炒到冰糖化开，颜色变成枣红色，冒小泡泡的时候马上下肉。火大了糖会发苦，颜色太浅又上不了色，这一步一定要盯紧。'
    },
    {
      id: 'stew',
      kind: 'dry',
      key: true,
      text: '肉裹上糖色以后，加一勺生抽，半勺老抽，再加八角两个、桂皮一小块、香叶两片。然后加开水，水要没过肉。一定要加开水，加冷水肉会变柴。大火烧开转小火，盖上盖子炖一个小时。'
    },
    {
      id: 'repeat',
      kind: 'water',
      reason: 'repeat',
      text: '记住啊，加开水，一定要加开水，不要加冷水。开水开水开水，重要的事情说三遍。'
    },
    {
      id: 'ad',
      kind: 'water',
      reason: 'ad',
      text: '对了，我用的这口锅是某某牌的铸铁锅，导热均匀还不粘，现在旗舰店在做活动，买锅送铲子，链接我放在简介里了，有需要的朋友可以看看。'
    },
    {
      id: 'reduce',
      kind: 'dry',
      key: true,
      text: '炖到一个小时，用筷子能轻松戳透就说明好了。这时候开大火收汁，要不停翻动，防止糊锅。汤汁变得浓稠，能挂在肉上，表面亮晶晶的，就可以出锅了。最后撒一点葱花点缀。'
    },
    {
      id: 'tips',
      kind: 'dry',
      text: '最后说两个小技巧。如果怕腻，可以在炖的时候放几块土豆或者鹌鹑蛋一起炖，能吸掉一部分油。另外收汁的时候加一点点醋，能解腻提香，但是别多，多了就酸了。'
    },
    {
      id: 'outro',
      kind: 'water',
      reason: 'smalltalk',
      text: '好了，今天的红烧肉就做好了，看着是不是很有食欲。喜欢的话点个关注，下期教大家做糖醋排骨，我们下期见。'
    }
  ],
  queries: [
    { q: '买什么样的五花肉', gold: ['choose-meat'], style: 'lexical' },
    { q: '焯水以后为什么不能用冷水冲', gold: ['blanch'], style: 'lexical' },
    { q: '糖色怎么炒才不会苦', gold: ['sugar'], style: 'paraphrase' },
    { q: '需要放哪些香料', gold: ['stew'], style: 'paraphrase' },
    { q: '炖多久', gold: ['stew', 'reduce'], style: 'paraphrase' },
    { q: '怎么判断肉已经炖好了', gold: ['reduce'], style: 'paraphrase' },
    { q: '吃起来太油腻怎么办', gold: ['tips'], style: 'paraphrase' },
    { q: '铸铁锅', gold: ['ad'], style: 'lexical' }
  ]
};
