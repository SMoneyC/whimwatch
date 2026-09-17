import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { API_METHODS, type WhimWatchApi } from '../shared/api.js';
import type { AppController } from './controller.js';
import type { Updater } from './updater.js';
import { isGameRunning } from '../core/process.js';

type Handlers = { [K in (typeof API_METHODS)[number]]: (...args: unknown[]) => ReturnType<WhimWatchApi[K]> };

export function registerIpc(controller: AppController, updater: Updater, isTrustedUrl: (url: string) => boolean): void {
  const handlers: Handlers = {
    getSnapshot: () => controller.snapshot(),
    detectModsDirs: () => controller.detectModsDirs(),
    chooseDirectory: () => controller.chooseDirectory(),
    setDirs: (dirs) => controller.setDirs(dirs),
    updateSettings: (patch) => controller.updateSettings(patch),
    // Checks take minutes; progress arrives as events, so don't hold the call open.
    startCheck: async () => void controller.startCheck(),
    cancelCheck: async () => controller.cancelCheck(),
    dismiss: (key, at) => controller.dismiss(key, at),
    undismiss: (key) => controller.undismiss(key),
    dismissAll: () => controller.dismissAll(),
    undoSeen: (id) => controller.undoSeen(id),
    dismissFirstCheckNotice: () => controller.dismissFirstCheckNotice(),
    dismissAppUpdate: (version) => controller.dismissAppUpdate(version),
    markSeen: (key, listingUrl) => controller.markSeen(typeof key === 'string' ? key : '', typeof listingUrl === 'string' ? listingUrl : undefined),
    dismissGameWarning: (id) => controller.dismissGameWarning(id),
    addLink: (key, url) => controller.addLink(key, url),
    rejectLink: (key, url) => controller.rejectLink(key, url),
    undoRejectLink: (key, url) => controller.undoRejectLink(key, url),
    resetLinks: (key) => controller.resetLinks(key),
    setCreatorSite: (key, site, on) => controller.setCreatorSite(key, site, on),
    openExternal: (url) => controller.openExternal(url),
    showLinkMenu: (url) => controller.showLinkMenu(url),
    openBackupFolder: (id) => controller.openBackupFolder(id),
    showFile: (path) => controller.showFile(path),
    listOtherFiles: () => controller.listOtherFiles(),
    showVerification: (site) => controller.showVerification(site),
    dismissVerification: (site) => controller.dismissVerification(site),
    signIn: (site) => controller.signIn(site),
    signOut: (site) => controller.signOut(site),
    planUpdate: (key, listingUrl) => updater.plan(key, listingUrl),
    applyUpdate: (planId, choice) => updater.apply(planId, choice),
    undoInstall: (id) => updater.undo(id),
    undoBatch: (batchId) => updater.undoBatch(batchId),
    isGameRunning: () => isGameRunning(),
    isWindowFocused: async () => controller.isWindowFocused(),
    previewDirs: (dirs) => controller.previewDirs(dirs),
    // Returns once started; progress arrives as 'batch' events.
    updateAll: async (keys) =>
      void updater.updateAll(keys).catch((err: Error) => controller.emit({ type: 'error', message: err.message })),
    stopUpdateAll: async () => updater.stopUpdateAll(),
    cancelUpdate: (key) => updater.cancel(key),
    cancelUpdateAll: async () => updater.cancelUpdateAll(),
    getStorage: () => updater.storage(),
    getDiagnostics: () => controller.getDiagnostics(),
    copyDiagnostics: async () => controller.copyDiagnostics(),
    saveDiagnostics: () => controller.saveDiagnostics(),
    getLicenses: () => controller.getLicenses(),
    removeAllData: () => controller.removeAllData(updater),
    clearBackups: () => controller.clearBackups(),
    clearCaches: () => updater.clearCaches(),
  };

  for (const method of API_METHODS) {
    ipcMain.handle(`whimwatch:${method}`, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      const url = event.senderFrame?.url ?? '';
      if (!isTrustedUrl(url)) throw new Error('Untrusted sender');
      return handlers[method](...args);
    });
  }
}
