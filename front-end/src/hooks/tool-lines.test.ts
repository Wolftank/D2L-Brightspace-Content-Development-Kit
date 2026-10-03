import { expect, it } from 'vitest';
import { initialProjectEventState, projectEventReducer } from './useProjectEvents';

it('keeps concurrent tool calls on their original lines and updates only failures, including replay', () => {
  const events = [
    { seq: 1, kind: 'tool.started' as const, payload: { turnId: 't', callId: 'a', name: 'Read', summary: 'Reading a' } },
    { seq: 2, kind: 'tool.started' as const, payload: { turnId: 't', callId: 'b', name: 'Read', summary: 'Reading b' } },
    { seq: 3, kind: 'tool.finished' as const, payload: { turnId: 't', callId: 'a', ok: true, summary: 'Reading a' } },
    { seq: 4, kind: 'tool.finished' as const, payload: { turnId: 't', callId: 'b', ok: false, summary: 'Failed: Reading b' } },
  ];
  const live = events.reduce(projectEventReducer, initialProjectEventState);
  expect(live.statusLines).toEqual([
    { seq: 1, callId: 'a', text: 'Reading a' },
    { seq: 2, callId: 'b', text: 'Failed: Reading b' },
  ]);
  expect(events.reduce(projectEventReducer, initialProjectEventState)).toEqual(live);
});
