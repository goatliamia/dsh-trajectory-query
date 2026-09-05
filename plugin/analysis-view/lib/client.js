// dsh-analysis-view — 常驻 client 插件(分析 tab)。
// 镜像:会话内动态插件 tqan-3/pkg-8。导出 Cordis Plugin(apply/inject)以便 web profile 打包。
'use strict';

function AnalysisSnapshotBuilder() {
	this.counts = { nodes: 0, upserts: 0 };
	this.snap = { order: [], nodes: new Map(), locations: new Map(), navigation: null, timeline: null, counts: this.counts };
}
AnalysisSnapshotBuilder.prototype.replace = function (input) {
	const nodes = (input && input.nodes) || [];
	this.counts.nodes = nodes.length;
	this.snap = { order: [], nodes: new Map(), locations: new Map(), navigation: null, timeline: null, counts: this.counts };
	return this.snap;
};
AnalysisSnapshotBuilder.prototype.apply = function (input) {
	const upserts = (input && input.upserts) || [];
	this.counts.nodes += upserts.length;
	this.snap = { order: [], nodes: new Map(), locations: new Map(), navigation: null, timeline: null, counts: this.counts };
	return this.snap;
};
AnalysisSnapshotBuilder.prototype.snapshot = function () { return this.snap; };

function digestView(props) {
	const useTrajectory = props && props.useTrajectory;
	let snap = null;
	try { snap = useTrajectory ? useTrajectory() : null; } catch { snap = null; }
	const turns = Array.isArray(snap && snap.turns) ? snap.turns : [];
	const cells = [];
	for (const turn of turns) for (const g of (turn && turn.groups) || []) for (const c of (g && g.cells) || []) cells.push(c);
	let toolCalls = 0, subtools = 0, errors = 0;
	const names = {}; const errFirst = []; const nameSeq = [];
	for (const c of cells) {
		const k = c && c.kind;
		if (k === 'tool') { toolCalls++; const n = c.name || c.toolName || '(tool)'; names[n] = (names[n] || 0) + 1; nameSeq.push({ name: n, seq: c.seq }); }
		else if (k === 'subtool') subtools++;
		if (c && (c.isError || c.error)) { errors++; if (errFirst.length < 4) errFirst.push({ kind: (c.error && (c.error.name || c.error.code)) || c.name || 'error', seq: c.seq }); }
	}
	const retry = [];
	for (let i = 1; i < nameSeq.length; i++) if (nameSeq[i - 1].name === nameSeq[i].name) retry.push(nameSeq[i - 1].seq + '→' + nameSeq[i].seq);
	const top = Object.entries(names).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, count]) => name + '×' + count);
	const sub = { fontSize: 12, color: 'var(--dsw-alias-label-secondary, #666)' };
	const row = (k, v) => React.createElement('div', { key: k, style: { padding: '5px 0', borderBottom: '1px solid var(--dsw-alias-border-l2, #eee)' } }, React.createElement('span', { style: { fontSize: 13 } }, k), React.createElement('span', { style: sub }, '  ' + v));
	const kpi = [['turns', String(turns.length)], ['tool calls', String(toolCalls)], ['subtools', String(subtools)], ['errors', String(errors)]];
	return React.createElement('div', { style: { padding: 12, overflow: 'auto', minHeight: 0 } }, [
		React.createElement('h3', { key: 'h', style: { margin: '0 0 4px', fontSize: 14 } }, '分析', React.createElement('span', { style: sub }, '  ·  turns/tools/errors v1 (轨迹投影)')),
		React.createElement('div', { key: 'kpi', style: { display: 'flex', gap: 14, margin: '8px 0', flexWrap: 'wrap' } }, kpi.map(([k, v]) => React.createElement('span', { key: k, style: { fontSize: 13 } }, React.createElement('b', { style: { marginRight: 4 } }, v), k))),
		row('tools v1', toolCalls + ' 次 · top: ' + (top.join(' · ') || '无')),
		row('errors v1', errors + ' 个;首现: ' + (errFirst.map((e) => e.kind + '@' + e.seq).join(', ') || '无')),
		row('现象区', retry.length ? 'retry v1(同名,去参数) ×' + retry.length + ';样例 ' + retry.slice(0, 4).join(', ') + '. 同参检测需 host 分析器。' : '无候选。同参检测需 host 分析器。'),
		React.createElement('div', { key: 'foot', style: Object.assign({}, sub, { marginTop: 8 }) }, '确定性列,非模型生成; 复跑: node analyzers/run-digest.mjs <session.zstd>')
	]);
}

exports.inject = ['slots', 'uiConversation'];
exports.apply = function apply(ctx) {
	ctx.uiConversation.views.register({ target: 'analysis', create: () => new AnalysisSnapshotBuilder(), isActive: () => true });
	const s = ctx.slots;
	if (!s) return;
	s.inject('conversation.view', () => s.register({
		name: 'conversation.view',
		id: 'analysis',
		order: 20,
		label: () => '分析',
		children: {},
		inject: () => ({ hooks: {} })
	}, digestView));
};
