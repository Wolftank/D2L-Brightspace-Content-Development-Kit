import type {
  BuildResponse,
  CreateProjectRequest,
  CreateProjectResponse,
  MeResponse,
  MessageHistoryResponse,
  ProjectResponse,
  ProjectListResponse,
  SendMessageRequest,
  SendMessageResponse,
} from '@cdk/contract';

import { readFailure } from './failure';
import type { NextStep } from '@cdk/contract';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly nextStep: NextStep = 'try_later',
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request(url: string, init: RequestInit = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new ApiError('network_error', 'Unable to reach the service.');
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const failure = readFailure(body?.error);
    throw new ApiError(body?.error?.code ?? 'request_failed', failure.message, undefined, failure.nextStep);
  }
  return response;
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  return (await request(url, init)).json() as Promise<T>;
}

export function getMe(): Promise<MeResponse> {
  return json('/api/me');
}

export async function startAgentSignIn(): Promise<void> {
  await request('/api/agent/sign-in', { method: 'POST' });
}

export async function cancelTurn(turnId: string): Promise<void> {
  await request('/api/turns/' + encodeURIComponent(turnId) + '/cancel', { method: 'POST' });
}

export function createProject(input: CreateProjectRequest): Promise<CreateProjectResponse> {
  return json('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
}

export function getProject(projectId: string): Promise<ProjectResponse> {
  return json(`/api/projects/${projectId}`);
}

export function sendMessage(projectId: string, input: SendMessageRequest): Promise<SendMessageResponse> {
  return json(`/api/projects/${projectId}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
}

export function getBuild(buildId: string): Promise<BuildResponse> {
  return json(`/api/builds/${buildId}`);
}

export function projectEventsUrl(projectId: string): string {
  return `/api/projects/${projectId}/events`;
}

export function buildDownloadUrl(buildId: string): string {
  return `/api/builds/${buildId}/download`;
}

export function getMessages(projectId: string, cursor?: string): Promise<MessageHistoryResponse> {
  const query = cursor ? '?cursor=' + encodeURIComponent(cursor) : '';
  return json('/api/projects/' + projectId + '/messages' + query);
}


export function listProjects(): Promise<ProjectListResponse> {
  return json('/api/projects');
}
