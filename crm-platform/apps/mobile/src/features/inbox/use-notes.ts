import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { addNote, deleteNote, fetchEvents, fetchNotes } from './notes-api';

export const notesKey = (id: string) => ['inbox', 'notes', id] as const;
export const eventsKey = (id: string) => ['inbox', 'events', id] as const;

/** How often an open thread asks for new notes while it is on screen and the live connection is not up, with its messages. */
const NOTES_POLL_MS = 15_000;

/**
 * The conversation's internal notes. No request until the screen asks (and the person may read the thread); the thread, which shows
 * them between the messages, asks again on a timer while it is in front.
 */
export const useNotes = (conversationId: string, enabled: boolean, polling = false) =>
  useQuery({
    queryKey: notesKey(conversationId),
    queryFn: ({ signal }) => fetchNotes(conversationId, signal),
    refetchInterval: polling ? NOTES_POLL_MS : false,
    enabled: enabled && conversationId !== '',
  });

/** The activity timeline of the conversation. */
export const useEvents = (conversationId: string, enabled: boolean) =>
  useQuery({
    queryKey: eventsKey(conversationId),
    queryFn: ({ signal }) => fetchEvents(conversationId, signal),
    enabled: enabled && conversationId !== '',
  });

/** Adds or deletes a note; the notes and the timeline (a note is an event in it) are read again either way. */
export function useChangeNotes(conversationId: string) {
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: notesKey(conversationId) }),
      queryClient.invalidateQueries({ queryKey: eventsKey(conversationId) }),
    ]);
  const add = useMutation({
    mutationFn: (body: string) =>
      addNote(conversationId, { body, mentions: [] }, Crypto.randomUUID()),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (noteId: string) => deleteNote(conversationId, noteId),
    onSettled: refresh,
  });
  return { add, remove };
}
