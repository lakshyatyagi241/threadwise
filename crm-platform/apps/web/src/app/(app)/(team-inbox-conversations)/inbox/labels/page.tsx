import { redirect } from 'next/navigation';

/** The original address of Settings, Conversation tags: "labels" was our name for tags and is retired. Old links and bookmarks land on `/inbox/tags`. */
export default function LegacyLabelsPage(): never {
  redirect('/inbox/tags');
}
