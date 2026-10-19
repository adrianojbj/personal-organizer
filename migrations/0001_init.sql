-- Tarefas e lembretes. Datas e horas são locais no fuso de TZ (wrangler.toml).
CREATE TABLE items (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  date         TEXT NOT NULL,                  -- AAAA-MM-DD (próxima ocorrência, se recorrente)
  time         TEXT NOT NULL DEFAULT '',       -- HH:MM; vazio = sem lembrete
  prio         INTEGER NOT NULL DEFAULT 0,     -- 0 normal, 1 média, 2 alta
  notes        TEXT NOT NULL DEFAULT '',
  recur        TEXT NOT NULL DEFAULT '{"t":"none"}', -- JSON: {t, days?, dom?}
  done         INTEGER NOT NULL DEFAULT 0,
  done_at      TEXT,                           -- ISO 8601
  last_done    TEXT,                           -- última conclusão de um recorrente
  ack          TEXT NOT NULL DEFAULT '',       -- data+hora do aviso dispensado na página
  snooze       INTEGER NOT NULL DEFAULT 0,     -- epoch ms até quando o aviso está adiado
  notified_key TEXT NOT NULL DEFAULT '',       -- data+hora do último aviso enviado ao Slack
  created      INTEGER NOT NULL
);

CREATE INDEX items_pending ON items (done, date, time);

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
