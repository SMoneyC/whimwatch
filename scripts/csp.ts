/**
 * Content Security Policy for the app window, added to index.html as a <meta> tag.
 *
 * The window only runs its own bundled script, stylesheet and fonts. It never fetches anything itself
 * (everything goes through IPC), loads no frames, workers, plugins or media, and submits no forms, so
 * everything else is refused. Styles set from script (element.style) aren't affected by style-src.
 */
import type { Plugin } from 'vite';

export const PRODUCTION_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self'",
  "connect-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "media-src 'none'",
  "manifest-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/**
 * `npm run dev` only: Vite injects an inline script for React fast refresh and inline <style> tags,
 * and talks to its dev server over a WebSocket.
 */
export const DEVELOPMENT_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self' ws://localhost:* ws://127.0.0.1:*",
  "frame-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

export function contentSecurityPolicy(): Plugin {
  return {
    name: 'whimwatch-csp',
    transformIndexHtml: (_html, ctx) => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: ctx.server ? DEVELOPMENT_CSP : PRODUCTION_CSP },
        injectTo: 'head-prepend',
      },
    ],
  };
}
