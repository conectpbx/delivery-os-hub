/** Chaves públicas opacas vão em apikey; a sessão do usuário continua em Authorization. */
export function publicSupabaseFetch(key: string, fetcher: typeof fetch = fetch): typeof fetch {
  return (input, init) => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    if (init?.headers) new Headers(init.headers).forEach((value, name) => headers.set(name, value));
    if (key.startsWith("sb_publishable_") && headers.get("Authorization") === `Bearer ${key}`) {
      headers.delete("Authorization");
    }
    headers.set("apikey", key);
    return fetcher(input, { ...init, headers });
  };
}
