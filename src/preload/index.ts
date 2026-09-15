import { contextBridge, ipcRenderer } from 'electron';
import { API_METHODS, type AppEvent, EVENT_CHANNEL, type WhimWatchApi } from '../shared/api.js';

const api = Object.fromEntries(
  API_METHODS.map((method) => [method, (...args: unknown[]) => ipcRenderer.invoke(`whimwatch:${method}`, ...args)]),
) as Omit<WhimWatchApi, 'onEvent'>;

const exposed: WhimWatchApi = {
  ...api,
  onEvent(listener) {
    const handler = (_: unknown, event: AppEvent): void => listener(event);
    ipcRenderer.on(EVENT_CHANNEL, handler);
    return () => ipcRenderer.off(EVENT_CHANNEL, handler);
  },
};

contextBridge.exposeInMainWorld('whimwatch', exposed);
