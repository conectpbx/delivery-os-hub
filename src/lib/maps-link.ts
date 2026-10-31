/** Android can hand this link directly to Maps instead of opening a Chrome tab. */
export function mapsLink(url: string, android: boolean): string {
  if (!android) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "www.google.com" ||
    parsed.port ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/maps/dir/"
  )
    return url;
  return `intent://www.google.com${parsed.pathname}${parsed.search}#Intent;scheme=https;package=com.google.android.apps.maps;S.browser_fallback_url=${encodeURIComponent(parsed.href)};end`;
}
