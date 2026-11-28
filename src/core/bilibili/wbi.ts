/**
 * Bilibili's WBI request signing, needed by the AI-summary and player APIs.
 *
 * The site publishes two key images in /x/web-interface/nav; their file names, shuffled by a
 * fixed table, give a 32-character mixin key. A request is signed by sorting its parameters,
 * adding `wts` (unix seconds) and appending `w_rid = md5(query + mixinKey)`.
 */

const MIXIN_TABLE = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52
];

export function mixinKey(imgUrl: string, subUrl: string): string {
  const name = (u: string) => u.slice(u.lastIndexOf('/') + 1).split('.')[0];
  const raw = name(imgUrl) + name(subUrl);
  return MIXIN_TABLE.map((i) => raw[i] ?? '')
    .join('')
    .slice(0, 32);
}

export function signQuery(params: Record<string, string | number>, key: string, now = Date.now()): string {
  const all: Record<string, string> = { ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), wts: String(Math.floor(now / 1000)) };
  const query = Object.keys(all)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(all[k].replace(/[!'()*]/g, ''))}`)
    .join('&');
  return `${query}&w_rid=${md5(query + key)}`;
}

/** MD5 of a UTF-8 string, as lowercase hex. WebCrypto has no MD5, and this is all WBI needs. */
export function md5(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const words = new Uint32Array((((bytes.length + 8) >>> 6) + 1) * 16);
  for (let i = 0; i < bytes.length; i += 1) words[i >>> 2] |= bytes[i] << ((i % 4) * 8);
  words[bytes.length >>> 2] |= 0x80 << ((bytes.length % 4) * 8);
  words[words.length - 2] = (bytes.length * 8) >>> 0;
  words[words.length - 1] = Math.floor((bytes.length * 8) / 2 ** 32);

  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  for (let block = 0; block < words.length; block += 16) {
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i += 1) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const shift = S[(i >>> 4) * 4 + (i % 4)];
      const sum = (a + f + K[i] + words[block + g]) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + ((sum << shift) | (sum >>> (32 - shift)))) >>> 0;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  return [a0, b0, c0, d0]
    .map((n) => Array.from({ length: 4 }, (_, i) => ((n >>> (i * 8)) & 0xff).toString(16).padStart(2, '0')).join(''))
    .join('');
}
