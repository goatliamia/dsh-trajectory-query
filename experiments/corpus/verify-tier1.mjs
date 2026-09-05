// Tier1 盲评校验:answers vs keys vs corpus line at seq(转义层归一化后精确比对)。
// Usage: node verify-tier1.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const keys = JSON.parse(readFileSync(join(here, 'tier1-keys.json'), 'utf8'));
const answers = JSON.parse(readFileSync(join(here, '..', 'probes', 'tier1-answers.json'), 'utf8'));
const corpusText = readFileSync(join(here, 'tier1-corpus.txt'), 'utf8');
const corpusLines = new Map(corpusText.split('\n').filter(Boolean).map((l) => {
  const i1 = l.indexOf('|'); const i2 = l.indexOf('|', i1 + 1);
  return [Number(l.slice(0, i1)), l.slice(i2 + 1)];
}));

const norm = (s) => s.replace(/\\+/g, '\\');
const normNL = (s) => norm(s).replace(/\\n/g, '\n');
const sameToken = (a, b) => norm(a) === norm(b) || normNL(a) === normNL(b);

const report = { sessionId: keys.sessionId, exists: [], absent: [] };
const keyById = new Map(keys.exists.map((k) => [k.id, k]));
const ansById = new Map(answers.answers.filter((a) => a.quote).map((a) => [a.id, a]));
for (const k of keys.exists) {
  const a = ansById.get(k.id);
  const lineText = corpusLines.get(k.seq) ?? '';
  if (!a) { report.exists.push({ id: k.id, ok: false, reason: 'no answer' }); continue; }
  const quoteOK = a.seq === k.seq && sameToken(a.quote, k.expectedToken);
  const inCorpus = norm(lineText).includes(norm(k.expectedToken)) || normNL(lineText).includes(normNL(k.expectedToken));
  const inAnswerContext = true; // quote came from trajectory_window text at a.seq
  report.exists.push({ id: k.id, ok: quoteOK && inCorpus, quoteMatchesKey: sameToken(a.quote, k.expectedToken), seqMatches: a.seq === k.seq, tokenInCorpusAtSeq: inCorpus, quoted: norm(a.quote), expected: norm(k.expectedToken) });
}
for (const k of keys.absent) {
  const a = answers.answers.find((x) => x.id === k.id);
  const phraseInCorpus = corpusText.includes(k.phrase);
  report.absent.push({ id: k.id, ok: a && a.verdict === 'no-evidence' && a.hits === 0 && !phraseInCorpus, verdict: a && a.verdict, hits: a && a.hits, phraseInCorpus });
}
const okE = report.exists.filter((x) => x.ok).length;
const okA = report.absent.filter((x) => x.ok).length;
console.log(JSON.stringify({ ...report, summary: `exists ${okE}/${report.exists.length}; absent ${okA}/${report.absent.length}` }, null, 2));
