import { afterEach, describe, expect, it, vi } from 'vitest';

describe('createAgentDriver', () => {
  afterEach(() => {
    vi.doUnmock('./claude.js');
    vi.resetModules();
  });

  it('builds the Claude driver with the configured model and effort for AGENT_DRIVER=claude', async () => {
    const createClaudeAgentDriver = vi.fn(() => ({ name: 'claude' }));
    vi.doMock('./claude.js', () => ({ createClaudeAgentDriver }));
    const { createAgentDriver } = await import('./drivers.js');

    const driver = createAgentDriver({ driver: 'claude', model: 'claude-sonnet-5', effort: 'low' });

    expect(driver.name).toBe('claude');
    expect(createClaudeAgentDriver).toHaveBeenCalledWith({ model: 'claude-sonnet-5', effort: 'low' });
  });
});
