import { z } from 'zod';

/**
 * Environment contract.
 *
 * The whole point of validating env here (rather than reading
 * `process.env.X` scattered across the codebase) is that the preflight
 * check can import `loadEnv()` and refuse to start when the contract is
 * violated. A missing DATABASE_URL should stop a deploy — not surface as
 * an undefined path three modules deep at 2am.
 */
const EnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  SYNC_TARGET_URL: z.string().min(1, 'SYNC_TARGET_URL is required'),

  JOB_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  JOB_BACKOFF_BASE_MS: z.coerce.number().int().min(1).default(200),
  WORKER_POLL_MS: z.coerce.number().int().min(10).default(250),
});

export type Env = z.infer<typeof EnvSchema>;

export interface EnvResult {
  ok: boolean;
  env?: Env;
  errors: string[];
}

/**
 * Parse and validate the environment. Never throws — returns a structured
 * result so the preflight check can print every problem at once instead of
 * failing on the first missing key.
 */
export function parseEnv(source: NodeJS.ProcessEnv = process.env): EnvResult {
  const parsed = EnvSchema.safeParse(source);
  if (parsed.success) {
    return { ok: true, env: parsed.data, errors: [] };
  }
  const errors = parsed.error.issues.map(
    (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
  );
  return { ok: false, errors };
}

let cached: Env | null = null;

/**
 * Load validated env for application use. Throws if invalid — by the time
 * app code calls this, preflight should already have guaranteed validity,
 * so a throw here is genuinely exceptional.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  const result = parseEnv(source);
  if (!result.ok || !result.env) {
    throw new Error(
      `Invalid environment configuration:\n  - ${result.errors.join('\n  - ')}`,
    );
  }
  cached = result.env;
  return cached;
}

/** Test helper — reset the cached env between test cases. */
export function resetEnvCache(): void {
  cached = null;
}
