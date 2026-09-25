import { ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';
import { type IssueForm, newIssueUrl } from '../../shared/config';
import { getLocale, t } from '../../shared/i18n';
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

const copy = (form: ReportForm): { title: string; intro: string } => {
  const m = t().feedback;
  return form === 'bug_report' ? { title: m.bugTitle, intro: m.bugIntro } : { title: m.siteTitle, intro: m.siteIntro };
};

/**
 * Shows the diagnostics before anything leaves the app, then copies them and opens the right GitHub
 * form. They're never put in the address, so they don't end up in browser history.
 */
export function ReportDialog({ form, app, onClose }: { form: ReportForm; app: AppModel; onClose: () => void }) {
  const toast = useToast();
  const [text, setText] = useState<string>();
  const m = t().feedback;

  useEffect(() => {
    let live = true;
    void app.run(() => api.getDiagnostics()).then((value) => live && setText(value ?? ''));
    return () => {
      live = false;
    };
  }, [app]);

  return (
    <Dialog
      title={copy(form).title}
      subtitle={copy(form).intro}
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
            {m.withoutDiagnostics}
          </Button>
          <span className="spacer" />
          <Button
            variant="primary"
            icon={ExternalLink}
            disabled={text === undefined}
            onClick={async () => {
              await app.run(() => api.copyDiagnostics());
              openIssueForm(app, form);
              toast({ text: m.copiedPaste });
              onClose();
            }}
          >
            {m.copyAndOpen}
          </Button>
        </>
      }
    >
      <p className="muted small">
        {m.whatGetsCopied}
        {getLocale() !== 'en' && ` ${m.englishNote}`}
      </p>
      {text === undefined ? (
        <p className="muted row-center">
          <Spinner /> {m.gathering}
        </p>
      ) : (
        <textarea className="diagnostics mono" readOnly value={text} rows={12} spellCheck={false} aria-label={t().settings.diagnosticsText} lang="en" />
      )}
    </Dialog>
  );
}
