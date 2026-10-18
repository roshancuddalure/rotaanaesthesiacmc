export function formatApiError(detail: unknown, fallback: string): string {
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const errors = detail.slice(0, 20).map(value => {
      if (!value || typeof value !== "object") return "";
      const item = value as {loc?: unknown[]; msg?: unknown};
      const field = (item.loc ?? []).filter(part => !["body", "query", "path"].includes(String(part))).map(String).join(".").replace(/_/g, " ");
      return typeof item.msg === "string" ? `${field ? `${field}: ` : ""}${item.msg}` : "";
    }).filter(Boolean);
    if (errors.length) return errors.join("; ");
  }
  if (detail && typeof detail === "object" && "message" in detail && typeof detail.message === "string") return detail.message;
  return fallback;
}

export function networkRecoveryMessage(localDevelopment: boolean): string {
  return localDevelopment
    ? "Cannot reach the local backend. Check that Duty Rota is running, then retry."
    : "Cannot reach the server. Check your connection and retry. If the problem continues, contact your department administrator.";
}
