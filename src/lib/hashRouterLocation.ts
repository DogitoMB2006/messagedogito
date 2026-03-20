/**
 * HashRouter keeps the route in `location.hash` (e.g. `#/notifications`, `#/?id=uuid`).
 * `window.location.pathname` / `search` are usually wrong for in-app navigation.
 */
export function getHashPathname(): string {
  const raw = (window.location.hash || '#/').replace(/^#/, '') || '/';
  const q = raw.indexOf('?');
  const path = (q >= 0 ? raw.slice(0, q) : raw) || '/';
  return path.startsWith('/') ? path : `/${path}`;
}
