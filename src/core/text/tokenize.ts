/**
 * Mixed Chinese/English tokenizer for BM25 and lexical grounding.
 *
 * Chinese has no spaces, so naive whitespace splitting turns a whole sentence
 * into one token. `Intl.Segmenter` ships a dictionary-based word breaker in
 * Chrome and Node, which gives real words ("注意力", "机制") at zero bundle
 * cost. Dictionary segmentation is not always consistent between a short query
 * and a long passage ("自注意力" vs "自 注意力"), so multi-character CJK words
 * also emit their character bigrams; that keeps recall high without letting
 * single characters dominate the score.
 */

const STOPWORDS = new Set(
  (
    '的 了 是 在 我 你 他 她 它 们 这 那 就 都 也 和 与 及 而 并 或 一个 一下 一些 这个 那个 这些 那些 ' +
    '什么 怎么 为什么 如何 吗 呢 吧 啊 哦 嗯 呀 哈 哈哈 然后 所以 因为 但是 如果 就是 其实 还是 可以 ' +
    '我们 你们 他们 大家 自己 没有 不是 有 要 会 能 说 讲 去 来 到 对 把 被 让 给 从 很 太 更 最 ' +
    '视频 up 主 今天 这里 那里 一样 东西 时候 the a an of to and or is are was were be been in on at ' +
    'for with as by it this that these those i you he she we they do does did not no yes so if then'
  ).split(/\s+/)
);

const CJK_RE = /[㐀-䶿一-鿿豈-﫿]/;

let segmenter: Intl.Segmenter | null = null;
function getSegmenter(): Intl.Segmenter | null {
  if (segmenter) return segmenter;
  if (typeof Intl === 'undefined' || typeof (Intl as any).Segmenter !== 'function') return null;
  segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
  return segmenter;
}

export function isCjk(text: string): boolean {
  return CJK_RE.test(text);
}

function normalize(text: string): string {
  return text.normalize('NFKC').toLowerCase();
}

function fallbackWords(text: string): string[] {
  // Split runs of CJK into single characters, keep latin/digit runs together.
  return text.match(/[㐀-䶿一-鿿豈-﫿]|[a-z0-9]+(?:[._+-][a-z0-9]+)*/g) ?? [];
}

function rawWords(text: string): string[] {
  const seg = getSegmenter();
  if (!seg) return fallbackWords(text);
  const out: string[] = [];
  for (const part of seg.segment(text)) {
    if (part.isWordLike) out.push(part.segment);
  }
  return out;
}

/** Tokens for indexing and querying. Order is preserved; duplicates are kept (BM25 needs term frequency). */
export function tokenize(text: string): string[] {
  const words = rawWords(normalize(text));
  const tokens: string[] = [];
  for (const w of words) {
    const word = w.trim();
    if (!word || STOPWORDS.has(word)) continue;
    if (isCjk(word)) {
      if (word.length === 1) {
        tokens.push(word);
        continue;
      }
      tokens.push(word);
      if (word.length >= 3) {
        for (let i = 0; i < word.length - 1; i += 1) tokens.push(word.slice(i, i + 2));
      }
    } else if (word.length >= 2 || /\d/.test(word)) {
      tokens.push(word);
    }
  }
  return tokens;
}

/** Content words only (no bigrams, no single CJK chars): used to judge whether a summary is grounded. */
export function contentWords(text: string): string[] {
  const words = rawWords(normalize(text));
  const out = new Set<string>();
  for (const w of words) {
    const word = w.trim();
    if (!word || STOPWORDS.has(word)) continue;
    if (isCjk(word) ? word.length >= 2 : word.length >= 3) out.add(word);
  }
  return Array.from(out);
}
