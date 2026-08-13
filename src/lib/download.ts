/**
 * Browser download helpers.
 *
 * Shared rather than living inside one feature: Shelter Maps, Costs and the
 * incubator report all hand the user a file, and a second copy of this would be
 * free to drift on something as easy to get subtly wrong as revoking the object
 * URL.
 */

/** Trigger a client-side download of a Blob. Browser-only. */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** Trigger a client-side download of text content. Browser-only. */
export function downloadText(filename: string, mime: string, text: string): void {
  downloadBlob(filename, new Blob([text], { type: mime }))
}

/**
 * A CSV, with a UTF-8 byte-order mark.
 *
 * Excel on Windows guesses the encoding of a .csv from its bytes and guesses
 * the system codepage. The BOM settles it — without one, the degree sign in
 * "Temperature (°C)" opens as mojibake, which is the first thing anyone sees.
 */
export function downloadCsv(filename: string, text: string): void {
  downloadBlob(filename, new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' }))
}
