import { useEffect, useReducer } from 'react';
import { projectEventsUrl } from '../api/client';
import type {
  Build,
  ProjectEvent,
} from '../api/types';

export interface StatusLine {
  seq: number;
  text: string;
}

export interface ProjectEventState {
  turn: {
    id: string | null;
    status: 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';
  };
  statusLines: StatusLine[];
  replyText: string;
  builds: Build[];
}

export const initialProjectEventState: ProjectEventState = {
  turn: {
    id: null,
    status: 'idle',
  },
  statusLines: [],
  replyText: '',
  builds: [],
};


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
  event: ProjectEvent,
): ProjectEventState {
  switch (event.kind) {
    case 'turn.started':
      return {
        ...state,
        turn: {
          id: event.payload.turnId,
          status: 'running',
        },
        statusLines: [
          ...state.statusLines,
          { seq: event.seq, text: 'Starting your build' },
        ],
      };

    case 'turn.status':
      return {
        ...state,
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
      return state;

    case 'tool.started':
      return {
        ...state,
        statusLines: [
          ...state.statusLines,
          { seq: event.seq, text: event.payload.summary },
        ],
      };

    case 'tool.finished':
      return {
        ...state,
        statusLines: [
          ...state.statusLines,
          { seq: event.seq, text: event.payload.summary },
        ],
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
        turn: {
          id: event.payload.turnId,
          status: 'failed',
        },
        statusLines: [
          ...state.statusLines,
          { seq: event.seq, text: event.payload.error.message },
        ],
      };

    case 'turn.cancelled':
      return {
        ...state,
        turn: {
          id: event.payload.turnId,
          status: 'cancelled',
        },
        statusLines: [
          ...state.statusLines,
          { seq: event.seq, text: 'Build cancelled' },
        ],
      };
  }
}


export function useProjectEvents(projectId: string | null) {
  const storageStateKey = projectId
  ? `project-${projectId}-event-state`
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

useEffect(() => {
  if (!storageStateKey) {
    return;
  }

  sessionStorage.setItem(
    storageStateKey,
    JSON.stringify(state),
  );
}, [state, storageStateKey]);

  useEffect(() => {
    if (!projectId) return;

    const storageKey = `project-${projectId}-last-seq`;
    const lastSeq = sessionStorage.getItem(storageKey);

    let url = projectEventsUrl(projectId);

    if (lastSeq) {
      url += `?after=${encodeURIComponent(lastSeq)}`;
    }

    const stream = new EventSource(url);

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

        sessionStorage.setItem(
          storageKey,
          String(projectEvent.seq),
        );

        dispatch(projectEvent);
      });
    }

    return () => {
      stream.close();
    };
  }, [projectId]);

  return state;
}