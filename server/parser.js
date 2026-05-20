const RULES = [
  { status: 'done', keywords: ['done', 'finished', 'completed', 'complete', 'finalizado', 'concluido', 'concluído'] },
  { status: 'blocked', keywords: ['blocked', 'stuck', 'bloqueado', 'travado', 'impedido'] },
  { status: 'in_progress', keywords: ['in progress', 'working', 'started', 'wip', 'em andamento', 'iniciado', 'trabalhando'] },
  { status: 'ack', keywords: ['ack', 'acknowledged', 'got it', 'ok', 'okay', 'entendido', 'beleza', 'ciente'] },
];

export function parseStatus(text) {
  if (!text) return null;
  const t = text.toLowerCase();
  for (const rule of RULES) {
    for (const kw of rule.keywords) {
      const re = new RegExp(`(^|\\W)${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\W|$)`, 'i');
      if (re.test(t)) return rule.status;
    }
  }
  return null;
}

export function statusLabel(status) {
  return {
    pending: 'Pending',
    ack: 'Acknowledged',
    in_progress: 'In Progress',
    done: 'Done',
    blocked: 'Blocked',
  }[status] || status;
}
