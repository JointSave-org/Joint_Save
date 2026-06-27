/**
 * Minimal CSV export utility.
 *
 * buildCsv   – pure function that converts a header row + data rows to a CSV string.
 * downloadCsv – triggers a browser file-download from a CSV string (no-op in SSR).
 */

/** Escape a single cell value per RFC 4180. */
function escapeCell(value: unknown): string {
  const str = value == null ? "" : String(value)
  // Wrap in quotes if the value contains a comma, double-quote, or newline.
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

/** Convert a header + rows array into a CSV string. */
export function buildCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers, ...rows].map((row) =>
    row.map(escapeCell).join(",")
  )
  return lines.join("\n")
}

/** Trigger a browser download for the given CSV string. */
export function downloadCsv(csv: string, filename: string): void {
  if (typeof window === "undefined") return
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
