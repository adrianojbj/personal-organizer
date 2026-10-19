# Meu Dia

Agenda pessoal com tarefas, lembretes com horário, recorrência e resumo diário. Os lembretes chegam por DM no Slack, com botões **Concluir**, **Adiar 10 min** e **Adiar 1 h**.

Tudo roda no plano gratuito da Cloudflare:

| Peça | Serviço |
| --- | --- |
| Página e API | Cloudflare Workers (com static assets) |
| Banco de dados | Cloudflare D1 (SQLite) |
| Disparo dos lembretes | Cron Trigger a cada minuto |
| Login | Cloudflare Access (Zero Trust, grátis até 50 usuários) |
| Avisos | Bot do Slack via `chat.postMessage` |

## Como usar

Escreva na caixa de entrada em português comum. O app separa o que é data, hora, prioridade e repetição:

| Você escreve | Resultado |
| --- | --- |
| `ligar pro banco amanhã 10h !!` | amanhã, 10:00, prioridade alta |
| `revisar PRs todo dia útil 9h30` | seg–sex, 09:30 |
| `1:1 com o time toda quinta 15h` | toda quinta, 15:00 |
| `academia toda segunda e quarta 7h` | seg e qua, 07:00 |
| `aluguel todo dia 5` | todo mês no dia 5 |
| `pagar boleto dia 10/11 !` | 10/11, prioridade média |
| `reunião sexta às 14:30` | próxima sexta, 14:30 |

Item com hora vira lembrete: aparece na página (com som) e chega no Slack. Ao concluir um item recorrente, ele passa para a próxima data. O resumo diário (`DAILY_SUMMARY_TIME`) manda no Slack o que é para hoje e o que está atrasado.

## Instalação

Pré-requisitos: Node 20+, uma conta Cloudflare (grátis) e permissão para criar apps no seu workspace do Slack.

### 1. Banco e deploy

```bash
npm install
npx wrangler login
npm run db:create          # copie o database_id que aparecer para o wrangler.toml
npm run db:migrate         # cria as tabelas no D1
npm run deploy             # mostra a URL, ex.: https://meu-dia.SEU-SUBDOMINIO.workers.dev
```

### 2. Login com Cloudflare Access

Sem Access, a API recusa todas as requisições.

1. No painel da Cloudflare, abra **Zero Trust → Access → Applications → Add an application → Self-hosted**.
2. Domínio: `meu-dia.SEU-SUBDOMINIO.workers.dev`. Política: **Allow**, regra **Emails** com o seu e-mail.
3. Crie uma segunda aplicação para o caminho `/slack/interactions` no mesmo domínio, com política **Bypass / Everyone**. O Slack precisa chamar essa rota sem login, e o Worker confere a assinatura de cada chamada.
4. Copie o **Application Audience (AUD) Tag** da primeira aplicação e o seu team domain (`SEU-TIME.cloudflareaccess.com`).
5. Preencha `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `OWNER_EMAIL` e `APP_URL` no `wrangler.toml` e rode `npm run deploy` de novo.

### 3. Bot do Slack

1. Edite a `request_url` em [slack-manifest.yml](slack-manifest.yml) com a URL do seu Worker.
2. Em <https://api.slack.com/apps>, escolha **Create New App → From an app manifest** e cole o arquivo.
3. **Install to Workspace**.
4. Salve os segredos (eles nunca vão para o git):

```bash
npx wrangler secret put SLACK_BOT_TOKEN       # OAuth & Permissions → Bot User OAuth Token (xoxb-...)
npx wrangler secret put SLACK_SIGNING_SECRET  # Basic Information → Signing Secret
npx wrangler secret put SLACK_USER_ID         # seu member ID: perfil → ⋯ → Copy member ID
```

Os lembretes chegam na aba **Mensagens** do app "Meu Dia" no Slack.

## Desenvolvimento local

```bash
cp .dev.vars.example .dev.vars    # ALLOW_UNAUTHENTICATED=true libera a API só localmente
npm run db:migrate:local
npm run dev                       # http://localhost:8787
curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"   # roda o cron uma vez
npm test
```

## Estrutura

```
public/            página (HTML, CSS e JS sem build)
  lib/agenda.js    datas, recorrência e leitura das frases; usado pela página e pelo Worker
src/worker.js      rotas da API, botões do Slack e cron
src/items.js       validação e consultas ao D1
src/slack.js       mensagens, resumo e verificação de assinatura
src/auth.js        validação do JWT do Cloudflare Access
migrations/        schema do D1
test/              testes (node --test)
```

## API

Todas as rotas exigem o login do Access.

| Método | Rota | O que faz |
| --- | --- | --- |
| GET | `/api/items` | lista tudo |
| POST | `/api/items` | cria `{title, date, time, prio, notes, recur}` |
| PUT | `/api/items/:id` | substitui o item |
| DELETE | `/api/items/:id` | exclui |
| POST | `/api/items/:id/complete` | conclui (recorrente avança para a próxima data) |
| POST | `/api/items/:id/reopen` | reabre |
| POST | `/api/items/:id/snooze` | adia o aviso `{minutes}` |
| POST | `/api/items/:id/dismiss` | dispensa o aviso atual |
| POST | `/api/items/purge-done` | apaga concluídas de dias anteriores |
| GET | `/api/me` | fuso, Slack ativo e horário do resumo |

`recur` aceita `{"t":"none"}`, `{"t":"daily"}`, `{"t":"weekdays"}`, `{"t":"weekly","days":[1,3]}` (0 = domingo) e `{"t":"monthly","dom":5}`.

## Limites do plano gratuito

O cron por minuto usa cerca de 1.440 execuções por dia, dentro das 100 mil requisições diárias do Workers. O D1 grátis tem 5 GB e 5 milhões de leituras por dia, muito acima do que uma agenda pessoal usa.
