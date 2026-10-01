/** Offers a Blob as a file download through a temporary object URL. */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Byte-order mark: written first so spreadsheets read a downloaded CSV as UTF-8. */
export const BOM = String.fromCharCode(0xfeff);

export const downloadCsv = (filename: string, text: string): void =>
  downloadBlob(filename, new Blob([BOM, text], { type: 'text/csv;charset=utf-8' }));
