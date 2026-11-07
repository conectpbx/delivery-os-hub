/** Bounded, in-memory LRU with single-flight requests. Failures and missing results are not retained. */
export function createAsyncCache<T>(maxEntries = 128, ttlMs = 15 * 60_000, now = Date.now) {
  const values = new Map<string, { value: T; until: number }>();
  const pending = new Map<string, Promise<T>>();
  return {
    get(key: string, load: () => Promise<T>): Promise<T> {
      const hit = values.get(key);
      if (hit && hit.until > now()) {
        values.delete(key);
        values.set(key, hit);
        return Promise.resolve(hit.value);
      }
      values.delete(key);
      const running = pending.get(key);
      if (running) return running;
      if (pending.size >= maxEntries)
        return Promise.reject(
          new Error("Muitas consultas de localização. Aguarde as consultas atuais."),
        );
      const request = Promise.resolve()
        .then(load)
        .then((value) => {
          if (value !== null && value !== undefined) {
            values.set(key, { value, until: now() + ttlMs });
            while (values.size > maxEntries) values.delete(values.keys().next().value!);
          }
          return value;
        })
        .finally(() => pending.delete(key));
      pending.set(key, request);
      return request;
    },
    clear() {
      values.clear();
    },
  };
}
