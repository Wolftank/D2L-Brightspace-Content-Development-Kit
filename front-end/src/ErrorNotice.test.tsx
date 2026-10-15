import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ErrorNotice } from './ErrorNotice';

describe('error recovery actions', () => {
  it.each([['send_again', 'Send again', 'onSendAgain'], ['try_smaller_request', 'Try a smaller request', 'onEdit'], ['start_new_project', 'Start a new project', 'onNewProject']] as const)('%s invokes its action', (nextStep, label, prop) => {
    const action = vi.fn();
    render(<ErrorNotice failure={{ message: 'Please try a different request.', nextStep }} {...{ [prop]: action }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Please try a different request.');
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(action).toHaveBeenCalledOnce();
  });
  it('opens the host sign-in page in a separate tab', () => {
    render(<ErrorNotice failure={{ message: 'The agent needs you to sign in.', nextStep: 'sign_in_to_agent' }} />);
    expect(screen.getByRole('link', { name: 'Sign in to the agent' })).toHaveAttribute('href', '/api/agent/sign-in');
    expect(screen.getByRole('link')).toHaveAttribute('target', '_blank');
  });
  it.each([['try_again_later', 'Try again later.'], ['wait_for_current_request', 'Wait for the current request to finish.']] as const)('shows %s as guidance', (nextStep, text) => {
    render(<ErrorNotice failure={{ message: 'Please wait.', nextStep }} />);
    expect(screen.getByText(text)).toBeVisible(); expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
