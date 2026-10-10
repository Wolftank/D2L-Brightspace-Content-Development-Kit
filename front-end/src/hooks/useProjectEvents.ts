import { useEffect, useReducer, useRef, useState } from 'react';
import type { ConnectionStatus } from '../WorkingIndicator';
import { getMessages, projectEventsUrl } from '../api/client';
import type {
  Build,
  Message,
  Turn,
  ProjectEvent,
} from '../api/types';

export interface StatusLine {
  seq: number;
  text: string;
  callId?: string;
}

export interface ProjectEventState {
  turn: {
    id: string | null;
    startedAt: number | null;
    currentStep: string;
    status: 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';
  };
  statusLines: StatusLine[];
  replyText: string;
  builds: Build[];
  messages: Message[];
  outcomes: Record<string, { status: string; message?: string }>;
}

type ProjectEventReducerAction =
  | ProjectEvent
  | { type: 'message'; message: Message }
  | { type: 'history'; messages: (Message & { turn?: Pick<Turn, 'id' | 'status' | 'error'> })[] }
  | {
      type: 'restore';
      projectId: string | null;
      state: ProjectEventState;
    };

export const initialProjectEventState: ProjectEventState = {
  turn: {
    id: null,
    startedAt: null,
    currentStep: '',
    status: 'idle',
  },
  statusLines: [],
  replyText: '',
  builds: [],
  messages: [],
  outcomes: {},
};


function mergeMessages(current: Message[], incoming: Message[]): Message[] {
  const messages = new Map(current.map(message => [message.id, message]));
  for (const message of incoming) messages.set(message.id, message);
  return [...messages.values()].sort((a, b) => a.seq - b.seq);
}

function updateBuilds(builds: Build[], updatedBuild: Build): Build[] {
  const exists = builds.some((build) => build.id === updatedBuild.id);

  if (!exists) {
    return [...builds, updatedBuild];
  }

  return builds.map((build) =>
    build.id === updatedBuild.id ? updatedBuild : build
  );
}

export function projectEventReducer(
  state: ProjectEventState,
  action: ProjectEventReducerAction,
): ProjectEventState {
  if (!('kind' in action)) {
    if (action.type === 'message') return { ...state, messages: mergeMessages(state.messages, [action.message]) };
    if (action.type === 'history') {
      const outcomes = { ...state.outcomes };
      for (const message of action.messages) {
        if (message.turn && !outcomes[message.turn.id]) outcomes[message.turn.id] = {
          status: message.turn.status, message: message.turn.error?.message,
        };
      }
      return { ...state, messages: mergeMessages(state.messages, action.messages), outcomes };
    }
    return { ...action.state, messages: mergeMessages(action.state.messages, state.messages.filter(message => message.projectId === action.projectId)) };
  }

  const event = action;

  switch (event.kind) {
    case 'turn.started':
      return {
        ...state,
        turn: {
          id: event.payload.turnId,
          startedAt: event.payload.startedAt,
          currentStep: '',
          status: 'running',
        },
        replyText: '',
        statusLines: [
          { seq: event.seq, text: 'Starting your build' },
        ],
      };

    case 'turn.status':
      return {
        ...state,
        turn: { ...state.turn, currentStep: event.payload.text },
        statusLines: [
          ...state.statusLines,
          { seq: event.seq, text: event.payload.text },
        ],
      };

    case 'message.delta':
      return {
        ...state,
        replyText: state.replyText + event.payload.text,
      };

    case 'message.completed':
  return {
    ...state,
    messages: mergeMessages(state.messages, [event.payload.message]),
    replyText: event.payload.message.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join(''),
  };

    case 'tool.started':
      return {
        ...state,
        turn: { ...state.turn, currentStep: event.payload.summary },
        statusLines: [
          ...state.statusLines,
          { seq: event.seq, text: event.payload.summary, callId: event.payload.callId },
        ],
      };

    case 'tool.finished':
      return {
        ...state,
        turn: { ...state.turn, currentStep: event.payload.summary },
        statusLines: state.statusLines.map((line) =>
          line.callId === event.payload.callId && !event.payload.ok
            ? { ...line, text: event.payload.summary }
            : line,
        ),
      };

    case 'build.created':
    case 'build.updated':
      return {
        ...state,
        builds: updateBuilds(state.builds, event.payload.build),
      };

    case 'deployment.updated':
      return state;

    case 'turn.completed':
      return {
        ...state,
        outcomes: { ...state.outcomes, [event.payload.turnId]: { status: 'completed' } },
        turn: {
          ...state.turn,
          status: 'completed',
        },
        statusLines: [
          ...state.statusLines,
          { seq: event.seq, text: 'Build complete' },
        ],
      };

    case 'turn.failed':
      return {
        ...state,
        outcomes: { ...state.outcomes, [event.payload.turnId]: { status: 'failed', message: event.payload.error.message } },
        turn: {
          id: event.payload.turnId,
          status: 'failed',
          startedAt: state.turn.startedAt,
          currentStep: state.turn.currentStep,
        },
        statusLines: [
          ...state.statusLines,
          { seq: event.seq, text: event.payload.error.message },
        ],
      };

    case 'turn.cancelled':
  return {
    ...state,
    outcomes: { ...state.outcomes, [event.payload.turnId]: { status: 'cancelled', message: 'This request was cancelled.' } },
    turn: {
      id: event.payload.turnId,
      status: 'cancelled',
      startedAt: state.turn.startedAt,
      currentStep: state.turn.currentStep,
    },
    statusLines: [
      ...state.statusLines,
      { seq: event.seq, text: 'Build cancelled' },
    ],
  };

default:
  return state;
}
}


