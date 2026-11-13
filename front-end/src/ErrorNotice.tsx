import type { Failure } from './api/failure';

export function ErrorNotice({ failure, disabled, onSendAgain, onEdit, onNewProject, onAskForFix, onSignIn }: {
  failure: Failure;
  disabled?: boolean;
  onSendAgain?: () => void;
  onEdit?: () => void;
  onNewProject?: () => void;
  onAskForFix?: () => void;
  onSignIn?: () => void;
}) {
  return <div className="error-notice">
    <p className="error" role="alert">{failure.message}</p>
    {failure.nextStep === 'send_again' && onSendAgain && <button type="button" disabled={disabled} onClick={onSendAgain}>Send again</button>}
    {failure.nextStep === 'smaller_request' && onEdit && <button type="button" disabled={disabled} onClick={onEdit}>Try a smaller request</button>}
    {failure.nextStep === 'ask_for_fix' && onAskForFix && <button type="button" disabled={disabled} onClick={onAskForFix}>Ask for a fix</button>}
    {failure.nextStep === 'sign_in' && onSignIn && <button type="button" onClick={onSignIn}>Sign in to Claude</button>}
    {failure.nextStep === 'new_project' && onNewProject && <button type="button" disabled={disabled} onClick={onNewProject}>Start a new project</button>}
    {failure.nextStep === 'try_later' && <p className="hint">Try again later.</p>}
    {failure.nextStep === 'wait' && <p className="hint">Wait for the current request to finish.</p>}
  </div>;
}
