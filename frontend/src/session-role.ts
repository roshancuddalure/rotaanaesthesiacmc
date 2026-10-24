/**
 * The signed-in user's role for modules that cannot import main.ts (UI gating only; the backend
 * enforces every role check). main.ts registers the source once at start-up.
 */
let source: () => string | null | undefined = () => null;

export function setRoleSource(read: () => string | null | undefined): void { source = read; }
export function currentRole(): string | null { return source() ?? null; }
