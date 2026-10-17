import type {
  BuildResponse,
  CreateProjectRequest,
  CreateProjectResponse,
  MessageHistoryResponse,
  ProjectResponse,
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

async function json<T>(url: string, init: RequestInit = {}): Promise<T> {
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
  return response.json() as Promise<T>;
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

