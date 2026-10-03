'use client';

import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert, Input, Spinner, Textarea, cn, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { ApiError } from '@/lib/api/errors';
import { KEYS, createPost, usePosts } from '../api/facebook';
import {
  POST_TYPES,
  buildCreateInput,
  emptyCompose,
  previewMedia,
  submitKey,
  type ComposeState,
  type ComposeType,
} from '../lib/compose-model';
import { initial } from '../lib/format';
import {
  AlbumIcon,
  FB_BLUE,
  FacebookGlyph,
  GridIcon,
  ImageIcon,
  LinkIcon,
  ListIcon,
  ReelIcon,
  SparkIcon,
  VideoIcon,
} from './fb-icons';
import { PageSelect } from './page-select';
import { UploadMediaButton } from '@/features/broadcasts/components/upload-media-button';

const TYPE_ICON: Record<ComposeType, (p: { className?: string }) => ReactNode> = {
  photo: ImageIcon,
  multi_photo: AlbumIcon,
  link: LinkIcon,
  video: VideoIcon,
  reel: ReelIcon,
};
const AI_TOOLS = ['caption', 'repurpose', 'review', 'bestTime', 'image'] as const;
const linkBtn =
  'inline-flex h-9 items-center gap-2 rounded-full border border-border bg-background px-4 text-xs font-medium hover:bg-muted';

function Step({
  n,
  title,
  aside,
  children,
}: {
  n: string;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="border-b border-border px-[18px] py-4 last:border-0">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="inline-flex size-[23px] shrink-0 items-center justify-center rounded-[7px] bg-muted font-mono text-[10px] font-semibold text-brand">
          {n}
        </span>
        <span className="flex-1 text-lg leading-none">{title}</span>
        {aside}
      </div>
      {children}
    </div>
  );
}

/**
 * `/facebook/posts/create` (TW-FB-016): compose a post, publish now or schedule it, beside a live preview. Photos and the video are
 * public addresses until the storage domain can take an upload; the AI tools wait on an AI provider (both recorded as blocked).
 */
