/**
 * Whether the LoversLab/Patreon browsers keep their data on disk or only in
 * memory. It can change while the app runs only until a page, sign-in or
 * download has used a session: after that, switching would silently drop (or
 * strand) what that session holds, so the change waits for the next launch.
 */
export class SiteSessionMode {
  private persistent = true;
  private used = false;

  get persist(): boolean {
    return this.persistent;
  }

  get inUse(): boolean {
    return this.used;
  }

  markUsed(): void {
    this.used = true;
  }

  /** Returns whether the sessions now match `persist`. */
  trySet(persist: boolean): boolean {
    if (persist === this.persistent) return true;
    if (this.used) return false;
    this.persistent = persist;
    return true;
  }
}
