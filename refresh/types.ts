import type { Schedule, Suggestion, Task } from '../api/types';

export type SourceStatus = 'ok' | 'partial' | 'error' | 'authentication-required' | 'skipped' | 'not-implemented' | 'no-topics';
export type SourceResult<T> = {
  status: SourceStatus;
  data: T[];
  error?: string;
  failedTopicIds?: string[];
};

export type RefreshSnapshot = {
  userId: string | null;
  collectedAt: string;
  topicIds: string[];
  tasks: SourceResult<Task>;
  schedules: SourceResult<Schedule>;
  suggestions: SourceResult<Suggestion>;
};

export type ProcessingResult =
  | { status: 'not-configured' }
  | { status: 'completed' }
  | { status: 'error'; error: string };

export type CachedRefresh = {
  version: 1;
  completedAt: string;
  snapshot: RefreshSnapshot;
  processing: ProcessingResult;
};

export type RefreshRunResult = {
  status: 'completed' | 'partial' | 'skipped' | 'discarded' | 'failed';
  reason?: string;
  record?: CachedRefresh;
};
