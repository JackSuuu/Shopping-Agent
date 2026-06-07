import { app, BrowserWindow, dialog, shell } from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));

let mainWindow;

async function startApp() {
  // ── Load .env ──────────────────────────────────────────────────────────────
  // Packaged: ~/Library/Application Support/Shopping Agent/.env
  // Dev:      .env next to this file
  const envPath = app.isPackaged
    ? join(app.getPath('userData'), '.env')
    : join(__dirname, '.env');

  dotenv.config({ path: envPath });

  // Warn if API key is missing when packaged
  if (app.isPackaged && !process.env.GEMINI_API_KEY) {
    dialog.showMessageBoxSync({
      type: 'warning',
      title: 'API Key 未设置',
      message: '找不到 GEMINI_API_KEY',
      detail:
        `请在以下路径创建 .env 文件：\n\n${envPath}\n\n` +
        `文件内容：\nGEMINI_API_KEY=你的密钥\n\n然后重新启动应用。`,
    });
  }

  // ── Start Express server ───────────────────────────────────────────────────
  let serverPort;
  try {
    const { startServer } = await import('./server.js');
    serverPort = await startServer();
  } catch (err) {
    dialog.showErrorBox('服务器启动失败', err.message);
    app.quit();
    return;
  }

  // ── Create window ──────────────────────────────────────────────────────────
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 820,
    minHeight: 580,
    titleBarStyle: 'hiddenInset',   // macOS native traffic-light buttons
    backgroundColor: '#191919',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(`http://localhost:${serverPort}`);

  // Open any <a target="_blank"> links in the system browser, not Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(startApp);

// Quit when all windows closed (standard macOS behaviour: keep running in dock
// is intentionally skipped — shopping sessions shouldn't linger in background)
app.on('window-all-closed', () => app.quit());

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) startApp();
});