export function ComposePostScreen() {
  const t = useTranslations('facebook.compose');
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const canManage = useCan('fb.posts.manage');
  const known = usePosts({});
  const pages = useMemo(() => known.data?.pages ?? [], [known.data]);
  const [draft, setS] = useState<ComposeState>(() => emptyCompose(''));
  // The first Page is the one in use until another is picked.
  const s = useMemo<ComposeState>(
    () => ({ ...draft, pageId: draft.pageId || pages[0]?.id || '' }),
    [draft, pages],
  );
  const [busy, setBusy] = useState(false);
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);

  const set = (patch: Partial<ComposeState>) => setS((cur) => ({ ...cur, ...patch }));
  const page = pages.find((p) => p.id === s.pageId);
  const media = previewMedia(s);

  const submit = async () => {
    const built = buildCreateInput(s, tz);
    if (!built.ok) {
      toast(t(`problem.${built.problem}`), 'danger');
      return;
    }
    setBusy(true);
    try {
      const post = await createPost(built.input);
      await qc.invalidateQueries({ queryKey: KEYS.all });
      if (post.status === 'failed') {
        toast(t('rejected', { error: post.error ?? '' }), 'danger');
        router.push('/facebook/posts');
        return;
      }
      toast(post.status === 'scheduled' ? t('scheduled') : t('published'), 'success');
      router.push('/facebook/posts');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('failed'), 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-none space-y-6 px-4 py-7 sm:px-6 lg:px-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t('kicker')}
          </div>
          <h1 className="text-3xl font-normal leading-none tracking-tight sm:text-[40px]">
            {t('title')} <span className="italic text-brand">{t('titleAccent')}</span>
          </h1>
          <p className="mt-2 max-w-xl text-[13px] text-muted-foreground">{t('intro')}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Link href="/facebook/posts" className={linkBtn}>
            <ListIcon className="size-3.5" />
            {t('posts')}
          </Link>
          <Link href="/facebook/my-posts" className={linkBtn}>
            <GridIcon className="size-3.5" />
            {t('myPosts')}
          </Link>
          <Link href="/facebook/insights" className={linkBtn}>
            {t('insights')}
          </Link>
        </div>
      </div>

      {known.isError && <Alert tone="danger">{t('loadError')}</Alert>}

      {known.isLoading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : pages.length === 0 || !canManage ? (
        <div className="rounded-2xl border border-border bg-background p-10 text-center shadow-sm">
          <span
            className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl text-white"
            style={{ background: FB_BLUE }}
          >
            <FacebookGlyph className="size-6" />
          </span>
          <div className="text-sm font-semibold">{canManage ? t('noPage') : t('noAccess')}</div>
          <p className="mb-4 mt-1 text-[12.5px] text-muted-foreground">
            {canManage ? t('noPageHint') : t('noAccessHint')}
          </p>
          {canManage && (
            <Link
              href="/facebook"
              className="inline-flex rounded-full bg-brand px-4 py-2 text-[12.5px] font-semibold text-white"
            >
              {t('connect')}
            </Link>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[1fr_360px]">
            <form
              className="rounded-2xl border border-border bg-background shadow-sm"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <Step
                n="01"
                title={t('steps.page')}
                aside={
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {t('required')}
                  </span>
                }
              >
                <PageSelect
                  pages={pages}
                  value={s.pageId}
                  label={t('steps.page')}
                  onChange={(id) => set({ pageId: id })}
                />
              </Step>

              <Step n="02" title={t('steps.type')}>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {POST_TYPES.map((k) => {
                    const Icon = TYPE_ICON[k];
                    const on = s.type === k;
                    return (
                      <button
                        key={k}
                        type="button"
                        aria-pressed={on}
                        onClick={() => set({ type: k })}
                        className={cn(
                          'flex flex-col items-center gap-1.5 rounded-xl border py-2.5 text-[11.5px] font-semibold transition',
                          on
                            ? 'border-brand bg-brand/5 text-brand'
                            : 'border-border text-muted-foreground hover:bg-muted',
                        )}
                      >
                        <Icon className="size-4" />
                        {t(`types.${k}.label`)}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {t(`types.${s.type}.hint`)}
                </p>
              </Step>

              <Step n="03" title={t('steps.media')}>
                {(s.type === 'photo' || s.type === 'multi_photo') && (
                  <div className="space-y-2">
                    <label className="block text-[11px] font-semibold" htmlFor="fb-photos">
                      {t('photoUrls')}
                    </label>
                    <Textarea
                      id="fb-photos"
                      rows={3}
                      value={s.photoText}
                      onChange={(e) => set({ photoText: e.target.value })}
                      placeholder={'https://img1.jpg\nhttps://img2.jpg'}
                      className="font-mono text-xs"
                    />
                    <p className="text-[11px] text-muted-foreground">{t('photoHint')}</p>
                    <UploadMediaButton
                      accept="image/*"
                      onUploaded={(m) =>
                        set({
                          photoText: s.photoText.trim() ? `${s.photoText.trim()}\n${m.url}` : m.url,
                        })
                      }
                    />
                  </div>
                )}
                {s.type === 'link' && (
                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-semibold" htmlFor="fb-link">
                      {t('linkUrl')}
                    </label>
                    <Input
                      id="fb-link"
                      type="url"
                      value={s.link}
                      onChange={(e) => set({ link: e.target.value })}
                      placeholder="https://…"
                      className="font-mono"
                    />
                    <p className="text-[11px] text-muted-foreground">{t('linkHint')}</p>
                  </div>
                )}
                {(s.type === 'video' || s.type === 'reel') && (
                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-semibold" htmlFor="fb-video">
                      {t('videoUrl')}
                    </label>
                    <Input
                      id="fb-video"
                      type="url"
                      value={s.videoUrl}
                      onChange={(e) => set({ videoUrl: e.target.value })}
                      placeholder="https://…/clip.mp4"
                      className="font-mono"
                    />
                    <UploadMediaButton
                      accept="video/*"
                      onUploaded={(m) => set({ videoUrl: m.url })}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      {s.type === 'reel' ? t('reelNote') : t('videoNote')}
                    </p>
                  </div>
                )}
              </Step>

              <Step
                n="04"
                title={t('steps.message')}
                aside={
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {s.message.length}
                  </span>
                }
              >
                <Textarea
                  rows={5}
                  maxLength={60000}
                  value={s.message}
                  onChange={(e) => set({ message: e.target.value })}
                  placeholder={t('messagePlaceholder')}
                  className="resize-y text-[13.5px]"
                />
                <div className="mt-3 rounded-xl border border-border bg-muted/40 p-3">
                  <div className="mb-2.5 flex items-center gap-2">
                    <span
                      className="grid size-6 shrink-0 place-items-center rounded-lg text-white"
                      style={{ background: FB_BLUE }}
                    >
                      <SparkIcon className="size-3.5" />
                    </span>
                    <span className="flex-1 text-[15px] leading-none">{t('ai.title')}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {AI_TOOLS.map((k) => (
                      <button
                        key={k}
                        type="button"
                        disabled
                        className="cursor-not-allowed rounded-lg border border-border bg-background px-2 py-2 text-xs font-semibold opacity-50"
                      >
                        {t(`ai.${k}`)}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">{t('ai.unavailable')}</p>
                </div>
              </Step>

              <Step n="05" title={t('steps.when')}>
                <div className="mb-2 grid grid-cols-2 gap-2">
                  {(['now', 'later'] as const).map((w) => (
                    <button
                      key={w}
                      type="button"
                      aria-pressed={s.when === w}
                      onClick={() => set({ when: w })}
                      className={cn(
                        'rounded-xl border py-2.5 text-[12.5px] font-semibold transition',
                        s.when === w
                          ? 'border-brand bg-brand/5 text-brand'
                          : 'border-border text-muted-foreground hover:bg-muted',
                      )}
                    >
                      {t(`when.${w}`)}
                    </button>
                  ))}
                </div>
                {s.when === 'later' && (
                  <div>
                    <label
                      htmlFor="fb-scheduled-at"
                      className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground"
                    >
                      {t('when.label')}
                    </label>
                    <input
                      id="fb-scheduled-at"
                      type="datetime-local"
                      value={s.scheduledLocal}
                      onChange={(e) => set({ scheduledLocal: e.target.value })}
                      className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-brand sm:w-auto"
                    />
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      {t('when.hint', { tz })}
                    </p>
                  </div>
                )}
              </Step>

              <div className="flex items-center justify-end gap-2 border-t border-border px-[18px] py-3.5">
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
                >
                  {t(`submit.${submitKey(s)}`)}
                </button>
              </div>
            </form>

            <div className="self-start xl:sticky xl:top-6">
              <div className="rounded-[14px] border border-border bg-background p-3 shadow-sm">
                <div className="mb-2 flex items-center justify-between px-1">
                  <div className="flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[0.16em] text-muted-foreground">
                    <span className="size-1.5 animate-pulse rounded-full bg-success" />
                    {t('preview.live')}
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 font-mono text-[11px] font-medium">
                    <FacebookGlyph className="size-3" style={{ color: FB_BLUE }} />
                    {t('preview.facebook')}
                  </span>
                </div>
                <div className="mx-auto max-w-[320px] overflow-hidden rounded-2xl border border-border bg-background">
                  <div className="flex items-center gap-2.5 px-3 py-2.5">
                    <span
                      className="grid size-9 shrink-0 place-items-center rounded-full text-sm font-semibold text-white"
                      style={{ background: FB_BLUE }}
                    >
                      {initial(page?.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold leading-tight">
                        {page?.name || t('preview.yourPage')}
                      </div>
                      <div className="text-[10.5px] text-muted-foreground">
                        {t('preview.justNow')}
                      </div>
                    </div>
                  </div>
                  {s.message.trim() !== '' ? (
                    <div className="whitespace-pre-wrap break-words px-3 pb-2 text-[13px] leading-relaxed">
                      {s.message}
                    </div>
                  ) : (
                    <div className="px-3 pb-2 text-[12.5px] italic text-muted-foreground">
                      {t('preview.empty')}
                    </div>
                  )}
                  {media.kind === 'photos' && (
                    <div
                      className={cn(
                        'grid gap-0.5 bg-muted',
                        media.photos.length > 1 ? 'grid-cols-2' : 'grid-cols-1',
                      )}
                    >
                      {media.photos.slice(0, 4).map((u) => (
                        <img
                          key={u}
                          src={u}
                          alt=""
                          referrerPolicy="no-referrer"
                          className="aspect-square w-full object-cover"
                        />
                      ))}
                    </div>
                  )}
                  {media.kind === 'link' && (
                    <div className="mx-3 mb-2 truncate rounded-lg border border-border bg-muted px-3 py-2 font-mono text-[11px] text-muted-foreground">
                      {media.url}
                    </div>
                  )}
                  {media.kind === 'video' && (
                    <div className="mx-3 mb-2 grid aspect-video place-items-center rounded-lg bg-foreground/90 text-xs text-background">
                      {media.reel ? t('preview.reel') : t('preview.video')}
                    </div>
                  )}
                  <div className="grid grid-cols-3 border-t border-border text-xs font-medium text-muted-foreground">
                    {(['like', 'comment', 'share'] as const).map((a) => (
                      <span
                        key={a}
                        className={cn(
                          'py-2 text-center',
                          a === 'comment' && 'border-x border-border',
                        )}
                      >
                        {t(`preview.${a}`)}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <p className="mt-2 text-center text-[10.5px] text-muted-foreground">
                {t('preview.note')}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {(['help1', 'help2', 'help3'] as const).map((k, i) => (
              <div key={k} className="rounded-2xl border border-border bg-background p-5 shadow-sm">
                <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  {t('help.label', { n: `0${i + 1}` })}
                </div>
                <div className="mb-1 text-xl tracking-tight">{t(`help.${k}.title`)}</div>
                <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                  {t(`help.${k}.body`)}
                </p>
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
