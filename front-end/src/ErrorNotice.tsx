import type { Failure } from './api/failure';

export function ErrorNotice({ failure, disabled, onSendAgain, onEdit, onNewProject }: {
  failure: Failure;
  disabled?: boolean;
  onSendAgain?: () => void;
  onEdit?: () => void;
  onNewProject?: () => void;
}) {
  return <div className="error-notice">
    <p className="error" role="alert">{failure.message}</p>
    {failure.nextStep === 'send_again' && onSendAgain && <button type="button" disabled={disabled} onClick={onSendAgain}>Send again</button>}
    {failure.nextStep === 'try_smaller_request' && onEdit && <button type="button" disabled={disabled} onClick={onEdit}>Try a smaller request</button>}
    {failure.nextStep === 'sign_in_to_agent' && <a className="error-action" href="/api/agent/sign-in" target="_blank" rel="noopener noreferrer">Sign in to the agent</a>}
    {failure.nextStep === 'start_new_project' && onNewProject && <button type="button" disabled={disabled} onClick={onNewProject}>Start a new project</button>}
    {failure.nextStep === 'try_again_later' && <p className="hint">Try again later.</p>}
    {failure.nextStep === 'wait_for_current_request' && <p className="hint">Wait for the current request to finish.</p>}
  </div>;
}
