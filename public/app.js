/* ── State ─────────────────────────────────────────────────────────────── */
let currentJobId = null;
let eventSource  = null;

/* ── DOM refs ──────────────────────────────────────────────────────────── */
const markdownInput  = document.getElementById('markdownInput');
const parseBtn       = document.getElementById('parseBtn');
const startBtn       = document.getElementById('startBtn');
const continueBtn    = document.getElementById('continueBtn');
const clearLogBtn    = document.getElementById('clearLogBtn');
const logContainer   = document.getElementById('logContainer');
const loginBanner    = document.getElementById('loginBanner');
const previewSection = document.getElementById('previewSection');
const previewTable   = document.getElementById('previewTable');
const itemCountEl    = document.getElementById('itemCount');
const statusDot      = document.getElementById('statusDot');
const summaryBar     = document.getElementById('summaryBar');
const summaryText    = document.getElementById('summaryText');

/* ── Local markdown preview (raw table) ─────────────────────────────────── */
function parseMarkdownTable(md) {
  const lines = md.trim().split('\n').map(l => l.trim()).filter(Boolean);
  const result = { headers: [], rows: [] };
  const headerIdx = lines.findIndex(l => l.includes('|'));
  if (headerIdx === -1) return result;
  let dataStart = headerIdx + 1;
  if (dataStart < lines.length && lines[dataStart].replace(/[\s|:-]/g, '') === '') dataStart++;
  result.headers = lines[headerIdx].split('|').map(h => h.trim()).filter(h => h.length > 0);
  for (let i = dataStart; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes('|')) continue;
    const cells = line.split('|').map(c => c.trim()).filter(c => c.length > 0);
    if (cells.length === 0) continue;
    result.rows.push(cells);
  }
  return result;
}

function renderRawPreview() {
  const { headers, rows } = parseMarkdownTable(markdownInput.value);
  if (!headers.length || !rows.length) { previewSection.style.display = 'none'; return; }
  itemCountEl.textContent = `${rows.length} 行`;
  let html = '<table class="preview-table"><thead><tr>';
  headers.forEach(h => { html += `<th>${esc(h)}</th>`; });
  html += '</tr></thead><tbody>';
  rows.forEach(row => {
    html += '<tr>';
    headers.forEach((_, i) => { html += `<td>${esc(row[i] || '')}</td>`; });
    html += '</tr>';
  });
  html += '</tbody></table>';
  previewTable.innerHTML = html;
  previewSection.style.display = 'block';
}

parseBtn.addEventListener('click', renderRawPreview);
markdownInput.addEventListener('input', () => {
  if (previewSection.style.display !== 'none') renderRawPreview();
});

/* ── Show AI-extracted ingredient list ──────────────────────────────────── */
function renderExtractedItems(items) {
  itemCountEl.textContent = `${items.length} 件食材`;
  let html =
    '<table class="preview-table">' +
    '<thead><tr><th>中文食材</th><th>Morrisons 搜索词</th></tr></thead>' +
    '<tbody>';
  items.forEach(({ chinese, english }) => {
    html += `<tr><td>${esc(chinese)}</td><td>${esc(english)}</td></tr>`;
  });
  html += '</tbody></table>';
  previewTable.innerHTML = html;
  previewSection.style.display = 'block';
}

/* ── Start shopping ─────────────────────────────────────────────────────── */
startBtn.addEventListener('click', async () => {
  const markdown = markdownInput.value.trim();
  if (!markdown) { addLog('请先粘贴购物清单', 'warning'); return; }

  clearLog();
  setStatus('running');
  startBtn.disabled = true;
  loginBanner.style.display  = 'none';
  summaryBar.style.display   = 'none';

  addLog('AI 正在分析菜单，提取食材列表...', 'info');

  try {
    const res  = await fetch('/api/shop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '启动失败');

    currentJobId = data.jobId;

    // Show what Gemini extracted
    if (data.items?.length) {
      renderExtractedItems(data.items);
      addLog(`AI 提取了 ${data.items.length} 件食材，开始购物...`, 'success');
    }

    startSSE(currentJobId);

  } catch (err) {
    addLog(`启动失败: ${err.message}`, 'error');
    setStatus('error');
    startBtn.disabled = false;
  }
});

/* ── SSE stream ─────────────────────────────────────────────────────────── */
function startSSE(jobId) {
  if (eventSource) { eventSource.close(); eventSource = null; }
  eventSource = new EventSource(`/api/shop/stream/${jobId}`);

  eventSource.onmessage = (e) => {
    let data;
    try { data = JSON.parse(e.data); } catch { return; }

    switch (data.type) {
      case 'wait_login':
        loginBanner.style.display = 'flex';
        setStatus('waiting');
        break;
      case 'done':
        loginBanner.style.display = 'none';
        eventSource.close();
        startBtn.disabled = false;
        if (data.success) {
          setStatus('done');
          summaryText.textContent =
            `购物完成！成功加入 ${data.successCount ?? '?'} 件，` +
            `未找到 ${data.failCount ?? 0} 件。请在浏览器中确认付款。`;
          summaryBar.style.display = 'block';
        } else {
          setStatus('error');
          addLog(`任务终止: ${data.error || '未知错误'}`, 'error');
        }
        break;
      default:
        if (data.message) addLog(data.message, data.type || 'log');
    }
  };

  eventSource.onerror = () => {
    addLog('SSE 连接断开', 'warning');
    eventSource.close();
  };
}

/* ── Continue after login ───────────────────────────────────────────────── */
continueBtn.addEventListener('click', async () => {
  if (!currentJobId) return;
  loginBanner.style.display = 'none';
  setStatus('running');
  try {
    await fetch(`/api/shop/continue/${currentJobId}`, { method: 'POST' });
    addLog('已通知 Agent 继续购物...', 'info');
  } catch (err) {
    addLog(`继续失败: ${err.message}`, 'error');
  }
});

/* ── Log helpers ────────────────────────────────────────────────────────── */
function addLog(message, type = 'log') {
  const ph = logContainer.querySelector('.log-placeholder');
  if (ph) ph.remove();
  const entry = document.createElement('div');
  entry.className = `log-entry log-${type}`;
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  entry.innerHTML =
    `<span class="log-time">[${time}]</span>` +
    `<span class="log-msg">${esc(message)}</span>`;
  logContainer.appendChild(entry);
  logContainer.scrollTop = logContainer.scrollHeight;
}

function clearLog() {
  logContainer.innerHTML = '<div class="log-placeholder">日志将在这里实时显示...</div>';
}

clearLogBtn.addEventListener('click', clearLog);

function setStatus(state) {
  statusDot.className = `status-dot ${state}`;
  const labels = { idle:'空闲', running:'运行中', waiting:'等待登录', done:'完成', error:'错误' };
  statusDot.title = labels[state] || state;
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ── Seed example ────────────────────────────────────────────────────────── */
markdownInput.value =
`| 本周菜单 | 在家人数 | 菜单 |
| --- | --- | --- |
| **周日** | ⭐☀ | **卤鸡腿** → 鸡腿，鸡蛋，葱，姜，蒜 |
| **周一** | ⭐☀ | **日式咖喱** → 鸡肉、土豆、胡萝卜、洋葱、咖喱块 |
| **周二** | ⭐☀ | **黑椒牛排** → 牛排、黑胡椒、大蒜、黄油、迷迭香 |
| **周三** | ⭐☀ | 蒸鸡蛋 烤鳕鱼 蚝油生菜 |`;

renderRawPreview();
