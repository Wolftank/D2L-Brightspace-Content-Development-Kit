import { expect, it } from 'vitest';
import { initialProjectEventState, projectEventReducer } from './useProjectEvents';

it('keeps concurrent tool calls on their original lines and updates only failures, including replay', () => {
  const events = [
    { seq: 1, kind: 'tool.started' as const, payload: { turnId: 't', callId: 'a', name: 'Read', summary: 'Reading a', category: 'reading' as const } },
    { seq: 2, kind: 'tool.started' as const, payload: { turnId: 't', callId: 'b', name: 'Read', summary: 'Reading b', category: 'reading' as const } },
    { seq: 3, kind: 'tool.finished' as const, payload: { turnId: 't', callId: 'a', ok: true, summary: 'Reading a', category: 'reading' as const } },
    { seq: 4, kind: 'tool.finished' as const, payload: { turnId: 't', callId: 'b', ok: false, summary: 'Failed: Reading b', category: 'reading' as const } },
  ];
  const live = events.reduce(projectEventReducer, initialProjectEventState);
  expect(live.statusLines).toEqual([
    { seq: 1, callId: 'a', text: 'Reading a', category: 'reading' },
    { seq: 2, callId: 'b', text: 'Failed: Reading b', category: 'reading', failed: true },
  ]);
  expect(events.reduce(projectEventReducer, initialProjectEventState)).toEqual(live);
});
