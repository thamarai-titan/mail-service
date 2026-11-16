// Scripts run from packages/database; the shared .env lives at the repository root.
for (const path of ['.env', '../../.env']) {
  try {
    process.loadEnvFile(path);
  } catch {
    // Missing file: fall back to the process environment.
  }
}
