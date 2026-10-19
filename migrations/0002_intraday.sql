-- Repetição dentro do dia: avisa a cada `every_min` minutos, de `time` até `until_hm`.
ALTER TABLE items ADD COLUMN every_min INTEGER NOT NULL DEFAULT 0;
ALTER TABLE items ADD COLUMN until_hm TEXT NOT NULL DEFAULT '';
