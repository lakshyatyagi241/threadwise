'use client';

import { usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { HELP_AGENT_NOTICE_VERSION } from '@crm/contracts';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import { useHelpEntries } from '@/features/help-center';
import { docForPath } from '@/features/help-center/search';
import { getGuideSteps } from '../actions';
import { useHelpAgentStatus } from '../api/help-agent';
import { rankGuides } from '../lib/retrieval';
import { assistantAllowedOn } from '../lib/url-guard';
import { AssistantPanelView } from './assistant-panel';
import { useAssistant } from './use-assistant';

export const OPEN_EVENT = 'help-agent:open';
/** Ctrl or Cmd with Shift and L. */
export const SHORTCUT_KEY = 'l';

interface HelpAgentContextValue {
  /** All three switches are on for this person: the plan, the workspace setting and the permission. */
  available: boolean;
  open: (prompt?: string) => void;
}

const HelpAgentContext = createContext<HelpAgentContextValue | null>(null);

/** The assistant, for a screen that wants to offer it (the Help center); null where it is not mounted. */
export function useHelpAgent(): HelpAgentContextValue | null {
  return useContext(HelpAgentContext);
}

function noticeKey(userId: number | string): string {
  return `help-agent:notice:v${HELP_AGENT_NOTICE_VERSION}:${userId}`;
}

function readNotice(userId: number | string): boolean {
  try {
    return window.localStorage.getItem(noticeKey(userId)) === '1';
  } catch {
    return false;
  }
}

/**
 * Mounts the assistant for the signed-in shell: the floating "Ask" button, the shortcut, the panel, and the door the Help center uses
 * to open it. Nothing renders (and the library is never downloaded) unless the plan, the workspace and the role all allow it; the
 * model library itself is loaded only when a task starts.
 */
export function HelpAgentRoot({
  planEnabled,
  children,
}: {
  planEnabled: boolean;
  children: ReactNode;
}) {
  const t = useTranslations('help-agent');
  const locale = useLocale();
  const session = useSession();
  const pathname = usePathname() || '/';
  const entries = useHelpEntries();
  const canUse = 'help.agent.use' in session.permissions;
  const status = useHelpAgentStatus(planEnabled && canUse);
  const available = planEnabled && canUse && status.data?.available === true;
  const maxSteps = status.data?.limits.maxSteps ?? 25;

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [noticeSeen, setNoticeSeen] = useState(false);
  const [stepsById, setStepsById] = useState<Record<string, string[] | null | undefined>>({});
  const assistant = useAssistant(locale);
  const userId = session.user.id;

  const openPanel = useCallback((prompt?: string) => {
    setOpen(true);
    if (prompt) setDraft(prompt.slice(0, 600));
  }, []);

  useEffect(() => {
    if (!available) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === SHORTCUT_KEY) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpen = (e: Event) => openPanel((e as CustomEvent<{ prompt?: string }>).detail?.prompt);
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, [available, openPanel]);

  const disabledHere = !assistantAllowedOn(pathname);
  const guides = useMemo(
    () =>
      draft.trim().length >= 3
        ? rankGuides(entries, draft).map(({ entry }) => ({
            id: entry.id,
            title: entry.title,
            summary: entry.summary,
            href: `/help/${entry.id}`,
          }))
        : [],
    [entries, draft],
  );
  const pageGuide = docForPath(entries, pathname);
  const prompts = pageGuide
    ? [
        t('examples.howDo', { title: pageGuide.title }),
        t('examples.showMe', { title: pageGuide.title }),
        t('examples.whereIs', { title: pageGuide.title }),
      ]
    : [t('examples.generic1'), t('examples.generic2'), t('examples.generic3')];

  const context = useMemo(() => ({ available, open: openPanel }), [available, openPanel]);

  const close = useCallback(() => {
    if (assistant.running) void assistant.stop();
    setOpen(false);
  }, [assistant]);

  return (
    <HelpAgentContext.Provider value={context}>
      {children}
      {available && !open && !disabledHere ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-keyshortcuts="Control+Shift+L Meta+Shift+L"
          title={t('launcher.shortcut')}
          data-page-agent-ignore="true"
          data-testid="assistant-launcher"
          className="fixed bottom-4 end-4 z-40 flex h-12 items-center gap-2 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground shadow-lg outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <svg
            viewBox="0 0 20 20"
            className="size-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden
          >
            <path d="M10 2l1.6 4.4L16 8l-4.4 1.6L10 14l-1.6-4.4L4 8l4.4-1.6L10 2zM15.5 13l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z" />
          </svg>
          {t('launcher.label')}
        </button>
      ) : null}
      {available && open ? (
        <AssistantPanelView
          state={assistant.state}
          draft={draft}
          onDraft={setDraft}
          disabledHere={disabledHere}
          // Read on render: the panel only exists on the client, after the person opened it.
          noticeAccepted={noticeSeen || readNotice(userId)}
          onAcceptNotice={() => {
            try {
              window.localStorage.setItem(noticeKey(userId), '1');
            } catch {
              // storage blocked: the notice is simply shown again next time
            }
            setNoticeSeen(true);
          }}
          prompts={prompts}
          guides={guides}
          stepsById={stepsById}
          onLoadSteps={(id) => {
            setStepsById((s) => ({ ...s, [id]: null }));
            void getGuideSteps(id)
              .then((steps) => setStepsById((s) => ({ ...s, [id]: steps ?? null })))
              .catch(() => undefined);
          }}
          onSubmit={(mode, task) => void assistant.submit(task ?? draft, mode)}
          onStop={() => void assistant.stop()}
          onAllow={assistant.allow}
          onDeny={assistant.deny}
          onAnswer={assistant.answer}
          onReset={assistant.reset}
          onClose={close}
          maxSteps={maxSteps}
        />
      ) : null}
    </HelpAgentContext.Provider>
  );
}
