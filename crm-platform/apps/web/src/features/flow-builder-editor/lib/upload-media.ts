/** Uploads a file for a Media / Carousel node (`POST /v2/flows/upload-media`) and returns where it can be fetched. */
export async function uploadFlowMedia(
  file: File,
  kind: 'image' | 'video' | 'audio' | 'document',
): Promise<{ url: string; filename: string }> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('type', kind);
  const res = await fetch('/api/v2/flows/upload-media', {
    method: 'POST',
    body: fd,
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  const json = (await res.json().catch(() => ({}))) as {
    data?: { url: string; filename: string };
    detail?: string;
    title?: string;
  };
  if (!res.ok || !json.data) throw new Error(json.detail ?? json.title ?? `HTTP ${res.status}`);
  return { url: json.data.url, filename: json.data.filename };
}

/**
 * Keeps a copy of a picture found at a web address for a Carousel card (`POST /v2/flows/upload-media/from-url`), so the chat
 * shows this server's copy. The server's own message is what the builder shows when the copy is refused.
 */
export async function copyFlowMediaFromUrl(
  url: string,
): Promise<{ url: string; filename: string }> {
  const res = await fetch('/api/v2/flows/upload-media/from-url', {
    method: 'POST',
    body: JSON.stringify({ url }),
    credentials: 'same-origin',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
  });
  const json = (await res.json().catch(() => ({}))) as {
    data?: { url: string; filename: string };
    detail?: string;
    title?: string;
  };
  if (!res.ok || !json.data) throw new Error(json.detail ?? json.title ?? `HTTP ${res.status}`);
  return { url: json.data.url, filename: json.data.filename };
}
