import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('renders the V1 build form', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Describe what you want to build.' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Project title' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Build activity' })).toBeInTheDocument();
  });

  it('requires a title and request before starting a build', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Build activity' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a project title and a request before building.');
  });

  it('creates a project and submits its request', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ project: { id: 'project-1', title: 'Cell division' } }), { status: 201 })).mockResolvedValueOnce(new Response(JSON.stringify({ message: {}, turn: {} }), { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('EventSource', class { addEventListener() {} close() {} readyState = 0; onerror: (() => void) | null = null; });
    render(<App />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Project title' }), { target: { value: 'Cell division' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'What should students learn or do?' }), { target: { value: 'Create a practice quiz.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Build activity' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/projects', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/projects/project-1/messages', expect.objectContaining({ method: 'POST' }));
  });
});
