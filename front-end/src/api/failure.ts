import type { NextStep } from '@cdk/contract';
export const NEXT_STEPS = { send_again: true, sign_in: true, try_later: true, smaller_request: true, wait: true, new_project: true, ask_for_fix: true } satisfies Record<NextStep, true>;
export interface Failure { message: string; nextStep: NextStep }

const GENERIC_FAILURE: Failure = { message: 'The request could not be completed.', nextStep: 'try_later' };

/** Reads an instructor-facing error without exposing an unrecognised response. */
export function readFailure(value: unknown): Failure {
  if (!value || typeof value !== 'object') return GENERIC_FAILURE;
  const error = value as Record<string, unknown>;
  if (typeof error.nextStep !== 'string' || !Object.hasOwn(NEXT_STEPS, error.nextStep) || typeof error.message !== 'string' || !error.message.trim()) return GENERIC_FAILURE;
  if (/\b(?:Error|Exception):|\bat\s+\S+\s*\(|\.[jt]sx?:\d+:\d+|\b[A-Z]+_[A-Z_]+\b|\[object Object\]/.test(error.message)) return GENERIC_FAILURE;
  return { message: error.message, nextStep: error.nextStep as NextStep };
}
