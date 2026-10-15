import { describe, expect, it } from 'vitest';
import { readFailure } from './failure';

describe('instructor errors', () => {
  it('keeps the plain message and approved next step', () => {
    expect(readFailure({ message: 'The request took too many steps.', nextStep: 'try_smaller_request' })).toEqual({ message: 'The request took too many steps.', nextStep: 'try_smaller_request' });
  });
  it.each([
    null, { message: 'SQLITE_CORRUPT: database failed', nextStep: 'send_again' },
    { message: 'Error: boom at fn (server.ts:12:4)', nextStep: 'send_again' },
    { message: 'Unknown details', nextStep: 'run_shell' }, { message: 'untrusted server text' },
  ])('hides malformed and technical errors: %j', error => {
    expect(readFailure(error)).toEqual({ message: 'The request could not be completed.', nextStep: 'try_again_later' });
  });
});
