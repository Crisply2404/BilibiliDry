/** Run `worker` over `items` with at most `limit` in flight, preserving the given order of starts. */
export async function runPool<T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>, signal?: AbortSignal): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      if (signal?.aborted) return;
      const i = next;
      next += 1;
      await worker(items[i], i);
    }
  });
  await Promise.all(lanes);
}
