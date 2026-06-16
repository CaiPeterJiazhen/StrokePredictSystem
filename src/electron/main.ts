import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openLocalDatabase, type LocalDatabase } from './backend/database.js';
import { registerIpcHandlers } from './backend/ipcHandlers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let localDatabase: LocalDatabase | null = null;

function createWindow() {
  const window = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    title: 'NeuroPredict',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? 'http://127.0.0.1:5173';

  if (app.isPackaged) {
    void window.loadFile(path.join(__dirname, '../../dist/index.html'));
  } else {
    void window.loadURL(devServerUrl);
  }
}

app.whenReady().then(async () => {
  localDatabase = await openLocalDatabase();
  registerIpcHandlers(localDatabase);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  localDatabase?.close();
  localDatabase = null;
});
