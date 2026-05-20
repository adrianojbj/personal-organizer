import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import people from './routes/people.js';
import tasks from './routes/tasks.js';
import { startBot, getBotEnabled } from './slack/bot.js';
import { startScheduler } from './scheduler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ ok: true, slack: getBotEnabled() });
});

app.use('/api/people', people);
app.use('/api/tasks', tasks);

const webDist = path.join(__dirname, '..', 'web', 'dist');
app.use(express.static(webDist));
app.get(/^\/(?!api).*/, (req, res, next) => {
  res.sendFile(path.join(webDist, 'index.html'), (err) => err && next());
});

const port = process.env.PORT || 3001;

(async () => {
  await startBot();
  startScheduler();
  app.listen(port, () => {
    console.log(`[server] listening on http://localhost:${port}`);
  });
})();
