// Tier1 机械盲备:从真实语料选取"长令牌"事实,输出问题(锚点=令牌前原文片段,不含答案令牌),答案写 keys。
// Usage: node prep-probes.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const corpusFile = join(here, 'tier1-corpus.txt');
const probesFile = join(here, '..', 'probes', 'tier1-probes.json');
const keysFile = join(here, 'tier1-keys.json');

const raw = readFileSync(corpusFile, 'utf8');
const lines = raw.split('\n').filter(Boolean).map((l) => {
  const i1 = l.indexOf('|');
  const i2 = l.indexOf('|', i1 + 1);
  return { seq: Number(l.slice(0, i1)), type: l.slice(i1 + 1, i2), text: l.slice(i2 + 1) };
});

function countOccurrences(hay, needle) { let n = 0, i = 0; while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; } return n; }

const TOKEN_RE = /[A-Za-z0-9][A-Za-z0-9_./:\\-]{15,}/g;

// 返回 line 中满足约束的第一个令牌及锚点;seen 保证不重复。
function findToken(line, seen, maxOcc) {
  TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = TOKEN_RE.exec(line.text)) !== null) {
    const tok = m[0];
    const pos = m.index;
    if (pos >= 15 && tok.length >= 16 && !seen.has(tok) && countOccurrences(raw, tok) <= maxOcc) {
      const anchor = line.text.slice(Math.max(0, pos - 70), pos).replace(/\s+/g, ' ').trim();
      if (anchor.length < 8) continue;
      seen.add(tok);
      return { token: tok, anchor };
    }
  }
  return null;
}

const candidates = lines.filter((l) => (l.type === 'tool/result' || l.type === 'assistant/message') && l.text.length > 40);
const fracs = [0.05, 0.2, 0.38, 0.55, 0.7, 0.88];
const exists = [];
const seen = new Set();
for (const f of fracs) {
  const idx = Math.min(candidates.length - 1, Math.floor(candidates.length * f));
  const hit = findToken(candidates[idx], seen, 1);
  if (hit) exists.push({ id: `E${exists.length + 1}`, seq: candidates[idx].seq, type: candidates[idx].type, token: hit.token, anchor: hit.anchor });
}
if (exists.length < 6) {
  for (const line of candidates) {
    if (exists.length >= 6) break;
    const hit = findToken(line, seen, 2);
    if (hit) exists.push({ id: `E${exists.length + 1}`, seq: line.seq, type: line.type, token: hit.token, anchor: hit.anchor });
  }
}

const absent = [];
const absTry = ['QuasarRigelAuroraVendor-9k2m', 'NebulaPipelineDeploy-7t4x', 'ZephyrRegistryMigrate-2q9c', 'CobaltLatticeSnapshot-8w1p'];
for (const ph of absTry) {
  if (absent.length >= 2) break;
  if (countOccurrences(raw, ph) === 0) absent.push({ id: `A${absent.length + 1}`, phrase: ph });
}
for (let i = 0; i < 8 && absent.length < 2; i++) {
  const ph = `NoSuchThing-${Date.now()}-${i}-x9`;
  if (countOccurrences(raw, ph) === 0) absent.push({ id: `A${absent.length + 1}`, phrase: ph });
}

const probes = {
  sessionId: 'session-73f70be7-48e3-435a-addf-42e792c70a4d',
  exists: exists.map(({ id, type, anchor }) => ({
    id,
    question: `那次真实会话里,在一段 ${type === 'tool/result' ? '工具输出' : '助手消息'} 中,紧接着下面这段上下文之后出现的那个长标识/令牌是什么?(不要猜,查历史原文后原样引用) 上下文:「${anchor}…」`
  })),
  absent: absent.map(({ id, phrase }) => ({ id, question: `那次真实会话里是否出现过与「${phrase}」相关的内容?请给出证据或说明无证据。` }))
};
const keys = { sessionId: probes.sessionId, exists: exists.map(({ id, seq, token, type }) => ({ id, seq, type, expectedToken: token })), absent: absent.map(({ id, phrase }) => ({ id, phrase })) };

writeFileSync(probesFile, JSON.stringify(probes, null, 2), 'utf8');
writeFileSync(keysFile, JSON.stringify(keys, null, 2), 'utf8');
console.log('WRITTEN', probesFile, '&', keysFile);
console.log(JSON.stringify(probes, null, 2));
