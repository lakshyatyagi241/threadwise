/** Byte-order mark: written first so spreadsheets read the downloaded CSV as UTF-8. */
const BOM = String.fromCharCode(0xfeff);

/** Offers CSV text as a file download through a temporary object URL. */
export function downloadCsv(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([BOM, text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
