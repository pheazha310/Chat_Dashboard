/**
 * Runs before every test file (vitest `setupFiles`). Tests expect the synthetic directory, whatever the developer's
 * backend/.env says: dotenv never overrides a variable that is already set, so pinning it here wins.
 */
process.env.BACKEND1_MODE = "dev";
