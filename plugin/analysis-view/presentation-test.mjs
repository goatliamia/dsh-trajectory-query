import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {renderTracePage} from './lib/index.js';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const html=renderTracePage({traceLoad:{sessionId:'presentation-check'}});
assert.match(html,/<body class="geist-review trace-pending context-trend-study">/);
assert.equal((html.match(/let studyShowTotal = false/g)||[]).length,1,'Native DSH receives the shared overlay once, default off');
assert.ok(html.includes('study-source-actions')&&html.includes('study-total-toggle'));
assert.ok(html.includes('compactTrendPolyline'));
for(const match of html.matchAll(/<script(?![^>]*type="application\/json")[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
const shared=read('./lib/trace/shared/context-observation.js');
assert.equal(shared,read('../../view/assets/context-observation.js'),'DSH and portable hosts ship identical overlay logic');
const start=shared.indexOf('function studyStockLayer('),end=shared.indexOf('\n  // Translucent',start);
assert.ok(start>=0&&end>start);
const stock=shared.slice(start,end);
assert.equal(vm.runInNewContext('let studyShowTotal=false;const view="overview";'+stock+';studyStockLayer()'),'', 'Disabled trend returns before projection, series and SVG work');
console.log('PASS shared native presentation, staged body, multi-source controls, lazy disabled trend and renderer syntax');
