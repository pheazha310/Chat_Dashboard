/**
 * Escapes `%`, `_` and `\` so user text matches literally in a `contains` filter. Prisma passes `contains` to
 * PostgreSQL as a LIKE pattern without escaping these, so a search for `%` would otherwise match everything.
 */
export const escapeLike = (text: string) => text.replace(/[\\%_]/g, (char) => `\\${char}`);
