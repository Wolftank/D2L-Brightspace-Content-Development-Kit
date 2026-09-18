import { describe, expect, it, vi } from 'vitest';
import { ApiError, createProject } from './client';

describe('createProject', () => {
  it('turns the API error envelope into an ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'turn_active', message: 'A turn is already active for this project', details: { turnId: 'turn-1' }, },
    }), { status: 409 })));

    const error = await createProject({ title: 'Cell division' }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'turn_active', message: 'A turn is already active for this project', details: { turnId: 'turn-1' } });
  });
});
