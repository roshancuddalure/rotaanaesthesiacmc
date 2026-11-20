/** Local search over fields already displayed by an import-history snapshot.
 * Does not change stored values, pagination, selected batch IDs or API queries.
 */
export function matchesImportHistory(query: string, fields: readonly string[]): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const visibleFields = fields.map(value => value.toLowerCase());
  return terms.every(term => visibleFields.some(value => value.includes(term)));
}
