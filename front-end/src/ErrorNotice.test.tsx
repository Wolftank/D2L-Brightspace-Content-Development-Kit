import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ErrorNotice } from './ErrorNotice';

describe('error recovery actions', () => {
  it.each([['send_again', 'Send again', 'onSendAgain'], ['ask_for_fix', 'Ask for a fix', 'onAskForFix'], ['smaller_request', 'Try a smaller request', 'onEdit'], ['new_project', 'Start a new project', 'onNewProject'], ['sign_in', 'Sign in to Claude', 'onSignIn']] as const)('%s invokes its action', (nextStep, label, prop) => {
    const action = vi.fn();
    render(<ErrorNotice failure={{ message: 'Please try a different request.', nextStep }} {...{ [prop]: action }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Please try a different request.');
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(action).toHaveBeenCalledOnce();
  });
  it.each([['try_later', 'Try again later.'], ['wait', 'Wait for the current request to finish.']] as const)('shows %s as guidance', (nextStep, text) => {
    render(<ErrorNotice failure={{ message: 'Please wait.', nextStep }} />);
    expect(screen.getByText(text)).toBeVisible(); expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
