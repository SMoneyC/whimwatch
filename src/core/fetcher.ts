/** Network abstraction so sources run under Electron (real browser) or plain Node. */

export interface HttpResponse {
  status: number;
  /** Final URL after redirects. */
  url: string;
  body: string;
  headers: Record<string, string>;
}

export interface RequestOptions {
  referer?: string;
  accept?: string;
  redirect?: 'follow' | 'manual';
}

export interface Fetcher {
  get(url: string, opts?: RequestOptions): Promise<HttpResponse>;
  head(url: string, opts?: RequestOptions): Promise<HttpResponse>;
  /** Loads a page in a real browser so Cloudflare challenges can complete. */
  browserGet?(url: string): Promise<HttpResponse>;
  /** Runs fetch() inside a loaded page (same origin, its cookies). */
  browserFetch?(pageUrl: string, apiUrl: string): Promise<{ status: number; body: string }>;
}

/** The user cancelled the check or update. */
export class CancelledError extends Error {
  constructor() {
    super('Cancelled');
  }
}

export function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new CancelledError();
}

/** Thrown when a site shows a challenge the hidden browser could not pass. */
export class VerificationRequiredError extends Error {
  constructor(readonly site: string) {
    super(`${site} needs a human verification check`);
  }
}

export class BrowserUnavailableError extends Error {
  constructor(readonly site: string) {
    super(`${site} can only be checked from the desktop app`);
  }
}

export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36';

const CHALLENGE_TITLE = /<title>\s*(?:Just a moment\.\.\.|Attention Required! \| Cloudflare)\s*<\/title>/i;
/**
 * Markers Cloudflare only puts on the challenge itself. The script it adds to
 * ordinary pages (/cdn-cgi/challenge-platform/…/jsd) is deliberately not one of
 * them: Patreon serves that on every page, challenge or not.
 */
const CHALLENGE_MARKER = /window\._cf_chl_opt|id="challenge-(?:form|error-title)"|cf-challenge-running|cf-browser-verification/i;

export function isChallengePage(html: string): boolean {
  return CHALLENGE_TITLE.test(html) || CHALLENGE_MARKER.test(html);
}

/**
 * Serializes requests per host with a minimum gap, so checking many packs
 * never bursts against one site.
 */
export class HostQueue {
  private tails = new Map<string, Promise<unknown>>();
  private generation = 0;
  constructor(private gapMs: (host: string) => number) {}

  /** Requests queued before this call fail with CancelledError instead of running. */
  cancelPending(): void {
    this.generation++;
  }

  run<T>(url: string, task: () => Promise<T>): Promise<T> {
    const host = queueKey(url);
    const prev = this.tails.get(host) ?? Promise.resolve();
    const gap = this.gapMs(host);
    const generation = this.generation;
    const next = prev.then(async () => {
      if (generation !== this.generation) throw new CancelledError();
      let asked = true;
      try {
        return await task();
      } catch (err) {
        // Cancelled, or the site is waiting for a human check: nothing was asked of it, so
        // there's nothing to be polite about, and the rest of a check shouldn't wait for it.
        asked = !(err instanceof CancelledError || err instanceof VerificationRequiredError);
        throw err;
      } finally {
        if (asked) await new Promise((r) => setTimeout(r, gap));
      }
    });
    this.tails.set(host, next.catch(() => undefined));
    return next;
  }
}

/**
 * Requests are spaced per site, not per exact host: loverslab.com and
 * www.loverslab.com share one browser window and one rate limit.
 */
export function queueKey(url: string): string {
  return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
}

export function politeGap(host: string): number {
  if (host.endsWith('loverslab.com') || host.endsWith('patreon.com')) return 3000;
  return 600;
}

/** Plain Node fetcher (CLI, tests). No browser: Cloudflare-protected sources report as unavailable. */
export function createNodeFetcher(queue = new HostQueue(politeGap)): Fetcher {
  const request = (method: 'GET' | 'HEAD') => (url: string, opts: RequestOptions = {}) =>
    queue.run(url, async (): Promise<HttpResponse> => {
      const headers: Record<string, string> = { 'User-Agent': USER_AGENT, Accept: opts.accept ?? 'text/html,*/*' };
      if (opts.referer) headers.Referer = opts.referer;
      const res = await fetch(url, { method, headers, redirect: opts.redirect ?? 'follow' });
      return {
        status: res.status,
        url: res.url || url,
        body: method === 'GET' ? await res.text() : '',
        headers: Object.fromEntries(res.headers.entries()),
      };
    });
  return { get: request('GET'), head: request('HEAD') };
}
