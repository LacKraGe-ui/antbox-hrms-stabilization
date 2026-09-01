import { loadDotenv } from '../src/config/loadDotenv.js';
loadDotenv();
import { runPreflight } from '../src/preflight/preflight.js';

/**
 * CLI wrapper used as a pre-deploy gate:  `npm run preflight`
 *
 * Exit code 0 → safe to start / deploy.
 * Exit code 1 → HALT. Something would cause damage if we proceeded.
 *
 * Wire this into your pipeline as a required step before the release:
 *   `npm run preflight && npm start`
 */
const result = runPreflight();

const bar = '─'.repeat(52);
console.log(bar);
console.log('  AntBox HRMS — pre-deployment preflight');
console.log(bar);
for (const check of result.checks) {
  const mark = check.ok ? '✓' : '✗';
  console.log(`  ${mark}  ${check.name.padEnd(14)} ${check.detail}`);
}
console.log(bar);

if (result.ok) {
  console.log('  RESULT: PASS — safe to deploy.\n');
  process.exit(0);
} else {
  console.error('  RESULT: FAIL — deployment halted. Fix the above first.\n');
  process.exit(1);
}
