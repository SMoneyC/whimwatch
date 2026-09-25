import { useCallback, useEffect, useState } from 'react';
import type { AppSnapshot, BatchState, BrowserSite, UpdateProgress } from '../../shared/api';
import { getLocale, LOCALE_INFO, setLocale } from '../../shared/i18n';
import type { CheckProgress, CreatorResult } from '../../shared/types';

export const api = window.whimwatch;

/** Before the snapshot renders: its text is read from t() while rendering, in the language it names. */
function applyLocale(snapshot: AppSnapshot): void {
  setLocale(snapshot.locale);
  // Screen readers pick their voice by it, and it's what the page is written in.
  document.documentElement.lang = LOCALE_INFO[getLocale()].intl;
}

export interface AppModel {
  snapshot?: AppSnapshot;
  progress?: CheckProgress;
  /** Creators finished during the running check, by key. */
  live: Record<string, CreatorResult>;
  /** Sites asking for a human check, and ones the user has just passed, until the next check. */
  verification: Partial<Record<BrowserSite, 'needed' | 'passed'>>;
  updates: Record<string, UpdateProgress>;
  batch?: BatchState;
  error?: string;
  setError(message?: string): void;
  run<T>(action: () => Promise<T>): Promise<T | undefined>;
  clearVerification(site: BrowserSite): void;
}

export type VerificationState = AppModel['verification'];

export function useApp(): AppModel {
  const [snapshot, setSnapshot] = useState<AppSnapshot>();
  const [progress, setProgress] = useState<CheckProgress>();
  const [live, setLive] = useState<Record<string, CreatorResult>>({});
  const [verification, setVerification] = useState<VerificationState>({});
  const [updates, setUpdates] = useState<Record<string, UpdateProgress>>({});
  const [batch, setBatch] = useState<BatchState>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    void api.getSnapshot().then((s) => {
      applyLocale(s);
      setSnapshot(s);
      setBatch(s.batch);
      if (s.running) setProgress(s.progress);
    });
    return api.onEvent((event) => {
      switch (event.type) {
        case 'snapshot':
          applyLocale(event.snapshot);
          setSnapshot(event.snapshot);
          if (!event.snapshot.running) {
            setProgress(undefined);
            setLive({});
          }
          break;
        case 'progress':
          setProgress(event.progress);
          if (event.progress.phase === 'scan' && event.progress.done === 0) {
            setLive({});
            // A new check tries the sites again, so last check's verification notes are done with.
            setVerification({});
          }
          break;
        case 'creator':
          setLive((prev) => ({ ...prev, [event.creator.key]: event.creator }));
          break;
        case 'verification-needed':
          setVerification((prev) => ({ ...prev, [event.site]: 'needed' }));
          break;
        case 'verification-passed':
          setVerification((prev) => ({ ...prev, [event.site]: 'passed' }));
          break;
        case 'update-progress':
          setUpdates((prev) => ({ ...prev, [event.progress.creatorKey]: event.progress }));
          break;
        case 'batch':
          setBatch(event.batch);
          break;
        case 'error':
          setError(event.message);
          break;
      }
    });
  }, []);

  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    try {
      setError(undefined);
      return await action();
    } catch (err) {
      // Errors thrown in the main process arrive as "Error invoking remote method '…': Error: message".
      setError(String((err as Error).message ?? err).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''));
      return undefined;
    }
  }, []);

  const clearVerification = useCallback((site: BrowserSite) => {
    setVerification((prev) => {
      // Waving away a site still waiting for its check: it stays held back either way, so let the
      // main process say so again the next time a page of that site is turned away.
      if (prev[site] === 'needed') void api.dismissVerification(site);
      const next = { ...prev };
      delete next[site];
      return next;
    });
  }, []);

  return { snapshot, progress, live, verification, updates, batch, error, setError, run, clearVerification };
}
