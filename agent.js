import { Stagehand } from '@browserbasehq/stagehand';
import 'dotenv/config';

export async function runGroceryAgent(items, emitter) {
  const log = (msg, type = 'log') => emitter.emit('log', { type, message: msg });

  let stagehand;

  try {
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY 未设置，请检查 .env');
    log('正在启动 Chrome 浏览器...');

    stagehand = new Stagehand({
      env: 'LOCAL',
      model: 'google/gemini-2.5-flash',
      headless: false,
      verbose: 0,
    });

    await Promise.race([
      stagehand.init(),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error('stagehand.init() 超时（60秒）')), 60_000)
      ),
    ]);
    log('浏览器已启动', 'success');

    const pages = stagehand.context.pages();
    if (!pages.length) throw new Error('未找到浏览器页面');
    const page = pages[0];

    // ── Navigate + login wait ──────────────────────────────────────────────
    log('正在打开 Morrisons...');
    await page.goto('https://groceries.morrisons.com', { waitUntil: 'domcontentloaded' });
    log('请在浏览器中完成登录（如已登录可跳过），完成后点击"已完成登录，继续"', 'info');
    emitter.emit('wait_login');
    await new Promise(resolve => emitter.once('continue', resolve));
    log('开始购物...', 'success');

    // ── Shopping loop ─────────────────────────────────────────────────────
    // Fast: URL navigation (no LLM). Reliable: stagehand.act() clicks Add.
    let successCount = 0;
    let failCount    = 0;

    for (let i = 0; i < items.length; i++) {
      const { chinese, english } = items[i];
      log(`[${i + 1}/${items.length}]  ${chinese}  →  "${english}"`);

      try {
        // 1. Jump straight to search results page — no LLM, instant
        const searchUrl =
          `https://groceries.morrisons.com/search?q=${encodeURIComponent(english)}`;
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });
        await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

        // 2. Let Stagehand's LLM click the Add button — this is what worked before
        await stagehand.act(
          `Click the "Add" or "Add to trolley" button for the first product in the search results`
        );

        await page.waitForTimeout(400);
        log(`✓ 已加入购物车: ${chinese}`, 'success');
        successCount++;

      } catch (err) {
        // act() throws when it can't find the element → genuinely no results
        log(`⚠  "${chinese}": 未找到此商品，已跳过`, 'warning');
        failCount++;
      }
    }

    // ── View trolley ───────────────────────────────────────────────────────
    log(`完成 — 成功 ${successCount} 件，未找到 ${failCount} 件。正在跳转购物车...`);
    // Use Stagehand's LLM here (just once, for the non-deterministic trolley icon)
    await stagehand.act('Click the trolley icon at the top right of the page').catch(() => {});

    log('全部完成！请在浏览器中确认购物车并付款。', 'success');
    emitter.emit('done', { success: true, successCount, failCount });

  } catch (err) {
    log(`Agent 错误: ${err.message}`, 'error');
    emitter.emit('done', { success: false, error: err.message });
    throw err;
  }
  // Intentionally keep browser open for checkout
}
