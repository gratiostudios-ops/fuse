import { connectionFor, googleClient } from './organizer-google.ts';
import { HttpError, isObject, validTimezone, type Store } from './organizer-server.ts';
import { mapTask, mapEvent } from './organizer-domain.ts';
import { parseFuseResponse, type Block } from './contract.ts';

// The model supplies only parameters. Identity, credentials and Google requests
// belong to the authenticated organizer endpoint.
export const createActionSchema = {
  anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false,
    required: ['kind', 'title', 'description', 'due_date', 'start', 'end', 'all_day'],
    properties: {
      kind: { type: 'string', enum: ['task', 'schedule'] },
      title: { type: 'string' }, description: { type: ['string', 'null'] },
      due_date: { type: ['string', 'null'] }, start: { type: ['string', 'null'] },
      end: { type: ['string', 'null'] }, all_day: { type: 'boolean' },
    },
  }],
};
const date = (value: unknown): value is string => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString().slice(0, 10) === value;
const timestamp = (value: unknown): value is string => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  && date(value.slice(0, 10)) && Number.isFinite(Date.parse(value));

export function validateCreateParams(value: unknown) {
  if (!isObject(value) || Object.keys(value).some(key => !['kind', 'title', 'description', 'due_date', 'start', 'end', 'all_day'].includes(key))) throw new HttpError(400, 'Invalid creation parameters');
  if (!['task', 'schedule'].includes(value.kind) || typeof value.title !== 'string'
    || !value.title.trim() || value.title.length > 1024) throw new HttpError(400, 'Provide a task or event title');
  if (value.description != null && (typeof value.description !== 'string' || value.description.length > 8192)) throw new HttpError(400, 'Invalid description');
  if (typeof value.all_day !== 'boolean') throw new HttpError(400, 'Specify whether the event is all-day');
  if (value.kind === 'task') {
    if (value.due_date != null && !date(value.due_date)) throw new HttpError(400, 'Task due date must be YYYY-MM-DD');
    if (value.start != null || value.end != null || value.all_day) throw new HttpError(400, 'Tasks have a due date, not a scheduled time. Use a Calendar event for a time slot.');
  } else {
    if (value.due_date != null) throw new HttpError(400, 'Calendar events use start and end, not a task due date');
    const valid = value.all_day ? date : timestamp;
    if (!valid(value.start) || !valid(value.end) || Date.parse(value.end) <= Date.parse(value.start)) throw new HttpError(400, value.all_day ? 'Provide all-day start and exclusive end dates' : 'Provide start and end timestamps with timezone offsets; end must follow start');
  }
  return { kind: value.kind as 'task' | 'schedule', title: value.title.trim(), description: value.description ?? null,
    due_date: value.due_date ?? null, start: value.start ?? null, end: value.end ?? null, all_day: value.all_day };
}

export async function createGoogleActivity(db: Store, userId: string, value: unknown, timezone: unknown) {
  const params = validateCreateParams(value), zone = validTimezone(timezone);
  const connection = await connectionFor(db, userId);
  if (!connection) throw new HttpError(401, 'Connect Google Calendar first');
  const google = await googleClient(db, connection);
  let block: Block;
  if (params.kind === 'task') {
    const lists = await google('tasks/v1/users/@me/lists?maxResults=1');
    const listId = lists.items?.[0]?.id;
    if (typeof listId !== 'string' || !listId) throw new HttpError(409, 'Create a Google task list first');
    // https://developers.google.com/workspace/tasks/reference/rest/v1/tasks/insert
    const saved = await google(`tasks/v1/lists/${encodeURIComponent(listId)}/tasks`, 'POST', {
      title: params.title, ...(params.description ? { notes: params.description } : {}),
      ...(params.due_date ? { due: `${params.due_date}T00:00:00.000Z` } : {}),
    });
    if (typeof saved?.id !== 'string' || !saved.id) throw new HttpError(502, 'Google did not confirm task creation. Check Google Tasks before retrying.');
    const task = mapTask(saved, listId);
    block = { type: 'task', data: { id: task.id, title: task.title, due_date: task.due_date, due_time: null, is_completed: task.mark_completed } };
  } else {
    // https://developers.google.com/workspace/calendar/api/v3/reference/events/insert
    const saved = await google('calendar/v3/calendars/primary/events', 'POST', {
      summary: params.title, ...(params.description ? { description: params.description } : {}),
      start: params.all_day ? { date: params.start } : { dateTime: params.start, timeZone: zone },
      end: params.all_day ? { date: params.end } : { dateTime: params.end, timeZone: zone },
    });
    if (typeof saved?.id !== 'string' || !saved.id) throw new HttpError(502, 'Google did not confirm event creation. Check Google Calendar before retrying.');
    const event = mapEvent(saved, zone);
    block = { type: 'schedule', data: { id: event.id, title: event.title, start: event.valid_from!, end: event.valid_to!,
      is_completed: event.mark_completed, is_all_day: event.is_all_day, start_date: event.start_date, end_date: event.end_date } };
  }
  const response = parseFuseResponse({ schema_version: 1, message: params.kind === 'task' ? `Created task “${block.data.title}”.` : `Scheduled “${block.data.title}”.`, blocks: [block] });
  return { ...response, activity_changed: true };
}
