'use client';

import { REVIEWS_PAGE_SIZE, listReviewsResponseSchema, type ReviewStatus } from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { KEYS } from './catalog';
import { useNumberedPage } from './numbered-pages';

/** One numbered page of reviews of a status; the three tab counts come with every page. */
export function useReviewsPage(status: ReviewStatus, page: number) {
  const res = useNumberedPage({
    key: KEYS.reviews,
    path: '/catalog/reviews',
    schema: listReviewsResponseSchema,
    query: { status, limit: REVIEWS_PAGE_SIZE },
    page,
  });
  const counts = (res.meta as { counts?: Record<ReviewStatus, number> } | undefined)?.counts;
  return { ...res, counts };
}

export const moderateReview = (id: string, status: ReviewStatus) =>
  apiFetch(`/catalog/reviews/${id}`, { method: 'PUT', body: { status } });
export const deleteReview = (id: string) =>
  apiFetch(`/catalog/reviews/${id}`, { method: 'DELETE' });
