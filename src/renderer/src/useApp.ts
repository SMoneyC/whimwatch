import { useCallback, useEffect, useState } from 'react';
import type { AppSnapshot, BatchState, BrowserSite, UpdateProgress } from '../../shared/api';
import type { CheckProgress, CreatorResult } from '../../shared/types';

export const api = window.whimwatch;

export interface AppModel {
  snapshot?: AppSnapshot;
  progress?: CheckProgress;
  /** Creators finished during the running check, by key. */
  live: Record<string, CreatorResult>;
  verificationNeeded: BrowserSite[];
  updates: Record<string, UpdateProgress>;
  batch?: BatchState;
  error?: string;
  setError(message?: string): void;
  run<T>(action: () => Promise<T>): Promise<T | undefined>;
  clearVerification(site: BrowserSite): void;
}

export function useApp(): AppModel {
  const [snapshot, setSnapshot] = useState<AppSnapshot>();
  const [progress, setProgress] = useState<CheckProgress>();
  const [live, setLive] = useState<Record<string, CreatorResult>>({});
  const [verificationNeeded, setVerificationNeeded] = useState<BrowserSite[]>([]);
  const [updates, setUpdates] = useState<Record<string, UpdateProgress>>({});
  const [batch, setBatch] = useState<BatchState>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    void api.getSnapshot().then((s) => {
      setSnapshot(s);
      setBatch(s.batch);
      if (s.running) setProgress(s.progress);
    });
    return api.onEvent((event) => {
      switch (event.type) {
        case 'snapshot':
          setSnapshot(event.snapshot);
          if (!event.snapshot.running) {
            setProgress(undefined);
            setLive({});
          }
          break;
        case 'progress':
          setProgress(event.progress);
          if (event.progress.phase === 'scan' && event.progress.done === 0) setLive({});
          break;
        case 'creator':
          setLive((prev) => ({ ...prev, [event.creator.key]: event.creator }));
          break;
        case 'verification-needed':
          setVerificationNeeded((prev) => (prev.includes(event.site) ? prev : [...prev, event.site]));
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
    setVerificationNeeded((prev) => prev.filter((s) => s !== site));
  }, []);

  return { snapshot, progress, live, verificationNeeded, updates, batch, error, setError, run, clearVerification };
}
