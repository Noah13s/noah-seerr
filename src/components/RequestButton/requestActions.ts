/** Finish every request before refreshing, including a partially failed batch. */
export async function updateRequestBatch(
  ids: number[],
  decision: 'approve' | 'decline',
  change: (id: number, decision: 'approve' | 'decline') => Promise<unknown>,
  refresh: () => Promise<unknown>
): Promise<void> {
  if (!ids.length) return;
  const results = await Promise.allSettled(
    ids.map((id) => Promise.resolve().then(() => change(id, decision)))
  );
  await refresh();
  const failures = results.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected'
  );
  if (failures.length) {
    throw new AggregateError(
      failures.map((failure) => failure.reason),
      `${failures.length} request changes failed`
    );
  }
}
