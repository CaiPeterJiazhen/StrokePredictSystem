const fs = require('node:fs');
const path = require('node:path');

const inputPath = path.resolve(__dirname, '../dist-electron/electron/preload.js');
const outputPath = path.resolve(__dirname, '../dist-electron/electron/preload.cjs');

let source = fs.readFileSync(inputPath, 'utf8');
source = source.replace(
  "import { contextBridge, ipcRenderer } from 'electron';",
  "const { contextBridge, ipcRenderer } = require('electron');",
);
source = source.replace(/\nexport\s*\{\};?\s*$/u, '\n');

if (/^\s*import\s/mu.test(source)) {
  throw new Error('Generated preload.cjs still contains an ESM import.');
}

fs.writeFileSync(outputPath, source);
