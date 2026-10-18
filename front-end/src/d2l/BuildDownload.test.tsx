import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { BuildDownload } from './BuildDownload';
import { SCORM_GUIDE_TEXT, SCORM_LINKS } from './scormGuide';

const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
    this.querySelector('button')?.focus();
  } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  } });
});
afterEach(() => {
  for (const [name, original] of [['showModal', originalShow], ['close', originalClose]] as const) {
    if (original) Object.defineProperty(HTMLDialogElement.prototype, name, original);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
});

it('keeps the package URL, opens instructions, closes and restores focus, and reopens', () => {
  render(<BuildDownload build={{ id: 'b1', version: 3, avenue: 'scorm' }} />);
  const download = screen.getByRole('link', { name: 'Download SCORM package' });
  download.addEventListener('click', event => event.preventDefault());
  expect(download).toHaveAttribute('href', '/api/builds/b1/download');
  fireEvent.click(download);
  const guide = screen.getByRole('dialog', { name: 'Add to D2L' });
  expect(within(guide).getByText(/SCORM ZIP from build 3/)).toBeVisible();
  expect(within(guide).getAllByRole('heading', { level: 3 })).toHaveLength(5);
  expect(within(guide).getByRole('heading', { name: 'Add to D2L', level: 2 })).toHaveFocus();
  fireEvent.click(within(guide).getByRole('button', { name: 'Close instructions' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(download).toHaveFocus();
  const reopen = screen.getByRole('button', { name: 'Add to D2L instructions' });
  fireEvent.click(reopen);
  fireEvent.click(screen.getByRole('button', { name: 'Close instructions' }));
  expect(reopen).toHaveFocus();
});

it('provides the same ordered steps and help destinations in deploy.txt', () => {
  render(<BuildDownload build={{ id: 'b1', version: 1, avenue: 'scorm' }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Add to D2L instructions' }));
  const save = screen.getByRole('link', { name: 'Save instructions as text' });
  expect(save).toHaveAttribute('download', 'deploy.txt');
  expect(decodeURIComponent(save.getAttribute('href')!.split(',')[1]!)).toBe(SCORM_GUIDE_TEXT);
  for (const link of SCORM_LINKS) expect(screen.getByRole('link', { name: new RegExp(link.label) })).toHaveAttribute('href', link.url);
  expect(SCORM_GUIDE_TEXT).toContain('enrolled test-student');
});

it('leaves modified download clicks alone and avoids SCORM instructions for other formats', () => {
  const view = render(<BuildDownload build={{ id: 'b1', version: 1, avenue: 'scorm' }} />);
  const download = screen.getByRole('link', { name: 'Download SCORM package' });
  download.addEventListener('click', event => event.preventDefault());
  fireEvent.click(download, { ctrlKey: true });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  view.rerender(<BuildDownload build={{ id: 'b2', version: 2, avenue: 'topic' }} />);
  expect(screen.getByRole('link', { name: 'Download package' })).toHaveAttribute('href', '/api/builds/b2/download');
  expect(screen.queryByRole('button', { name: 'Add to D2L instructions' })).not.toBeInTheDocument();
});
