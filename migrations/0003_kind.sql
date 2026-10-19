-- Separa tarefas (vencimento, aparecem no resumo diário) de lembretes (avisos no horário).
ALTER TABLE items ADD COLUMN kind TEXT NOT NULL DEFAULT 'task';
UPDATE items SET kind = 'reminder' WHERE time <> '';
