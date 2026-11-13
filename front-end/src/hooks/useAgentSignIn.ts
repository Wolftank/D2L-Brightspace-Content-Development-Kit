import { useCallback, useEffect, useState } from 'react';
import { getMe, startAgentSignIn } from '../api/client';

const NOTICES = {
  signed_out: 'Sign in to Claude to send requests.',
  started: 'Finish signing in in your browser, then come back here.',
  still_signed_out: "Claude isn't signed in yet. Finish signing in in your browser, then press Check again.",
  start_failed: "Sign-in couldn't start. Try again.",
  check_failed: "Couldn't check your sign-in. Try again.",
};

type Status = 'ready' | 'signed_in' | keyof typeof NOTICES;

export interface AgentSignIn {
  /** False while the agent is signed out or a started sign-in is unconfirmed. */
  ready: boolean;
  /** True once a check finds the agent signed in after it was signed out. */
  confirmed: boolean;
  /** What the instructor reads about signing in; empty when there is nothing to say. */
  notice: string;
  /** True while a sign-in or check request is in flight. */
  busy: boolean;
  /** Starts the agent's sign-in in the instructor's browser. */
  start(): Promise<void>;
  checkAgain(): Promise<void>;
}

/**
 * Tracks whether the agent is signed in. Checks on mount, and once a sign-in
 * has started, each time the window gets focus back.
 */
export function useAgentSignIn(): AgentSignIn {
  const [status, setStatus] = useState<Status>('ready');
  const [busy, setBusy] = useState(false);
  const waiting = status === 'started' || status === 'still_signed_out';

  useEffect(() => {
    getMe().then(me => { if (!me.agent.ok) setStatus('signed_out'); }).catch(() => undefined);
  }, []);

  const start = useCallback(async () => {
    setBusy(true);
    try {
      await startAgentSignIn();
      setStatus('started');
    } catch {
      setStatus('start_failed');
    } finally {
      setBusy(false);
    }
  }, []);

  const checkAgain = useCallback(async () => {
    setBusy(true);
    try {
      setStatus((await getMe()).agent.ok ? 'signed_in' : 'still_signed_out');
    } catch {
      setStatus('check_failed');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!waiting) return;
    const check = () => void checkAgain();
    window.addEventListener('focus', check);
    return () => window.removeEventListener('focus', check);
  }, [waiting, checkAgain]);

  const confirmed = status === 'signed_in';
  const notice = status === 'ready' ? '' : confirmed ? 'Signed in to Claude.' : NOTICES[status];
  return { ready: status === 'ready' || confirmed, confirmed, notice, busy, start, checkAgain };
}
