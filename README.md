# Meu Dia

Agenda pessoal com tarefas, lembretes com horário, recorrência e resumo diário. Os lembretes chegam por DM no Slack, com botões **Concluir**, **Adiar 10 min** e **Adiar 1 h**.

Roda no seu Mac com banco SQLite local, sem conta em nenhum serviço. Se um dia quiser deixar no ar 24 h, o mesmo código publica no plano gratuito da Cloudflare:

| Peça | Serviço |
| --- | --- |
| Página e API | Cloudflare Workers (com static assets) |
| Banco de dados | Cloudflare D1 (SQLite) |
| Disparo dos lembretes | Cron Trigger a cada minuto |
| Login | Senha própria, com sessão em cookie assinado |
| Avisos | Bot do Slack via `chat.postMessage` |

## Como usar

Escreva a tarefa e escolha no formulário:

- **Dia**: calendário ou os atalhos *Hoje* / *Amanhã*
- **Hora do lembrete**: com hora, o item vira lembrete (aviso na página e DM no Slack); sem hora, é só tarefa
- **Prioridade**: Normal, Média ou Alta (aparece como faixa colorida na lista)
- **Repetir**: não repete, todo dia, dias úteis, toda semana (escolhendo os dias) ou todo mês (no mesmo dia do mês)
- **Nota** opcional

Uma frase abaixo dos campos confirma o que vai ser salvo, por exemplo *"Repete toda seg, qua às 07:00, com lembrete. Próxima: hoje."* Ao concluir um item recorrente, ele passa para a próxima data. O resumo diário (`DAILY_SUMMARY_TIME`) manda no Slack o que é para hoje e o que está atrasado.

## Rodar no seu Mac

Pré-requisito: Node 20+.

```bash
npm install
npm start          # http://localhost:8787
```

- Os dados ficam em `.data/` (SQLite via D1 local). Para fazer backup, copie essa pasta.
- O `npm start` verifica lembretes a cada minuto enquanto estiver rodando. Com o Mac desligado ou o terminal fechado, nada é enviado; ao voltar, os lembretes atrasados saem na primeira checagem.
- O app só escuta em `127.0.0.1`: nenhum outro aparelho da rede acessa.
- Na primeira execução é criado o `.dev.vars` (fora do git) com a configuração local.

### Lembretes no Slack (opcional)

1. Em <https://api.slack.com/apps>, **Create New App → From an app manifest**, cole o [slack-manifest.yml](slack-manifest.yml) e clique em **Install to Workspace**.
2. No `.dev.vars`, descomente e preencha `SLACK_BOT_TOKEN` (OAuth & Permissions → Bot User OAuth Token) e `SLACK_USER_ID` (seu perfil → ⋯ → Copy member ID).
3. Reinicie o `npm start`.

As mensagens chegam na aba **Mensagens** do app "Meu Dia" no Slack, com link para abrir a agenda. Os botões Concluir/Adiar no Slack só funcionam com uma URL pública (deploy ou túnel), porque o Slack precisa chamar o app de volta; para isso, ative `interactivity` no manifest e use `SLACK_INTERACTIVE=true` e `SLACK_SIGNING_SECRET`.

## Publicar na Cloudflare (opcional)

Pré-requisitos: uma conta Cloudflare (grátis, sem cartão) e permissão para criar apps no seu workspace do Slack.

### 1. Banco e deploy

```bash
npm install
npx wrangler login
npm run db:create          # copie o database_id que aparecer para o wrangler.toml
npm run db:migrate         # cria as tabelas no D1
npm run deploy             # mostra a URL, ex.: https://meu-dia.SEU-SUBDOMINIO.workers.dev
```

### 2. Senha de acesso

A página pede uma senha; sem ela a API recusa tudo. A sessão vale 30 dias por navegador, e 5 senhas erradas bloqueiam o login por 15 minutos.

```bash
openssl rand -hex 32 | npx wrangler secret put SESSION_SECRET   # chave que assina as sessões
npx wrangler secret put APP_PASSWORD                            # digite a senha que você quer usar
```

Trocar qualquer um dos dois derruba todas as sessões abertas.

### 3. Bot do Slack

1. Em [slack-manifest.yml](slack-manifest.yml), ative `interactivity` e troque a `request_url` pela URL do seu Worker. Adicione `SLACK_INTERACTIVE = "true"` em `[vars]` no `wrangler.toml`.
2. Em <https://api.slack.com/apps>, escolha **Create New App → From an app manifest** e cole o arquivo.
3. **Install to Workspace**.
4. Salve os segredos (eles nunca vão para o git):

```bash
npx wrangler secret put SLACK_BOT_TOKEN       # OAuth & Permissions → Bot User OAuth Token (xoxb-...)
npx wrangler secret put SLACK_SIGNING_SECRET  # Basic Information → Signing Secret
npx wrangler secret put SLACK_USER_ID         # seu member ID: perfil → ⋯ → Copy member ID
```

Os lembretes chegam na aba **Mensagens** do app "Meu Dia" no Slack.

## Testes

```bash
npm test
```

## Estrutura

```
public/            página (HTML, CSS e JS sem build)
  lib/agenda.js    datas e recorrência; usado pela página e pelo Worker
scripts/local.mjs  `npm start`: sobe o app local e dispara o cron a cada minuto
src/worker.js      rotas da API, botões do Slack e cron
src/items.js       validação e consultas ao D1
src/slack.js       mensagens, resumo e verificação de assinatura
src/auth.js        login por senha e sessão
migrations/        schema do D1
test/              testes (node --test)
```

## API

Todas as rotas exigem login (`POST /api/login` com `{password}`; `POST /api/logout` encerra).

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
