/** Deterministic UUID for test fixtures: uid(10) is 00000000-0000-4000-8000-000000000010. */
export const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
