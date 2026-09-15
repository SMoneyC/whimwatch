import type { WhimWatchApi } from '../shared/api';

declare global {
  interface Window {
    whimwatch: WhimWatchApi;
  }
}

export {};
