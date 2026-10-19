// Roda o Meu Dia no seu Mac: banco D1 local em .data/ e checagem de lembretes a cada minuto.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, copyFileSync } from "node:fs";

const PORT = process.env.PORT || "8787";
const BASE = `http://127.0.0.1:${PORT}`;
const PERSIST = ".data";
const wrangler = args => ["npx", ["wrangler", ...args]];

if (!existsSync(".dev.vars")) {
  copyFileSync(".dev.vars.example", ".dev.vars");
  console.log("Criei .dev.vars a partir do exemplo. Preencha os dados do Slack lá para receber lembretes.");
}

const mig = spawnSync(...wrangler(["d1", "migrations", "apply", "meu-dia", "--local", "--persist-to", PERSIST]), { stdio: "inherit", input: "y\n" });
if (mig.status !== 0) process.exit(mig.status ?? 1);

const dev = spawn(...wrangler(["dev", "--ip", "127.0.0.1", "--port", PORT, "--test-scheduled", "--persist-to", PERSIST]), { stdio: "inherit" });
dev.on("exit", code => process.exit(code ?? 0));
const stop = () => { dev.kill("SIGINT"); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

async function waitReady() {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/api/me`)).ok) return true; } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

async function tick() {
  try { await fetch(`${BASE}/__scheduled?cron=*+*+*+*+*`); }
  catch (e) { console.error("Checagem de lembretes falhou:", e.message); }
}

if (await waitReady()) {
  console.log(`\nMeu Dia rodando em ${BASE}  (Ctrl+C para parar)\n`);
  await tick();
  // Alinha ao início de cada minuto para os lembretes saírem na hora certa.
  setTimeout(() => { tick(); setInterval(tick, 60_000); }, 60_000 - (Date.now() % 60_000) + 1000);
} else {
  console.error("O app não respondeu em 60 s. Veja os erros acima.");
  stop();
}
