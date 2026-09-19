/**
 * Small helpers for keeping a view's state in the query string, so a dashboard
 * view or an open email can be shared as a link. Only the named parameter is
 * touched; other parameters on the URL are preserved.
 */

export function readParam(key: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(key);
}

export function writeParam(key: string, value: string | null): void {
  if (typeof window === "undefined") return;

  const params = new URLSearchParams(window.location.search);
  if (value === null) params.delete(key);
  else params.set(key, value);

  const query = params.toString();
  window.history.replaceState(
    null,
    "",
    query ? `${window.location.pathname}?${query}` : window.location.pathname,
  );
}
