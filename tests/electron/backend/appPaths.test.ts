import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveDefaultDataRoot } from '../../../src/electron/backend/appPaths.js';

describe('Electron app paths', () => {
  it('stores the application workspace on the F drive by default', () => {
    expect(resolveDefaultDataRoot()).toBe(path.join('F:\\', 'NeuroPredict'));
  });
});
