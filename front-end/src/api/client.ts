import type {
  ApiErrorBody,
  BuildResponse,
  CreateProjectRequest,
  CreateProjectResponse,
  ProjectResponse,
  SendMessageRequest,
  SendMessageResponse,
} from './types';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
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
    const body = await response.json().catch(() => null) as ApiErrorBody | null;
    const error = body?.error;
    throw new ApiError(error?.code ?? 'request_failed', error?.message ?? 'The request could not be completed.', error?.details);
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
