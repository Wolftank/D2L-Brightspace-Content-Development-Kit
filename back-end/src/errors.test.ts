import { describe, expect, it } from 'vitest';
import { API_ERRORS } from './errors.js';
import { TURN_ERRORS } from './pipeline/runner.js';
import { BUILD_ERRORS } from './services/builds.js';

const TABLES = { API_ERRORS, TURN_ERRORS, BUILD_ERRORS };

function nextSteps(errors: Record<string, { nextStep: string }>): Record<string, string> {
  return Object.fromEntries(Object.entries(errors).map(([code, { nextStep }]) => [code, nextStep]));
}

describe('errors an instructor can see', () => {
  const messages = Object.entries(TABLES).flatMap(([table, errors]) =>
    Object.entries(errors).map(([code, { message }]) => [`${table}.${code}`, message] as const),
  );

  it.each(messages)('%s reads as one plain sentence', (_code, message) => {
    expect(message).toMatch(/^[A-Z][^_:;{}<>()[\]]*\.$/);
    expect(message.length).toBeLessThanOrEqual(100);
    expect(message).not.toMatch(/\b(turn|gate|json|api|stack|exception|undefined|null)\b/i);
  });

  it('gives every turn error its next step', () => {
    expect(nextSteps(TURN_ERRORS)).toEqual({
      agent_error: 'send_again',
      agent_signed_out: 'sign_in',
      agent_billing: 'sign_in',
      agent_busy: 'try_later',
      agent_unrestricted: 'try_later',
      max_steps_exceeded: 'smaller_request',
      max_budget_exceeded: 'smaller_request',
      no_result: 'send_again',
      driver_error: 'send_again',
      workspace_missing: 'new_project',
      interrupted: 'send_again',
      internal_error: 'send_again',
    });
  });

  it('gives every API error its next step', () => {
    expect(nextSteps(API_ERRORS)).toEqual({
      invalid_request: 'send_again',
      invalid_json: 'send_again',
      payload_too_large: 'smaller_request',
      not_found: 'new_project',
      build_not_found: 'send_again',
      turn_active: 'wait',
      build_not_ready: 'try_later',
      build_failed: 'ask_for_fix',
      build_incomplete: 'send_again',
      internal_error: 'try_later',
    });
  });

  it('gives every build error its next step', () => {
    expect(nextSteps(BUILD_ERRORS)).toEqual({
      qa_failed: 'ask_for_fix',
      interrupted: 'send_again',
      copy_failed: 'send_again',
      gate_crashed: 'send_again',
      gate_invalid_output: 'send_again',
      gate_inconsistent: 'send_again',
    });
  });
});
