import type { CreateTaskInput, TaskResponse, UpdateTaskInput } from '@crm/contracts';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import {
  completeTask,
  createTask,
  deleteTask,
  getLinkedContact,
  getTask,
  listAssignees,
  listTasks,
  reopenTask,
  searchContacts,
  updateTask,
  type TaskListFilters,
  type TaskListSource,
} from './api';
import { useActionKeys } from '@/lib/query/use-action-keys';

/** Rows asked for at a time; the list asks for the next page when the person scrolls to the end. */
export const PAGE_SIZE = 50;

/** A finished mutation is not looked at again, so the cache forgets it at once instead of holding it for five minutes. */
const NO_KEEP = 0;

export const tasksKey = ['tasks'] as const;
export const taskListsKey = [...tasksKey, 'list'] as const;
export const taskListKey = (source: TaskListSource, filters: TaskListFilters) =>
  [...taskListsKey, source, filters] as const;
export const taskKey = (id: string) => [...tasksKey, 'detail', id] as const;
export const assigneesKey = [...tasksKey, 'assignees'] as const;
export const contactChoicesKey = (q: string) => [...tasksKey, 'contact-choices', q] as const;
export const linkedContactKey = (id: string) => [...tasksKey, 'contact', id] as const;

type TaskPages = InfiniteData<{ data: TaskResponse[] }, string | undefined>;

/** The list, a page at a time. No request at all when `enabled` is false (the person may not read tasks). */
export function useTaskList(source: TaskListSource, filters: TaskListFilters, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: taskListKey(source, filters),
    queryFn: ({ pageParam, signal }) =>
      listTasks(source, { ...filters, limit: PAGE_SIZE, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
    enabled,
    // Typing in the search box keeps the rows on screen until the narrowed ones arrive, instead of blanking the list.
    placeholderData: keepPreviousData,
  });
}

export const useTask = (id: string, enabled = true) =>
  useQuery({
    queryKey: taskKey(id),
    queryFn: ({ signal }) => getTask(id, signal),
    enabled: enabled && id !== '',
  });

/** The team a task can be given to. `enabled` is false for a person who may not read contacts (the API keeps the list there). */
export const useAssignees = (enabled: boolean) =>
  useQuery({
    queryKey: assigneesKey,
    queryFn: ({ signal }) => listAssignees(signal),
    enabled,
  });

/** Contacts matching the words typed in the picker; the rows stay while the next answer loads. */
export const useContactChoices = (q: string, enabled: boolean) =>
  useQuery({
    queryKey: contactChoicesKey(q),
    queryFn: ({ signal }) => searchContacts(q, signal),
    enabled,
    placeholderData: keepPreviousData,
  });

/** The contact a task is being added for, to show its name. */
export const useLinkedContact = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: linkedContactKey(id),
    queryFn: ({ signal }) => getLinkedContact(id, signal),
    enabled: enabled && id !== '',
  });

/** Puts a task the API just returned into the cache: the open task, and the same row in every list that shows it. */
function remember(queryClient: QueryClient, task: TaskResponse) {
  queryClient.setQueryData(taskKey(task.id), task);
  queryClient.setQueriesData<TaskPages>({ queryKey: taskListsKey }, (old) =>
    old
      ? {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            data: page.data.map((row) => (row.id === task.id ? task : row)),
          })),
        }
      : old,
  );
  void queryClient.invalidateQueries({ queryKey: taskListsKey });
}

/** What a toggle needs to know about the task it was made on. */
export type TaskToggle = Pick<TaskResponse, 'id' | 'rowVersion' | 'status'>;

const toggleSignature = (task: TaskToggle) =>
  `${task.status === 'done' ? 'reopen' : 'complete'}:${task.id}:${task.rowVersion}`;

/** Completes an open task or reopens a done one, with the version the list showed (a stale one is 409 ROW_VERSION_CONFLICT). */
export function useToggleTask() {
  const queryClient = useQueryClient();
  const keys = useActionKeys();
  return useMutation({
    gcTime: NO_KEEP,
    mutationFn: (task: TaskToggle) => {
      const key = keys.keyFor(toggleSignature(task));
      return task.status === 'done'
        ? reopenTask(task.id, task.rowVersion, key)
        : completeTask(task.id, task.rowVersion, key);
    },
    onError: (error, task) => keys.failed(toggleSignature(task), error),
    onSuccess: (task, sent) => {
      keys.done(toggleSignature(sent));
      remember(queryClient, task);
    },
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();
  const keys = useActionKeys();
  return useMutation({
    gcTime: NO_KEEP,
    mutationFn: (id: string) => deleteTask(id, keys.keyFor(`delete:${id}`)),
    onError: (error, id) => keys.failed(`delete:${id}`, error),
    onSuccess: (_, id) => {
      keys.done(`delete:${id}`);
      void queryClient.invalidateQueries({ queryKey: taskListsKey });
    },
  });
}

/** A write is the same request only while its body is: a corrected form after a lost connection is a new one. */
const bodySignature = (action: string, body: unknown) => `${action}:${JSON.stringify(body)}`;

export function useCreateTask() {
  const queryClient = useQueryClient();
  const keys = useActionKeys();
  return useMutation({
    gcTime: NO_KEEP,
    mutationFn: (body: CreateTaskInput) =>
      createTask(body, keys.keyFor(bodySignature('create', body))),
    onError: (error, body) => keys.failed(bodySignature('create', body), error),
    onSuccess: (task, body) => {
      keys.done(bodySignature('create', body));
      remember(queryClient, task);
    },
  });
}

export function useUpdateTask(id: string) {
  const queryClient = useQueryClient();
  const keys = useActionKeys();
  return useMutation({
    gcTime: NO_KEEP,
    mutationFn: (body: UpdateTaskInput) =>
      updateTask(id, body, keys.keyFor(bodySignature(`update:${id}`, body))),
    onError: (error, body) => keys.failed(bodySignature(`update:${id}`, body), error),
    onSuccess: (task, body) => {
      keys.done(bodySignature(`update:${id}`, body));
      remember(queryClient, task);
    },
  });
}
