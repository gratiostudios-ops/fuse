import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { initializeRefreshRuntime } from '../refresh/runtime';

export const REFRESH_TASK_NAME = 'fuse-background-refresh';

// Registered at module scope through index.ts, including headless app launches.
if (!TaskManager.isTaskDefined(REFRESH_TASK_NAME)) {
  TaskManager.defineTask(REFRESH_TASK_NAME, async ({ error }) => {
    if (error) return BackgroundTask.BackgroundTaskResult.Failed;
    try {
      const result = await initializeRefreshRuntime().run();
      return result.status === 'failed' || result.status === 'partial'
        ? BackgroundTask.BackgroundTaskResult.Failed
        : BackgroundTask.BackgroundTaskResult.Success;
    } catch { return BackgroundTask.BackgroundTaskResult.Failed; }
  });
}

export async function registerBackgroundRefresh(): Promise<'registered' | 'unavailable'> {
  if (!await TaskManager.isAvailableAsync() || await BackgroundTask.getStatusAsync() !== BackgroundTask.BackgroundTaskStatus.Available) return 'unavailable';
  if (!await TaskManager.isTaskRegisteredAsync(REFRESH_TASK_NAME)) {
    await BackgroundTask.registerTaskAsync(REFRESH_TASK_NAME, { minimumInterval: 30 });
  }
  return 'registered';
}
