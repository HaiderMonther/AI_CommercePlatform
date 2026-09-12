const ARABIC_DIACRITICS = /[ً-ْٰ]/g;

/**
 * URL-safe slug generator that keeps Arabic letters intact instead of stripping them,
 * so an Arabic company name still produces a readable slug.
 */
export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(ARABIC_DIACRITICS, '')
    .replace(/[آأإ]/g, 'ا')
    .replace(/[^a-z0-9؀-ۿ]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function randomSuffix(length = 4): string {
  return Math.random()
    .toString(36)
    .slice(2, 2 + length);
}
