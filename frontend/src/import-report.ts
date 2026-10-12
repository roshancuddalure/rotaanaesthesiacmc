function csvCell(value: unknown): string {
  let text=String(value ?? "");
  if (/^[\s]*[=+@-]/.test(text)) text="'"+text;
  return `"${text.replace(/"/g,'""')}"`;
}

export function previewIssuesCsv(rows: Record<string, unknown>[]): string {
  const rejected=rows.filter(row => row.skip || ['needs_review','skip','skipped','invalid'].includes(String(row.action ?? row.preview_status)) ||
    (Array.isArray(row.errors) && row.errors.length) || (Array.isArray(row.issues) && row.issues.length));
  const lines=[['Sheet','Source row','Action','Original','Normalized','Issues'],...rejected.map(row=>[
    row.sheet_name ?? row.sheet ?? '',row.row_number ?? row.row ?? '',row.action ?? row.preview_status ?? '',
    JSON.stringify(row.raw ?? Object.fromEntries(Object.entries(row).filter(([key])=>key.startsWith('raw_')))),
    JSON.stringify(row.normalized ?? row),JSON.stringify(row.errors ?? row.issues ?? []),
  ])];
  return '\ufeff'+lines.map(line=>line.map(csvCell).join(',')).join('\r\n');
}

export function downloadPreviewIssues(rows: Record<string, unknown>[], filename: string): void {
  const url=URL.createObjectURL(new Blob([previewIssuesCsv(rows)],{type:'text/csv;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download=filename;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
