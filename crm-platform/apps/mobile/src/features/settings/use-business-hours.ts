import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchBusinessHours, saveBusinessHours } from './business-hours-api';

export const businessHoursKey = ['settings', 'business-hours'] as const;

/** The saved schedule. No request at all while `enabled` is false (the person may not read the inbox settings). */
export const useBusinessHours = (enabled: boolean) =>
  useQuery({
    queryKey: businessHoursKey,
    queryFn: ({ signal }) => fetchBusinessHours(signal),
    enabled,
  });

export function useSaveBusinessHours() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof saveBusinessHours>[0]) => saveBusinessHours(input),
    // The answer is the saved schedule: it replaces what is cached, so the form shows exactly what the server holds.
    onSuccess: (saved) => queryClient.setQueryData(businessHoursKey, saved),
  });
}
