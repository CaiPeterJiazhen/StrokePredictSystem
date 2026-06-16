import { describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => {
  const windows: Array<{ loadFile: ReturnType<typeof vi.fn>; loadURL: ReturnType<typeof vi.fn> }> = [];
  const BrowserWindow = vi.fn(function BrowserWindow(options: unknown) {
    const window = {
      options,
      loadFile: vi.fn(),
      loadURL: vi.fn(),
    };
    windows.push(window);
    return window;
  });

  Object.assign(BrowserWindow, {
    getAllWindows: vi.fn(() => windows),
  });

  return {
    app: {
      isPackaged: false,
      on: vi.fn(),
      quit: vi.fn(),
      whenReady: vi.fn(() => Promise.resolve()),
    },
    BrowserWindow,
    windows,
  };
});

const databaseMocks = vi.hoisted(() => ({
  localDatabase: {
    close: vi.fn(),
    db: {},
    paths: {
      dataRoot: 'F:\\data',
      clinicalDocsBackupRoot: 'F:\\backup',
    },
    save: vi.fn(),
  },
  openLocalDatabase: vi.fn(),
  registerIpcHandlers: vi.fn(),
}));

vi.mock('electron', () => ({
  app: electronMocks.app,
  BrowserWindow: electronMocks.BrowserWindow,
}));

vi.mock('../../src/electron/backend/database.js', () => ({
  openLocalDatabase: databaseMocks.openLocalDatabase,
}));

vi.mock('../../src/electron/backend/ipcHandlers.js', () => ({
  registerIpcHandlers: databaseMocks.registerIpcHandlers,
}));

describe('Electron main process window configuration', () => {
  it('creates the app window with a preload script that can access Electron APIs', async () => {
    vi.resetModules();
    electronMocks.windows.length = 0;
    electronMocks.BrowserWindow.mockClear();
    electronMocks.app.whenReady.mockClear();
    electronMocks.app.on.mockClear();
    databaseMocks.openLocalDatabase.mockResolvedValue(databaseMocks.localDatabase);
    databaseMocks.registerIpcHandlers.mockClear();

    await import('../../src/electron/main.js');
    await Promise.resolve();
    await Promise.resolve();

    expect(databaseMocks.openLocalDatabase).toHaveBeenCalledOnce();
    expect(databaseMocks.registerIpcHandlers).toHaveBeenCalledWith(databaseMocks.localDatabase);
    expect(electronMocks.BrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        webPreferences: expect.objectContaining({
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
          preload: expect.stringMatching(/preload\.cjs$/),
        }),
      }),
    );
    expect(electronMocks.windows[0].loadURL).toHaveBeenCalledWith('http://127.0.0.1:5173');
  });
});
