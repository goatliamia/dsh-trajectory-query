// dsh-trajectory-query — 动态 Cordis 插件源码镜像(host-only)
// 运行时定义:插件 tqry-1,包 pkg-4(本文件为单一来源;若运行实例有更新,以本文件重新 cordis_define 后 update)。
// 依赖:ctx.sessionQuery(可选,ctx.get)、harness(defineTool/registerTool)。FTS 在本部署禁用,find 使用 literal 子串(filterEvents)。
return (() => {
  function textOf(ev) {
    const d = ev && ev.data;
    if (!d) return '';
    switch (ev.type) {
      case 'user/message': return contentText(d.content);
      case 'assistant/message': return contentText(d.message && d.message.content);
      case 'tool/call': return join([d.name, strArg(d.arguments)]);
      case 'tool/result': return join([contentText(d.message && d.message.content), d.error && d.error.name, d.error && d.error.code]);
      case 'todo/write': return (d.todos || []).map((t) => join([t && t.status, t && t.content])).join('\n');
      case 'turn/end': return turnEnd(d.reason);
      default: return '';
    }
  }
  function contentText(content) {
    if (!Array.isArray(content)) return '';
    const out = [];
    for (const b of content) blockText(b, out);
    return join(out);
  }
  function blockText(b, out) {
    if (!b || typeof b !== 'object') return;
    switch (b.type) {
      case 'text': if (typeof b.text === 'string') out.push(b.text); break;
      case 'reasoning': break;
      case 'tool-call': out.push(b.name, typeof b.arguments === 'string' ? b.arguments : JSON.stringify(b.arguments)); break;
      case 'tool-result': if (Array.isArray(b.content)) { for (const c of b.content) blockText(c, out); } break;
      default: break;
    }
  }
  function turnEnd(reason) {
    if (!reason) return '';
    switch (reason.kind) {
      case 'error': return join(['error', reason.error && reason.error.message]);
      case 'aborted': return 'aborted';
      case 'max-tokens': case 'interrupted': return reason.kind;
      default: return '';
    }
  }
  function join(parts) {
    return (parts || []).filter((p) => p !== undefined && p !== null && String(p).trim() !== '').map((p) => String(p).trim()).join('\n');
  }
  function strArg(a) { return typeof a === 'string' ? a : JSON.stringify(a); }
  function clip(s, n) { const t = String(s == null ? '' : s); return t.length <= n ? t : t.slice(0, n) + '…[+truncated]'; }
  const P = (properties, required) => ({ type: 'object', additionalProperties: true, properties, ...(required && required.length ? { required } : {}) });
  const O = { type: 'object', additionalProperties: true };

  return {
    apply(ctx) {
      const q = () => ctx.get('sessionQuery');
      const def = (name, description, properties, required, execute) => {
        const tool = harness.defineTool({
          name,
          description,
          parameters: P(properties, required),
          output: { schema: O, render(args, value) { return [{ type: 'text', text: renderValue(value) }]; } },
          execute
        });
        ctx.effect(() => harness.registerTool(ctx, tool));
      };
      function renderValue(v) {
        try { return JSON.stringify(v, null, 2); } catch { return String(v); }
      }
      function rangeFilter(from, to, kind) {
        const f = {};
        if (from !== undefined && from !== null) f.from = Number(from);
        if (to !== undefined && to !== null) f.to = Number(to);
        if (f.from === undefined && f.to === undefined) return null;
        return { kind, ...f };
      }
      function filtersFor(args) {
        const fl = [];
        const seq = rangeFilter(args.from, args.to, 'seq');
        if (seq) fl.push(seq);
        const tim = rangeFilter(args.timeFrom, args.timeTo, 'time');
        if (tim) fl.push(tim);
        if (Array.isArray(args.types) && args.types.length) fl.push({ kind: 'type', values: args.types });
        return fl;
      }

      def('trajectory_find',
        '在会话轨迹中查找事件(verbatim 证据定位)。按字面量子串检索(大小写不敏感、空白灵活,基于 dsh 语义文档文本)。给出 session 时在该会话内找;缺省在最近若干会话内找(见 sessionCount)。返回每个命中事件的 (session, seq, type, time, surface) 与文本片段,绝不改写原文。',
        {
          session: { type: 'string', description: '会话 id;缺省则跨最近若干会话搜索' },
          query: { type: 'string', description: '查找词(视为字面子串)' },
          types: { type: 'array', items: { type: 'string' }, description: '事件类型过滤,如 user/message、tool/call、tool/result、assistant/message' },
          from: { type: 'integer', description: 'seq 下界' },
          to: { type: 'integer', description: 'seq 上界' },
          sessionCount: { type: 'integer', description: '缺省 session 时扫描的最近会话数,默认 3,上限 10' },
          limit: { type: 'integer', description: '最大返回数,默认 8,上限 20' }
        },
        [],
        async (args) => {
          const svc = q();
          if (!svc) return { ok: false, error: 'sessionQuery service unavailable' };
          const limit = Math.min(Math.max(Number(args.limit || 8), 1), 20);
          const text = typeof args.query === 'string' ? args.query.trim() : '';
          const filters = filtersFor(args);
          const docFilters = [...filters];
          if (text) docFilters.push({ kind: 'text', text });
          if (docFilters.length === 0) return { ok: false, error: '需要 query 或过滤器(from/to/types)之一' };
          try {
            if (args.session) {
              const docs = await svc.filterEvents(args.session, docFilters);
              return { ok: true, mode: 'literal-in-session', session: args.session, hitCount: docs.length, items: docs.slice(0, limit).map((d) => ({ session: d.sessionId, seq: d.seq, type: d.type, time: d.time, surface: d.surface, text: clip(d.text, 400) })) };
            }
            const sessionCount = Math.min(Math.max(Number(args.sessionCount || 3), 1), 10);
            const records = await svc.listSessions();
            const targets = records.slice(0, sessionCount);
            const items = [];
            for (const rec of targets) {
              let docs = [];
              try { docs = await svc.filterEvents(rec.header.id, docFilters); } catch { /* 单会话失败跳过 */ }
              for (const d of docs.slice(0, limit)) items.push({ session: d.sessionId, seq: d.seq, type: d.type, time: d.time, surface: d.surface, text: clip(d.text, 400) });
              if (items.length >= limit) break;
            }
            return { ok: true, mode: 'literal-cross-session', scanned: targets.length, hitCount: items.length, items: items.slice(0, limit) };
          } catch (e) {
            return { ok: false, error: (e && e.message) || String(e) };
          }
        });

      def('trajectory_window',
        '按 (session, seq 区间) 取原文窗口,verbatim 逐字返回事件文本(工具结果、错误、消息)。来自 dsh 的原始事件文本,绝不改写。范围上限 60 个事件。',
        {
          session: { type: 'string', description: '会话 id' },
          from: { type: 'integer', description: '起始 seq(含)' },
          to: { type: 'integer', description: '结束 seq(含)' },
          seq: { type: 'integer', description: '仅给 seq 时取其前后各 5 个事件' },
          mode: { type: 'string', enum: ['surface', 'raw'], description: '默认 surface:只列可搜索语义文本事件' }
        },
        ['session'],
        async (args) => {
          const svc = q();
          if (!svc) return { ok: false, error: 'sessionQuery service unavailable' };
          const MAX = 60;
          let from, to;
          if (args.seq !== undefined && args.seq !== null) {
            const s = Number(args.seq);
            from = Math.max(0, s - 5); to = s + 5;
          } else {
            from = Number(args.from); to = Number(args.to);
            if (!Number.isInteger(from) || !Number.isInteger(to)) return { ok: false, error: '需要 from/to 或 seq' };
          }
          if (to - from + 1 > MAX) return { ok: false, error: '窗口超过 60 事件上限,请缩小范围', window: { from, to } };
          try {
            const w = await svc.readEvent({ sessionId: args.session, seq: Math.max(from, 0), before: 0, after: Math.max(0, to - from) });
            const events = (w.events || []).filter((ev) => ev.seq >= from && ev.seq <= to);
            const lines = [];
            for (const ev of events) {
              const txt = textOf(ev);
              if (args.mode === 'raw' || txt) lines.push({ seq: ev.seq, type: ev.type, time: ev.time, text: clip(txt, 4000) });
            }
            return { ok: true, session: w.session && w.session.id, inheritedEventCount: w.inheritedEventCount, requestedFrom: from, requestedTo: to, startSeq: w.startSeq, endSeq: w.endSeq, events: lines };
          } catch (e) {
            return { ok: false, error: (e && e.message) || String(e) };
          }
        });

      def('trajectory_trace',
        '拉取关系链:给 (session, seq) 返回该事件的引用/替换链与源事件;只给 session 返回谱系(祖先/子会话/子代理)。',
        {
          session: { type: 'string', description: '会话 id' },
          seq: { type: 'integer', description: '事件 seq;给定时返回事件关系' }
        },
        ['session'],
        async (args) => {
          const svc = q();
          if (!svc) return { ok: false, error: 'sessionQuery service unavailable' };
          try {
            if (args.seq !== undefined && args.seq !== null) {
              const tr = await svc.traceEvent({ sessionId: args.session, seq: Number(args.seq) });
              return { ok: true, session: args.session, target: { seq: tr.target.seq, type: tr.target.type, time: tr.target.time, surface: tr.target.surface }, replacedBy: tr.replacedBy, replacementChain: tr.replacementChain, replacedEventSeqs: tr.replacedEventSeqs, sourceEventSeqs: tr.sourceEventSeqs, derivedEventSeqs: tr.derivedEventSeqs };
            }
            const t = await svc.traceSession(args.session);
            const node = (n) => ({ id: n.session.header.id, live: n.session.live, persisted: n.session.persisted, descendants: (n.descendants || []).map(node) });
            return { ok: true, target: args.session, complete: t.complete, ancestors: (t.ancestors || []).map((r) => r.header.id), descendants: (t.descendants || []).map(node) };
          } catch (e) {
            return { ok: false, error: (e && e.message) || String(e) };
          }
        });

      def('trajectory_sessions',
        '列出可查询的会话(live/persisted),返回 id、创建时间、cwd、父会话、preset。用于确定把哪个会话传给其它 trajectory_* 工具。',
        { limit: { type: 'integer', description: '返回条数,默认 30' } },
        [],
        async (args) => {
          const svc = q();
          if (!svc) return { ok: false, error: 'sessionQuery service unavailable' };
          try {
            const records = await svc.listSessions();
            const limit = Math.min(Math.max(Number(args.limit || 30), 1), 100);
            const items = records.slice(0, limit).map((r) => ({ id: r.header.id, createdAt: r.header.createdAt, cwd: r.header.cwd || null, parentSession: r.header.parentSession || null, agentPreset: r.header.agentPreset || null, isSeeded: r.header.isSeeded || false, live: r.live, persisted: r.persisted }));
            return { ok: true, total: records.length, items };
          } catch (e) {
            return { ok: false, error: (e && e.message) || String(e) };
          }
        });
    }
  };
})()
