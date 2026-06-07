import express from 'express';
import cors from 'cors';
import { EventEmitter } from 'events';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { runGroceryAgent } from './agent.js';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

const jobs = new Map();
const jobEmitters = new Map();

// ─── Gemini: extract + translate ingredients from any meal-plan table ─────────
async function extractShoppingList(markdown) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY 未设置，请检查 .env 文件');

  const prompt = `You are a grocery shopping assistant for a UK Morrisons supermarket.

Analyze this Chinese weekly meal-plan table and produce a deduplicated ingredient shopping list.

Rules:
- Ingredients are usually listed AFTER a "→" or "→" symbol inside each cell
- If a cell has food items without "→", include those too
- ONLY extract ingredients/food items — skip dish names, day names (周日/周一), emoji, and the "在家人数" column
- Translate every ingredient into simple English terms a UK shopper would type into Morrisons search
- Remove duplicates — 姜 and 蒜 may appear many times; list each only once
- For Chinese-specific items not commonly sold at UK supermarkets (e.g. 豆瓣酱), still include them with the closest English equivalent (e.g. "spicy bean paste")
- If a note says "from the butcher" (肉铺的), still include the ingredient (e.g. "beef steak")

Table:
${markdown}

Return ONLY a valid JSON array — no markdown fences, no explanation:
[{"chinese":"鸡腿","english":"chicken thighs"},{"chinese":"鸡蛋","english":"eggs"},...]`;

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
      }),
    }
  );

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Gemini API ${resp.status}: ${body.slice(0, 300)}`);
  }

  const data = await resp.json();
  let text = (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
  // Strip accidental markdown fences
  text = text.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();

  let items;
  try {
    items = JSON.parse(text);
  } catch {
    throw new Error(`Gemini 返回了非法 JSON：${text.slice(0, 200)}`);
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Gemini 未能从表格中提取到任何食材');
  }
  return items; // [{ chinese, english }, ...]
}

// ─── POST /api/shop ───────────────────────────────────────────────────────────
app.post('/api/shop', async (req, res) => {
  const { markdown } = req.body;

  if (!markdown?.trim()) {
    return res.status(400).json({ error: '请提供 Markdown 表格内容' });
  }
  if (!markdown.includes('|')) {
    return res.status(400).json({ error: '请粘贴包含 | 分隔符的 Markdown 表格' });
  }

  // ── Step 1: extract & translate with Gemini (blocks until done, ~2-3 s) ──
  let items;
  try {
    items = await extractShoppingList(markdown);
  } catch (err) {
    return res.status(500).json({ error: `菜单分析失败: ${err.message}` });
  }

  // ── Fixed breakfast items (always added) ──────────────────────────────────
  const BREAKFAST = [
    { chinese: '肉片', english: 'sliced cooked meat' },
    { chinese: '沙拉菜', english: 'mixed salad leaves' },
    { chinese: '面包',  english: 'bread' },
  ];
  // Append only if not already in the extracted list (case-insensitive dedup)
  const existingEn = new Set(items.map(i => i.english.toLowerCase()));
  for (const item of BREAKFAST) {
    if (!existingEn.has(item.english.toLowerCase())) {
      items.push(item);
    }
  }

  // ── Step 2: create job + emitter ──────────────────────────────────────────
  const jobId = `job_${Date.now()}`;
  const emitter = new EventEmitter();
  emitter.setMaxListeners(30);

  const job = { status: 'running', logs: [], items };
  jobs.set(jobId, job);
  jobEmitters.set(jobId, emitter);

  // Pre-buffer ALL emitter events so late-connecting SSE clients see everything
  const storeAndBroadcast = (entry) => {
    job.logs.push(entry);
    emitter.emit('_entry', entry);
  };

  emitter.on('log',        (d)  => storeAndBroadcast({ ...d,   ts: Date.now() }));
  emitter.on('wait_login', ()   => storeAndBroadcast({ type: 'wait_login', ts: Date.now() }));
  emitter.on('done',       (d)  => {
    const entry = { type: 'done', ...d, ts: Date.now() };
    job.logs.push(entry);
    job.status = 'done';
    emitter.emit('_entry', entry);
  });

  // ── Step 3: fire the agent ────────────────────────────────────────────────
  runGroceryAgent(items, emitter).catch(err => {
    emitter.emit('log',  { type: 'error', message: `Agent 崩溃: ${err?.message || err}` });
    emitter.emit('done', { success: false, error: err?.message });
  });

  res.json({ jobId, itemCount: items.length, items });
});

// ─── GET /api/shop/stream/:jobId — SSE ───────────────────────────────────────
app.get('/api/shop/stream/:jobId', (req, res) => {
  const { jobId } = req.params;
  const emitter = jobEmitters.get(jobId);
  const job     = jobs.get(jobId);

  if (!emitter || !job) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.write(`data: ${JSON.stringify({ type: 'error', message: '任务不存在' })}\n\n`);
    return res.end();
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Replay buffer
  job.logs.forEach(e => res.write(`data: ${JSON.stringify(e)}\n\n`));

  // Stream live
  const onEntry = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  emitter.on('_entry', onEntry);
  req.on('close', () => emitter.off('_entry', onEntry));
});

// ─── POST /api/shop/continue/:jobId ──────────────────────────────────────────
app.post('/api/shop/continue/:jobId', (req, res) => {
  const emitter = jobEmitters.get(req.params.jobId);
  if (!emitter) return res.status(404).json({ error: '任务不存在' });
  emitter.emit('continue');
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`\n购物 Agent 服务已启动: http://localhost:${PORT}\n`));
