export function episodeMeaning(e) {
  if (e.condition === 'FS_NOT_OBSERVED') return e.readConfirmed && e.complete
    ? { short: '先看后改好', why: '修改前还没有读取目标文件。', outcome: '补看文件后，同样的修改全部成功了。' }
    : { short: '修改前没看文件', why: '修改前还没有读取目标文件。', outcome: e.complete ? '同样的修改后来成功了。' : '没有找到全部原修改后续成功的记录。' };
  if (e.condition === 'FS_STALE_VERSION') return {
    short: e.readConfirmed && e.complete ? '重看后改好' : '文件已变化',
    why: '文件内容在先前读取之后发生了变化。',
    outcome: e.complete ? '同样的修改后来成功了。' : '没有找到全部原修改后续成功的记录。',
  };
  if (e.condition === 'TOOL_TIMEOUT') return { short: '等太久中止', why: '这次操作超过了允许等待的时间。', outcome: e.complete ? '同样的操作后来成功了。' : '后续是否通过其他方式完成，还不能确认。' };
  if (e.condition === 'SESSION_QUERY_PERSISTENCE_FAILED') return { short: '历史没读到', why: '读取历史记录时，存储服务返回了错误。', outcome: e.complete ? '同样的读取后来成功了。' : '这次读取失败，不能据此判断整项任务失败。' };
  const image = e.condition.includes('read_image');
  return { short: image ? '图片没读到' : '这一步出错', why: image ? '读取图片的操作返回了错误。' : '这一步的操作返回了错误。', outcome: e.complete ? '同样的操作后来成功了。' : '没有找到同样操作的后续成功记录，可能换了做法。' };
}

export function stepMeaning(step) {
  const calls = step.calls || [], names = calls.map(c => c.name);
  const targets = [...new Set(calls.map(c => c.target).filter(Boolean))];
  const kinds = [
    ['查看文件', ['read', 'read_file', 'read_text_file', 'read_image']],
    ['修改文件', ['edit', 'write', 'apply_patch', 'multi_edit', 'write_file']],
    ['查找内容', ['grep', 'glob', 'search']],
    ['运行命令', ['pwsh', 'bash', 'run_code']],
  ];
  const labels = kinds.filter(([, set]) => names.some(n => set.includes(n))).map(([label]) => label);
  const short = labels.length === 1 ? labels[0] : labels.length ? labels.slice(0, 2).join('、') : calls.length ? '执行操作' : step.reply ? '整理回复' : '暂无动作记录';
  const failed = calls.filter(c => c.status === 'error').length, missing = calls.filter(c => c.status === 'unknown').length;
  const outcome = failed ? failed + ' 次操作返回了错误。' : missing ? missing + ' 次操作还没有结果记录。' : calls.length ? calls.length + ' 次操作均已返回。' : step.reply ? '这一段产生了回复。' : '没有足够记录判断这一段做了什么。';
  return { short, targets, count: calls.length, outcome, failed, missing };
}

export function retryMeaning(retries, responded) {
  const transport = retries.every(r => r.failure?.code === 'TRANSPORT');
  const started = retries.filter(r => r.started === true).length;
  const attempt = started === retries.length ? '系统又尝试了 ' + started + ' 次。' : '系统安排了 ' + retries.length + ' 次再次尝试，记录确认其中 ' + started + ' 次已开始。';
  return {
    short: '自动再试',
    why: (transport ? '连接过程出了问题，' : '没有顺利得到回应，') + attempt,
    outcome: responded ? '随后收到了回应。' : '当前记录里还没有看到后续回应。',
    delayMs: retries.reduce((sum, r) => sum + (r.delayMs || 0), 0),
  };
}

export function turnMeaning(turn) {
  const calls = turn.steps.flatMap(s => s.calls || []);
  const writes = calls.filter(c => ['edit', 'write', 'write_file', 'apply_patch', 'multi_edit'].includes(c.name) && c.status === 'returned');
  const files = [...new Set(writes.map(c => c.target).filter(Boolean))];
  const reads = [...new Set(calls.filter(c => ['read', 'read_file', 'read_text_file'].includes(c.name) && c.status === 'returned').map(c => c.target).filter(Boolean))];
  const commands = calls.filter(c => ['pwsh', 'bash', 'run_code'].includes(c.name)).length;
  const short = files.length ? '修改 ' + files.length + ' 个文件' : reads.length ? '查看 ' + reads.length + ' 个文件' : commands ? '运行 ' + commands + ' 次命令' : calls.length ? '执行 ' + calls.length + ' 次操作' : '整理回复';
  return { short, files, reads, commands, failed: calls.filter(c => c.status === 'error').length };
}
