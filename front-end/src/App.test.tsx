import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

class MockEventSource {
  static instance: MockEventSource | null = null;

  private listeners = new Map<
    string,
    (event: MessageEvent<string>) => void
  >();

  readyState = 1;
  onerror: (() => void) | null = null;

  constructor(_url: string) {
    MockEventSource.instance = this;
  }

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ) {
    if (typeof listener === 'function') {
      this.listeners.set(
        type,
        listener as (event: MessageEvent<string>) => void,
      );
    }
  }

  emit(type: string, seq: number, data: unknown) {
    const listener = this.listeners.get(type);

    listener?.({
      data: JSON.stringify(data),
      lastEventId: String(seq),
    } as MessageEvent<string>);
  }

  close() {}
}

describe('App', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.unstubAllGlobals();
    MockEventSource.instance = null;
  });

  it('renders the V1 build form', () => {
    render(<App />);

    expect(
      screen.getByRole('heading', {
        name: 'Describe what you want to build.',
      }),
    ).toBeInTheDocument();

    expect(
      screen.getByRole('textbox', {
        name: 'Project title',
      }),
    ).toBeInTheDocument();

    expect(
      screen.getByRole('button', {
        name: 'Build activity',
      }),
    ).toBeInTheDocument();
  });

  it('requires a title and request before starting a build', () => {
    render(<App />);

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Build activity',
      }),
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter a project title and a request before building.',
    );
  });

  it('creates a project and submits its request', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            project: {
              id: 'project-1',
              title: 'Cell division',
            },
          }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            message: {},
            turn: {},
          }),
          { status: 202 },
        ),
      );

    vi.stubGlobal('fetch', fetchMock);

    vi.stubGlobal(
      'EventSource',
      class {
        addEventListener() {}
        close() {}
        readyState = 0;
        onerror: (() => void) | null = null;
      },
    );

    render(<App />);

    fireEvent.change(
      screen.getByRole('textbox', {
        name: 'Project title',
      }),
      {
        target: {
          value: 'Cell division',
        },
      },
    );

    fireEvent.change(
      screen.getByRole('textbox', {
        name: 'What should students learn or do?',
      }),
      {
        target: {
          value: 'Create a practice quiz.',
        },
      },
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Build activity',
      }),
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/projects',
      expect.objectContaining({
        method: 'POST',
      }),
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/projects/project-1/messages',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  it('renders a download link when a build is ready', async () => {
  sessionStorage.setItem(
    'active-project',
    JSON.stringify({
      id: 'project-1',
      title: 'Cell division',
    }),
  );

  vi.stubGlobal('EventSource', MockEventSource);

  render(<App />);

  await waitFor(() => {
    expect(MockEventSource.instance).not.toBeNull();
  });

  act(() => {
    MockEventSource.instance?.emit(
      'build.updated',
      1,
      {
        build: {
          id: 'build-1',
          projectId: 'project-1',
          version: 1,
          status: 'ready',
          avenue: 'scorm',
          qa: {
            passed: true,
            findings: [],
          },
          error: null,
          outputHash: 'hash-1',
          pedagogy: null,
          turnId: 'turn-1',
          createdAt: 1,
        },
      },
    );
  });

  const downloadLink = await screen.findByRole('link', {
    name: 'Download SCORM package',
  });

  expect(downloadLink).toHaveAttribute(
    'href',
    '/api/builds/build-1/download',
  );

  expect(
    screen.getByText('The QA gate passed.'),
  ).toBeInTheDocument();
});

it('renders QA findings and no download link when a build fails', async () => {
  sessionStorage.setItem(
    'active-project',
    JSON.stringify({
      id: 'project-1',
      title: 'Cell division',
    }),
  );

  vi.stubGlobal('EventSource', MockEventSource);

  render(<App />);

  await waitFor(() => {
    expect(MockEventSource.instance).not.toBeNull();
  });

  act(() => {
    MockEventSource.instance?.emit(
      'build.updated',
      2,
      {
        build: {
          id: 'build-2',
          projectId: 'project-1',
          version: 2,
          status: 'failed',
          avenue: 'scorm',
          qa: {
            passed: false,
            findings: [
              {
                rule: 'image-alt',
                severity: 'error',
                file: 'index.html',
                line: 42,
                message: 'Image is missing alternative text.',
              },
            ],
          },
          error: null,
          outputHash: null,
          pedagogy: null,
          turnId: 'turn-2',
          createdAt: 2,
        },
      },
    );
  });

  expect(
    await screen.findByText('QA needs attention'),
  ).toBeInTheDocument();

  expect(
    screen.getByText('image-alt'),
  ).toBeInTheDocument();

  expect(
    screen.getByText('ERROR'),
  ).toBeInTheDocument();

  expect(
    screen.getByText('index.html:42'),
  ).toBeInTheDocument();

  expect(
    screen.getByText('Image is missing alternative text.'),
  ).toBeInTheDocument();

  expect(
    screen.queryByRole('link', {
      name: 'Download SCORM package',
    }),
  ).not.toBeInTheDocument();
});

  it('renders an API error message when the build request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 'turn_active',
              message: 'A turn is already active for this project',
            },
          }),
          { status: 409 },
        ),
      ),
    );

    render(<App />);

    fireEvent.change(
      screen.getByRole('textbox', {
        name: 'Project title',
      }),
      {
        target: {
          value: 'Cell division',
        },
      },
    );

    fireEvent.change(
      screen.getByRole('textbox', {
        name: 'What should students learn or do?',
      }),
      {
        target: {
          value: 'Create a practice quiz.',
        },
      },
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Build activity',
      }),
    );

    expect(
      await screen.findByRole('alert'),
    ).toHaveTextContent(
      'A turn is already active for this project',
    );
  });
});