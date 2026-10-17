import { describe, expect, it } from 'vitest';
import { readFailure } from './failure';

describe('instructor errors', () => {
  it.each(['send_again', 'sign_in', 'try_later', 'smaller_request', 'wait', 'new_project', 'ask_for_fix'] as const)('keeps the shared %s action', nextStep => {
    expect(readFailure({ message: 'The request could not finish.', nextStep }).nextStep).toBe(nextStep);
  });
  it('keeps the plain message and approved next step', () => {
    expect(readFailure({ message: 'The request took too many steps.', nextStep: 'smaller_request' })).toEqual({ message: 'The request took too many steps.', nextStep: 'smaller_request' });
  });
  it.each([
    null, { message: 'SQLITE_CORRUPT: database failed', nextStep: 'send_again' },
    { message: 'Error: boom at fn (server.ts:12:4)', nextStep: 'send_again' },
    { message: 'Unknown details', nextStep: 'run_shell' }, { message: 'untrusted server text' },
  ])('hides malformed and technical errors: %j', error => {
    expect(readFailure(error)).toEqual({ message: 'The request could not be completed.', nextStep: 'try_later' });
  });
});
