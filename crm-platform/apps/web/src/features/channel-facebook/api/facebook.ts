'use client';

import { useQuery } from '@tanstack/react-query';
import {
  connectResultSchema,
  facebookConnectConfigSchema,
  facebookPageActionResultSchema,
  facebookPageListSchema,
  facebookPageSchema,
  fbBroadcastComposeSchema,
  fbBroadcastListSchema,
  fbBroadcastSchema,
  fbInsightsSchema,
  fbMyPostsSchema,
  fbPostListSchema,
  fbPostSchema,
  messengerSetupSchema,
  retryFbBroadcastResponseSchema,
  setupResultSchema,
  startConnectResponseSchema,
  type CreateFbBroadcastInput,
  type CreateFbPostInput,
  type FbBroadcastList,
  type ListFbPostsQuery,
  type SaveIceBreakersInput,
  type SaveMenuInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

export const KEYS = {
  all: ['fb'] as const,
  config: ['fb', 'config'] as const,
  pages: ['fb', 'pages'] as const,
  broadcasts: ['fb', 'broadcasts'] as const,
  compose: ['fb', 'compose'] as const,
  setup: (page: string | undefined) => ['fb', 'setup', page ?? ''] as const,
  posts: (q: Partial<ListFbPostsQuery>) => ['fb', 'posts', q] as const,
  myPosts: (page: string | undefined) => ['fb', 'my-posts', page ?? ''] as const,
  insights: (page: string | undefined, tz: string) => ['fb', 'insights', page ?? '', tz] as const,
};

/** A sending broadcast moves on the worker, so the list follows it closely; an idle list only needs an occasional refresh. */
const FAST_MS = 3_000;
const SLOW_MS = 15_000;

// ── Pages ─────────────────────────────────────────────────────────────────

export const useConfig = () =>
  useQuery({
    queryKey: KEYS.config,
    queryFn: ({ signal }) =>
      apiFetch('/facebook/config', { schema: facebookConnectConfigSchema, signal }),
  });

export const usePages = () =>
  useQuery({
    queryKey: KEYS.pages,
    queryFn: ({ signal }) =>
      apiFetch('/facebook/pages', { schema: facebookPageListSchema, signal }),
    refetchInterval: SLOW_MS,
  });

export const startLogin = () =>
  apiFetch('/facebook/connect/start', { method: 'POST', schema: startConnectResponseSchema });

export const connectManual = (pageAccessToken: string) =>
  apiFetch('/facebook/connect/manual', {
    method: 'POST',
    body: { pageAccessToken },
    schema: connectResultSchema,
  });

export const refreshPage = (id: string) =>
  apiFetch(`/facebook/pages/${id}/refresh`, { method: 'POST', schema: facebookPageSchema });

export const resubscribePage = (id: string) =>
  apiFetch(`/facebook/pages/${id}/resubscribe`, {
    method: 'POST',
    schema: facebookPageActionResultSchema,
  });

export const removePage = (id: string) => apiFetch(`/facebook/pages/${id}`, { method: 'DELETE' });

// ── Broadcasts ────────────────────────────────────────────────────────────

export const isSending = (list: FbBroadcastList | undefined) =>
  list?.data.some((b) => b.status === 'sending') ?? false;

export const useBroadcasts = () =>
  useQuery({
    queryKey: KEYS.broadcasts,
    queryFn: ({ signal }) =>
      apiFetch('/facebook/broadcasts', { schema: fbBroadcastListSchema, signal }),
    refetchInterval: (q) => (isSending(q.state.data) ? FAST_MS : SLOW_MS),
  });

export const useCompose = () =>
  useQuery({
    queryKey: KEYS.compose,
    queryFn: ({ signal }) =>
      apiFetch('/facebook/broadcasts/compose', { schema: fbBroadcastComposeSchema, signal }),
  });

export const createBroadcast = (body: CreateFbBroadcastInput) =>
  apiFetch('/facebook/broadcasts', { method: 'POST', body, schema: fbBroadcastSchema });

export const startBroadcast = (id: string) =>
  apiFetch(`/facebook/broadcasts/${id}/start`, { method: 'POST', schema: fbBroadcastSchema });

export const pauseBroadcast = (id: string) =>
  apiFetch(`/facebook/broadcasts/${id}/pause`, { method: 'POST', schema: fbBroadcastSchema });

export const retryBroadcast = (id: string) =>
  apiFetch(`/facebook/broadcasts/${id}/retry`, {
    method: 'POST',
    schema: retryFbBroadcastResponseSchema,
  });

export const deleteBroadcast = (id: string) =>
  apiFetch(`/facebook/broadcasts/${id}`, { method: 'DELETE' });

// ── Messenger setup ───────────────────────────────────────────────────────

export const useSetup = (page: string | undefined) =>
  useQuery({
    queryKey: KEYS.setup(page),
    queryFn: ({ signal }) =>
      apiFetch('/facebook/setup', { query: { page }, schema: messengerSetupSchema, signal }),
  });

const setupPath = (page: string, piece: string) => `/facebook/setup/${page}/${piece}`;

export const saveGetStarted = (page: string, payload: string) =>
  apiFetch(setupPath(page, 'get-started'), {
    method: 'PUT',
    body: { payload },
    schema: setupResultSchema,
  });
export const removeGetStarted = (page: string) =>
  apiFetch(setupPath(page, 'get-started'), { method: 'DELETE', schema: setupResultSchema });

export const saveGreeting = (page: string, greeting: string) =>
  apiFetch(setupPath(page, 'greeting'), {
    method: 'PUT',
    body: { greeting },
    schema: setupResultSchema,
  });
export const removeGreeting = (page: string) =>
  apiFetch(setupPath(page, 'greeting'), { method: 'DELETE', schema: setupResultSchema });

export const saveMenu = (page: string, body: SaveMenuInput) =>
  apiFetch(setupPath(page, 'menu'), { method: 'PUT', body, schema: setupResultSchema });
export const removeMenu = (page: string) =>
  apiFetch(setupPath(page, 'menu'), { method: 'DELETE', schema: setupResultSchema });

export const saveIceBreakers = (page: string, body: SaveIceBreakersInput) =>
  apiFetch(setupPath(page, 'ice-breakers'), { method: 'PUT', body, schema: setupResultSchema });
export const removeIceBreakers = (page: string) =>
  apiFetch(setupPath(page, 'ice-breakers'), { method: 'DELETE', schema: setupResultSchema });

// ── Posts, My posts, insights ─────────────────────────────────────────────

export const usePosts = (q: Partial<ListFbPostsQuery>) =>
  useQuery({
    queryKey: KEYS.posts(q),
    queryFn: ({ signal }) =>
      apiFetch('/facebook/posts', {
        query: { ...q, status: q.status === 'all' ? undefined : q.status },
        schema: fbPostListSchema,
        signal,
      }),
  });

export const createPost = (body: CreateFbPostInput) =>
  apiFetch('/facebook/posts', { method: 'POST', body, schema: fbPostSchema });

export const publishPost = (id: string) =>
  apiFetch(`/facebook/posts/${id}/publish`, { method: 'POST', schema: fbPostSchema });

export const deletePost = (id: string) => apiFetch(`/facebook/posts/${id}`, { method: 'DELETE' });

export const useMyPosts = (page: string | undefined) =>
  useQuery({
    queryKey: KEYS.myPosts(page),
    queryFn: ({ signal }) =>
      apiFetch('/facebook/my-posts', { query: { page }, schema: fbMyPostsSchema, signal }),
  });

export const useInsights = (page: string | undefined, tz: string) =>
  useQuery({
    queryKey: KEYS.insights(page, tz),
    queryFn: ({ signal }) =>
      apiFetch('/facebook/insights', { query: { page, tz }, schema: fbInsightsSchema, signal }),
  });