export function useProjectEvents(projectId: string | null) {
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [connection, setConnection] = useState<ConnectionStatus>('reconnecting');
  const storageStateKey = projectId
  ? `chat-${projectId}-event-state`
  : null;

const [state, dispatch] = useReducer(
  projectEventReducer,
  initialProjectEventState,
  (defaultState) => {
    if (!storageStateKey) {
      return defaultState;
    }

    const saved = sessionStorage.getItem(storageStateKey);

    if (!saved) {
      return defaultState;
    }

    try {
      return JSON.parse(saved) as ProjectEventState;
    } catch {
      return defaultState;
    }
  },
);

const previousStorageStateKey = useRef(storageStateKey);
const skipNextPersist = useRef(false);

useEffect(() => {
  if (previousStorageStateKey.current === storageStateKey) {
    return;
  }

  previousStorageStateKey.current = storageStateKey;
  skipNextPersist.current = true;

  if (!storageStateKey) {
    dispatch({
      type: 'restore',
      projectId,
      state: initialProjectEventState,
    });
    return;
  }

  const saved = sessionStorage.getItem(storageStateKey);

  if (!saved) {
    dispatch({
      type: 'restore',
      projectId,
      state: initialProjectEventState,
    });
    return;
  }

  try {
    dispatch({
      type: 'restore',
      projectId,
      state: JSON.parse(saved) as ProjectEventState,
    });
  } catch {
    dispatch({
      type: 'restore',
      projectId,
      state: initialProjectEventState,
    });
  }
}, [storageStateKey, projectId]);

useEffect(() => {
  if (!storageStateKey) {
    return;
  }

  if (skipNextPersist.current) {
    skipNextPersist.current = false;
    return;
  }

  sessionStorage.setItem(
    storageStateKey,
    JSON.stringify(state),
  );
}, [state, storageStateKey]);

  useEffect(() => {
    if (!projectId) return;

    const storageKey = `chat-${projectId}-last-seq`;
    const lastSeq = sessionStorage.getItem(storageKey);

    let url = projectEventsUrl(projectId);

    if (lastSeq) {
      url += `?after=${encodeURIComponent(lastSeq)}`;
    }

    const stream = new EventSource(url);
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    stream.addEventListener('open', () => {
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
      setConnection('connected');
    });
    stream.addEventListener('error', () => {
      if (stream.readyState === 2) {
        clearTimeout(reconnectTimer);
        setConnection('lost');
        return;
      }
      setConnection('reconnecting');
      reconnectTimer ??= setTimeout(() => {
        stream.close();
        setConnection('lost');
      }, 30_000);
    });

    const eventKinds = [
      'turn.started',
      'turn.status',
      'message.delta',
      'message.completed',
      'tool.started',
      'tool.finished',
      'build.created',
      'build.updated',
      'deployment.updated',
      'turn.completed',
      'turn.failed',
      'turn.cancelled',
    ] as const;

    for (const kind of eventKinds) {
      stream.addEventListener(kind, (event) => {
        const message = event as MessageEvent<string>;

        const projectEvent = {
  seq: Number(message.lastEventId),
  kind,
  payload: JSON.parse(message.data),
} as ProjectEvent;

const lastProcessedSeq = Number(
  sessionStorage.getItem(storageKey) ?? '0',
);

if (projectEvent.seq <= lastProcessedSeq) {
  return;
}

sessionStorage.setItem(
  storageKey,
  String(projectEvent.seq),
);

dispatch(projectEvent);

      });
    }

    return () => {
      clearTimeout(reconnectTimer);
      stream.close();
    };
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    async function loadHistory() {
      let cursor: string | undefined;
      do {
        const page = await getMessages(projectId!, cursor);
        if (cancelled) return;
        dispatch({ type: 'history', messages: page.items });
        cursor = page.nextCursor;
      } while (cursor);
    }
    void loadHistory().catch(() => { if (!cancelled) setHistoryError('Unable to load the conversation. Reload to try again.'); });
    return () => { cancelled = true; };
  }, [projectId]);

  return { ...state, connection, historyError, addMessage: (message: Message) => dispatch({ type: 'message', message }) };
}
