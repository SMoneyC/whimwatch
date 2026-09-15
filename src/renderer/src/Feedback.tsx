import { ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';
import { type IssueForm, newIssueUrl } from '../../shared/config';
import { Dialog } from './dialog';
import { useToast } from './toast';
import { api, type AppModel } from './useApp';
import { Button, Spinner } from './ui';

/** Forms that ask for diagnostics go through ReportDialog first. */
export type ReportForm = Extract<IssueForm, 'bug_report' | 'site_changed'>;

const PLATFORM_NAME = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' } as const;

/** Opens an issue form on GitHub (in a private window if the user chose that for links). */
export function openIssueForm(app: AppModel, form: IssueForm): void {
  const snapshot = app.snapshot;
  // The bug form's "Operating system" field: the system and app version only, nothing identifying.
  const fields: Record<string, string> = form === 'bug_report' && snapshot ? { os: `${PLATFORM_NAME[snapshot.platform]} · WhimWatch ${snapshot.appVersion}` } : {};
  void app.run(() => api.openExternal(newIssueUrl(form, fields)));
}

const COPY: Record<ReportForm, { title: string; intro: string }> = {
  bug_report: {
    title: 'Report a bug',
    intro: 'The bug report form opens on GitHub. Diagnostics help a lot: copy them, then paste them into the form’s Diagnostics field.',
  },
  site_changed: {
    title: 'Report a site problem',
    intro: 'For when a site (wicked.cc, LoversLab, Patreon or the WickedWhims page) stops being read, usually after a redesign. Copy the diagnostics, then paste them into the form.',
  },
};

/**
 * Shows the diagnostics before anything leaves the app, then copies them and opens the right GitHub
 * form. They're never put in the address, so they don't end up in browser history.
 */
export function ReportDialog({ form, app, onClose }: { form: ReportForm; app: AppModel; onClose: () => void }) {
  const toast = useToast();
  const [text, setText] = useState<string>();

  useEffect(() => {
    let live = true;
    void app.run(() => api.getDiagnostics()).then((value) => live && setText(value ?? ''));
    return () => {
      live = false;
    };
  }, [app]);

  return (
    <Dialog
      title={COPY[form].title}
      subtitle={COPY[form].intro}
      onClose={onClose}
      width={720}
      footer={
        <>
          <Button
            variant="quiet"
            onClick={() => {
              openIssueForm(app, form);
              onClose();
            }}
          >
            Open the form without diagnostics
          </Button>
          <span className="spacer" />
          <Button
            variant="primary"
            icon={ExternalLink}
            disabled={text === undefined}
            onClick={async () => {
              await app.run(() => api.copyDiagnostics());
              openIssueForm(app, form);
              toast({ text: 'Diagnostics copied. Paste them into the form.' });
              onClose();
            }}
          >
            Copy diagnostics and open the form
          </Button>
        </>
      }
    >
      <p className="muted small">
        This is exactly what gets copied. It has no creator names or page addresses, and your home folder shows as ~. Add anything else
        you’re comfortable sharing in the form.
      </p>
      {text === undefined ? (
        <p className="muted row-center">
          <Spinner /> Gathering diagnostics…
        </p>
      ) : (
        <textarea className="diagnostics mono" readOnly value={text} rows={12} spellCheck={false} aria-label="Diagnostics text" />
      )}
    </Dialog>
  );
}
