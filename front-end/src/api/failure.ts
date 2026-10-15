export const NEXT_STEPS = ['send_again', 'sign_in_to_agent', 'try_again_later', 'try_smaller_request', 'wait_for_current_request', 'start_new_project'] as const;
export type NextStep = typeof NEXT_STEPS[number];
export interface Failure { message: string; nextStep: NextStep }

const GENERIC_FAILURE: Failure = { message: 'The request could not be completed.', nextStep: 'try_again_later' };

/** Reads an instructor-facing error without exposing an unrecognised response. */
export function readFailure(value: unknown): Failure {
  if (!value || typeof value !== 'object') return GENERIC_FAILURE;
  const error = value as Record<string, unknown>;
  if (!NEXT_STEPS.includes(error.nextStep as NextStep) || typeof error.message !== 'string' || !error.message.trim()) return GENERIC_FAILURE;
  if (/\b(?:Error|Exception):|\bat\s+\S+\s*\(|\.[jt]sx?:\d+:\d+|\b[A-Z]+_[A-Z_]+\b|\[object Object\]/.test(error.message)) return GENERIC_FAILURE;
  return { message: error.message, nextStep: error.nextStep as NextStep };
}
