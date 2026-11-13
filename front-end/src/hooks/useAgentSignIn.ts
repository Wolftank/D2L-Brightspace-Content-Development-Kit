import { useCallback, useEffect, useState } from 'react';
import { getMe, startAgentSignIn } from '../api/client';

const NOTICES = {
  signed_out: 'Sign in to Claude to send requests.',
  started: 'Finish signing in in your browser, then press Check again.',
  still_signed_out: "Claude isn't signed in yet. Finish signing in in your browser, then press Check again.",
  start_failed: "Sign-in couldn't start. Try again.",
  check_failed: "Couldn't check your sign-in. Try again.",
};

type Status = 'ready' | 'signed_in' | keyof typeof NOTICES;

export interface AgentSignIn {
  /** False while the agent is signed out or a sign-in is waiting for Check again. */
  ready: boolean;
  /** What the instructor reads about signing in; empty when there is nothing to say. */
  notice: string;
  /** True while a sign-in or check request is in flight. */
  busy: boolean;
  /** Starts the agent's sign-in in the instructor's browser. */
  start(): Promise<void>;
  /** Checks again, resolving true once the agent is signed in. */
  checkAgain(): Promise<boolean>;
}

/** Tracks whether the agent is signed in, checking once on mount. */
export function useAgentSignIn(): AgentSignIn {
  const [status, setStatus] = useState<Status>('ready');
  const [busy, setBusy] = useState(false);

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
      const signedIn = (await getMe()).agent.ok;
      setStatus(signedIn ? 'signed_in' : 'still_signed_out');
      return signedIn;
    } catch {
      setStatus('check_failed');
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const ready = status === 'ready' || status === 'signed_in';
  const notice = status === 'ready' ? '' : status === 'signed_in' ? 'Signed in to Claude.' : NOTICES[status];
  return { ready, notice, busy, start, checkAgain };
}
