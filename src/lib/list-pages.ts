/** Read complete history without relying on the API's default row cap. */
export async function loadAllPages<T>(
  load: (from: number, to: number) => PromiseLike<T[]>,
  signal?: AbortSignal,
  pageSize = 500,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    signal?.throwIfAborted();
    const page = await load(from, from + pageSize - 1);
    signal?.throwIfAborted();
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}
