/** Links of the share modal (WD-STORE-030). The text and the targets are WaDesk's. */

export interface ShareLinks {
  text: string;
  whatsapp: string;
  email: string;
  telegram: string;
}

/** `copy.text` and `copy.subject` are the already-translated lines (they carry the shop name). */
export function shareLinks(
  url: string,
  title: string,
  copy: { text: string; subject: string },
): ShareLinks {
  const text = `${copy.text}\n${url}`;
  return {
    text,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(text)}`,
    email: `mailto:?subject=${encodeURIComponent(copy.subject)}&body=${encodeURIComponent(text)}`,
    telegram: `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`,
  };
}
