import { readFileSync, existsSync } from 'node:fs';

/**
 * Minimal, dependency-free .env loader. Loads KEY=VALUE lines from a .env
 * file into process.env WITHOUT overriding variables already set in the
 * environment (real env wins over the file, as it should in production).
 *
 * Kept tiny on purpose — a trial shouldn't pull in dotenv for six variables.
 */
export function loadDotenv(path = '.env'): void {
  if (!existsSync(path)) return;
  const content = readFileSync(path, 'utf8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
