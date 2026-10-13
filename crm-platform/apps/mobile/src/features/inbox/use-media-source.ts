import { useEffect, useState } from 'react';
import { env } from '@/config/env';
import { getAccessToken } from '@/lib/auth/session-manager';

/**
 * How to load a file of a message. The API's links are made for one signed-in person and refuse anyone else, so the request
 * carries the access token; the link comes from the web app's proxy (`/api/v2/media/...`) and the app talks to the API directly.
 * The token lives only in this component's memory while the picture is on screen: it is never stored, logged or put in the link.
 */
export interface MediaSource {
  uri: string;
  headers: { Authorization: string };
}

/** The address on the API for a link the API made for a web client. */
export const mediaUri = (link: string, apiUrl: string): string => {
  if (/^https?:\/\//i.test(link)) return link;
  const base = apiUrl.replace(/\/$/, '');
  return `${base}${link.replace(/^\/api(?=\/)/, '')}`;
};

/** The source to give an Image for `link`, or null while the token is being read (and when signed out). */
export function useMediaSource(link: string | null): MediaSource | null {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void getAccessToken().then((value) => {
      if (alive) setToken(value);
    });
    return () => {
      alive = false;
    };
  }, [link]);
  return link !== null && token !== null
    ? { uri: mediaUri(link, env.apiUrl), headers: { Authorization: `Bearer ${token}` } }
    : null;
}
