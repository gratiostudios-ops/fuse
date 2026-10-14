/** AbortSignal.throwIfAborted is missing from some React Native runtimes. */
export function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  throw error;
}
