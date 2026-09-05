// dsh-trajectory-query — dev-only Tier0 corpus seeder 镜像(host-only)
// 运行时定义:插件 tqcs-2,包 pkg-5(inject: ['sessions'])。仅实验语料使用。
return (() => {
  const SESSION_ID = 'tq-corpus-t0';
  const SCENES = [
    { tag: 'build-alpha-fail', user: 'monorepo 里构建 alpha 服务失败了,帮我看看日志。', asst: 'alpha 构建失败:错误码 [[E1]] 发生在 docker-push 阶段;涉及提交 [[C1]];失败文件 [[F1]];建议换回 npm 源 [[R1]],构建 id [[B1]]。' },
    { tag: 'test-suite-regression', user: '测试套件出了回归,查一下具体是哪条。', asst: '回归来自集成测试 [[T1]]:断言 [[A1]] 未通过,原因是 mock 服务 [[M1]] 未启动,运行环境 [[R2]] 下失败。' },
    { tag: 'db-migration-rollback', user: '数据库迁移好像把线上表结构改坏了,确认下怎么回滚。', asst: '迁移 [[D1]] 破坏了 users 表;回滚命令是 [[D2]];备份位于 [[D3]];灰度期间入口 [[D4]] 已关。' },
    { tag: 'dep-upgrade-choice', user: '这个依赖要升还是锁版本?我们之前讨论过。', asst: '结论:锁在 [[V1]] 并推迟到 [[V2]] 再升;原因是对 [[V3]] 不兼容,以及 CI 镜像 [[V4]] 未更新。' },
    { tag: 'ci-timeout-workaround', user: 'CI 超时怎么处理的,之前定的临时方案是什么。', asst: '临时方案:把 [[W1]] 的 timeout 提到 [[W2]] 秒并跳过 [[W3]];负责人在 [[W4]] 跟进。' },
    { tag: 'config-secret-leak', user: '密钥泄露事故的复盘结论是什么。', asst: '泄露密钥 [[S1]] 已轮换;根因是 [[S2]] 被提交进仓库;预防项 [[S3]];审计单 [[S4]]。' },
    { tag: 'perf-bottleneck', user: '接口性能瓶颈定位到哪了。', asst: '瓶颈在 [[P1]] 查询;耗时 [[P2]] ms;优化方案 [[P3]] 已列;压测基线 [[P4]]。' },
    { tag: 'api-contract-argue', user: '我们为接口字段命名争论过,最后定的什么。', asst: '最后定 [[N1]] 前缀并废弃 [[N2]];兼容层保留到 [[N3]];示例见 [[N4]]。' },
    { tag: 'cache-invalidation', user: '缓存为什么没失效,结论呢。', asst: '原因是 [[C2]] 的 key 没带版本号;修法 [[C3]];影响面 [[C4]];验证脚本 [[C5]]。' }
  ];
  function randTok() {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    let s = '';
    for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }
  return {
    inject: ['sessions'],
    apply(ctx) {
      const def = (name, description, execute) => {
        const tool = harness.defineTool({
          name,
          description,
          parameters: { type: 'object', additionalProperties: true, properties: {} },
          output: { schema: { type: 'object', additionalProperties: true }, render(args, value) { return [{ type: 'text', text: JSON.stringify(value, null, 2) }]; } },
          execute
        });
        ctx.effect(() => harness.registerTool(ctx, tool));
      };
      def('tq_seed_corpus',
        '实验工具:创建/重置 Tier0 语料会话(随机 token 事实)。只返回 sessionId、场景标签列表、槽位数量;绝不返回 token 值或 seq(作答者不得直接得知答案)。',
        async () => {
          const sessions = ctx.sessions;
          const existing = sessions.get(SESSION_ID);
          let session = existing || sessions.create(SESSION_ID, { meta: { cwd: 'D:/projects/sql event' } });
          const stamp = String(Date.now());
          const seqs = [];
          let slotCount = 0;
          try {
            for (const scene of SCENES) {
              const fill = (tpl) => tpl.replace(/\[\[([A-Z]\d+)\]\]/g, (m, name) => { slotCount++; return name + '-' + randTok(); });
              const userText = scene.user + ' (scene ' + scene.tag + '#' + stamp + ')';
              const asstText = fill(scene.asst);
              const u = session.append('user/message', { id: 'seed-u-' + stamp + '-' + seqs.length, role: 'user', content: [{ type: 'text', text: userText }], source: { kind: 'user' } }, { surfaceOp: 'append' });
              const a = session.append('assistant/message', { turn: seqs.length + 1, step: 1, message: { id: 'seed-a-' + stamp + '-' + seqs.length, role: 'assistant', content: [{ type: 'text', text: asstText }], source: { kind: 'model', provider: 'seed', model: 'seed' } } }, { surfaceOp: 'append' });
              seqs.push(u.seq, a.seq);
            }
            const ev = session.append('user/message', { id: 'seed-end-' + stamp, role: 'user', content: [{ type: 'text', text: '（Tier0 语料结束场景标记 ' + stamp + '）' }], source: { kind: 'user' } }, { surfaceOp: 'append' });
            seqs.push(ev.seq);
          } catch (e) {
            return { ok: false, error: (e && e.message) || String(e) };
          }
          return { ok: true, sessionId: SESSION_ID, sceneCount: SCENES.length, sceneTags: SCENES.map((s) => s.tag), tokenSlots: slotCount, firstSeq: seqs[0], lastSeq: seqs[seqs.length - 1], notice: 'token 值与 seq 均为随机生成,未返回' };
        });
    }
  };
})()
