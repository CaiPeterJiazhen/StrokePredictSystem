/// <reference types="vite/client" />

import type { NeuroPredictBridge } from './electron/preload';

declare global {
  interface Window {
    neuroPredict?: NeuroPredictBridge;
  }
}

export {};
