import { describe, expect, it } from 'vitest';
import { parseAssistantActions } from './assistantActionParser';

describe('parseAssistantActions', () => {
  it('parses a whole-message goto JSON action', () => {
    const res = parseAssistantActions('{"action":"goto","screen_name":"tasks"}');
    expect(res.actions).toEqual([{ kind: 'goto', screenName: 'tasks' }]);
    expect(res.cleanText).toBe('');
  });

  it('parses embedded list_records action and strips it from text', () => {
    const res = parseAssistantActions(
      'Here you go.\n\n{"action":"list_records","table_id":"Customers"}\n\nRunning now.',
    );
    expect(res.actions).toEqual([{ kind: 'list_records', request: 'Customers' }]);
    expect(res.cleanText).toContain('Here you go.');
    expect(res.cleanText).toContain('Running now.');
    expect(res.cleanText).not.toContain('list_records');
  });

  it('parses decompose_task with subtasks array', () => {
    const res = parseAssistantActions(
      JSON.stringify({
        action: 'decompose_task',
        subtasks: [
          { title: 'A', description: 'Do A', suggestedAgent: 'taskManager' },
          { title: 'B' },
        ],
      }),
    );
    expect(res.actions.length).toBe(1);
    expect(res.actions[0].kind).toBe('decompose_task');
    if (res.actions[0].kind === 'decompose_task') {
      expect(res.actions[0].subtasks.length).toBe(2);
      expect(res.actions[0].subtasks[0].suggestedAgent).toBe('taskManager');
    }
  });

  it('accepts fenced JSON', () => {
    const res = parseAssistantActions('```json\n{"action":"search","request":"foo"}\n```');
    expect(res.actions).toEqual([{ kind: 'search', request: 'foo' }]);
  });
});

