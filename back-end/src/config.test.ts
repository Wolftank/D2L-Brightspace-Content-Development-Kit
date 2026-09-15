import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('applies defaults when DATA_DIR and PORT are unset', () => {
    const config = loadConfig({});
    expect(config.DATA_DIR.length).toBeGreaterThan(0);
    expect(config.PORT).toBe(3000);
  });

  it('reads DATA_DIR and PORT from the given environment', () => {
    const config = loadConfig({ DATA_DIR: '/tmp/cdk-data', PORT: '4000' });
    expect(config.DATA_DIR).toBe('/tmp/cdk-data');
    expect(config.PORT).toBe(4000);
  });
});
