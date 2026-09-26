/**
 * The HTTP API and event stream contract, transcribed from docs/architecture.md.
 * Shared by the app and by the stub server.
 */

export type Avenue = 'topic' | 'scorm' | 'widget' | 'external';

export interface User {
  id: string;
  displayName: string;
  email: string | null;
  role: string;
}

export interface Project {
  id: string;
  ownerId: string;
  title: string;
  avenue: Avenue | null;
  targetCourse: string | null;
  sessionId: string | null;
  createdAt: number;
  updatedAt: number;
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'file'; fileId: string }
  | { type: 'build_ref'; buildId: string }
  | { type: 'deployment_ref'; deploymentId: string };

export interface Message {
  id: string;
  projectId: string;
  seq: number;
  role: 'instructor' | 'agent';
  content: ContentBlock[];
  turnId: string | null;
  createdAt: number;
}

export type TurnStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface TurnError {
  code: string;
  message: string;
}

export interface TurnUsage {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  steps?: number;
}

export interface Turn {
  id: string;
  projectId: string;
  messageId: string;
  replyId: string | null;
  status: TurnStatus;
  startedAt: number | null;
  finishedAt: number | null;
  error: TurnError | null;
  usage: TurnUsage | null;
}

export type BuildStatus = 'checking' | 'ready' | 'failed';

export interface QaFinding {
  rule: string;
  severity: 'error' | 'warn';
  file: string;
  line: number | null;
  message: string;
  because?: string;
}

export interface QaReport {
  passed: boolean;
  findings: QaFinding[];
}

export interface BuildError {
  code: string;
  message: string;
}

export interface PedagogyReport {
  tilt: unknown[];
  udl: unknown[];
}

export interface Build {
  id: string;
  projectId: string;
  version: number;
  status: BuildStatus;
  avenue: Avenue;
  qa: QaReport | null;
  error: BuildError | null;
  /** Hash of the output the build copied; null while checking and when the copy failed. */
  outputHash: string | null;
  pedagogy: PedagogyReport | null;
  turnId: string | null;
  createdAt: number;
}

export type BuildSummary = Pick<Build, 'id' | 'version' | 'status' | 'createdAt'>;

export type DeploymentStatus = 'requested' | 'confirmed' | 'deploying' | 'verified' | 'failed';

export interface Deployment {
  id: string;
  buildId: string;
  status: DeploymentStatus;
  targetCourse: string;
  location: string | null;
  verification: unknown | null;
  turnId: string | null;
  confirmedAt: number | null;
  createdAt: number;
}

export interface EventPayloads {
  'turn.started': { turnId: string };
  'turn.status': { turnId: string; text: string };
  'message.delta': { turnId: string; messageId: string; text: string };
  'message.completed': { message: Message };
  'tool.started': { turnId: string; callId: string; name: string; summary: string };
  'tool.finished': { turnId: string; callId: string; ok: boolean; summary: string; buildId?: string };
  'build.created': { build: Build };
  'build.updated': { build: Build };
  'deployment.updated': { deployment: Deployment };
  'turn.completed': { turnId: string; usage?: TurnUsage };
  'turn.failed': { turnId: string; error: TurnError };
  'turn.cancelled': { turnId: string };
}

export type EventKind = keyof EventPayloads;

/** One frame of the event stream: `id` is `seq`, `event` is `kind`, `data` is `payload`. */
export type ProjectEvent = {
  [K in EventKind]: { seq: number; kind: K; payload: EventPayloads[K] };
}[EventKind];

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface MeResponse {
  user: User;
  mode: 'local' | 'hosted';
  agent: { name: string; ok: boolean; version?: string; detail?: string };
}

/** V1 creates SCORM projects only; the back end ignores any other field. */
export interface CreateProjectRequest {
  title: string;
  avenue?: 'scorm';
}

export interface CreateProjectResponse {
  project: Project;
}

export interface ProjectResponse {
  project: Project;
  builds: BuildSummary[];
  latestDeployment?: Deployment;
  activeTurn?: Turn;
}

export interface SendMessageRequest {
  content: ContentBlock[];
}

export interface SendMessageResponse {
  message: Message;
  turn: Turn;
}

export interface BuildResponse {
  build: Build;
  deployments: Deployment[];
}
