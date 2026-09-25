import { t } from '../../shared/i18n';
import { needsCheckAfterUnmute } from '../../shared/muted';
import type { UpdateSite } from '../../shared/types';
import { SOURCE_LABEL } from './format';
import { useToast } from './toast';
import { api, type AppModel } from './useApp';

/**
 * Turns a site on or off for every creator, or with `creatorKey` for that creator only. Says so when
 * turning one on only takes effect after a check.
 */
export function useSiteToggle(app: AppModel): (site: UpdateSite, on: boolean, creatorKey?: string) => Promise<boolean> {
  const toast = useToast();
  return async (site, on, creatorKey) => {
    const snapshot = app.snapshot;
    if (!snapshot) return false;
    const creators = (snapshot.lastResult?.creators ?? []).filter((c) =>
      creatorKey ? c.key === creatorKey && !snapshot.settings.mutedSources.includes(site) : !snapshot.creatorMutedSources[c.key]?.includes(site),
    );
    const needsCheck = on && needsCheckAfterUnmute(creators, site);
    const mutedSources = on ? snapshot.settings.mutedSources.filter((s) => s !== site) : [...snapshot.settings.mutedSources, site];
    const done = await app.run(() => (creatorKey ? api.setCreatorSite(creatorKey, site, on) : api.updateSettings({ mutedSources })));
    if (!done) return false;
    if (needsCheck) {
      toast({
        text: t().sites.checkedAgainNext(SOURCE_LABEL[site]),
        action: snapshot.running ? undefined : { label: t().common.checkNow, run: () => void app.run(() => api.startCheck()) },
      });
    }
    return true;
  };
}
