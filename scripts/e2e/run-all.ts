/**
 * ChainStrike E2E Full Suite Runner (AMM)
 * Runs all 7 AMM tests in sequence and reports pass/fail per test.
 *
 * Run: npx ts-node --esm scripts/e2e/run-all.ts
 * Run clean: npx ts-node --esm scripts/e2e/run-all.ts --clean
 * Resume from test: npx ts-node --esm scripts/e2e/run-all.ts --from=03
 *
 * Individual tests:
 *   npx ts-node --esm scripts/e2e/00-health-check.ts
 *   npx ts-node --esm scripts/e2e/01-issuer-flow.ts
 *   npx ts-node --esm scripts/e2e/02-admin-approval.ts
 *   npx ts-node --esm scripts/e2e/03-activate-and-pool.ts
 *   npx ts-node --esm scripts/e2e/04-swap-buy.ts
 *   npx ts-node --esm scripts/e2e/05-swap-sell.ts
 *   npx ts-node --esm scripts/e2e/06-price-history.ts
 */

import { spawnSync } from 'child_process';
import path from 'path';
import { existsSync, unlinkSync } from 'fs';

const STATE_FILE = path.resolve('scripts/e2e/.state.json');

const TESTS = [
  { id: '00', name: 'Health Check',                file: '00-health-check.ts' },
  { id: '01', name: 'Issuer Flow',                 file: '01-issuer-flow.ts' },
  { id: '02', name: 'Admin Approval + ASA Deploy', file: '02-admin-approval.ts' },
  { id: '03', name: 'Activate + Tinyman Pool',     file: '03-activate-and-pool.ts' },
  { id: '04', name: 'Swap Buy (AMM)',               file: '04-swap-buy.ts' },
  { id: '05', name: 'Swap Sell (AMM)',              file: '05-swap-sell.ts' },
  { id: '06', name: 'Price History',               file: '06-price-history.ts' },
];

interface TestResult {
  id: string;
  name: string;
  passed: boolean;
  durationMs: number;
  output?: string;
  error?: string;
}

function runTest(file: string): { passed: boolean; durationMs: number; output: string; error?: string } {
  const start = Date.now();
  const result = spawnSync(
    'npx', ['ts-node', '--esm', path.join('scripts/e2e', file)],
    { encoding: 'utf8', shell: true, timeout: 300_000 },
  );
  const durationMs = Date.now() - start;
  const passed = result.status === 0;
  const output = result.stdout ?? '';
  const error = result.stderr ?? '';

  return { passed, durationMs, output, error: passed ? undefined : error };
}

function printSummary(results: TestResult[]) {
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = total - passed;

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║         ChainStrike E2E (AMM) — Final Report             ║');
  console.log('╠══════════════════════════════════════════════════════════╣');

  for (const r of results) {
    const icon = r.passed ? '✅' : '❌';
    const dur = `${(r.durationMs / 1000).toFixed(1)}s`;
    console.log(`║  ${icon} ${r.id}: ${r.name.padEnd(35)} ${dur.padStart(6)}  ║`);
  }

  console.log('╠══════════════════════════════════════════════════════════╣');
  const summary = `║  Passed: ${passed}/${total}  ${failed === 0 ? '🎉 All tests passed!' : `❌ ${failed} test(s) failed`}`;
  console.log(summary.padEnd(59) + '║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  if (failed > 0) {
    console.log('Failed tests:\n');
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`  ❌ ${r.id}: ${r.name}`);
      if (r.error) {
        console.log(r.error.split('\n').slice(0, 10).map((l) => `     ${l}`).join('\n'));
      }
      console.log('');
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const cleanRun = args.includes('--clean');
  const startFrom = args.find((a) => a.startsWith('--from='))?.split('=')[1] ?? '00';

  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   ChainStrike E2E Suite (AMM) — Full Run          ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  if (cleanRun && existsSync(STATE_FILE)) {
    unlinkSync(STATE_FILE);
    console.log('🧹 Cleaned state file\n');
  }

  const testsToRun = TESTS.filter((t) => t.id >= startFrom);
  console.log(`Running ${testsToRun.length} test(s) starting from ${startFrom}…\n`);

  const results: TestResult[] = [];

  for (const test of testsToRun) {
    process.stdout.write(`▶ Running ${test.id}: ${test.name}… `);
    const { passed, durationMs, output, error } = runTest(test.file);

    const icon = passed ? '✅' : '❌';
    console.log(`${icon} (${(durationMs / 1000).toFixed(1)}s)`);

    if (!passed) {
      const lines = output.split('\n').filter(Boolean);
      for (const line of lines.slice(0, 30)) {
        console.log(`  ${line}`);
      }
      if (error) {
        const errLines = error.split('\n').filter(Boolean).slice(0, 10);
        for (const line of errLines) {
          console.error(`  ${line}`);
        }
      }
    }

    results.push({ id: test.id, name: test.name, passed, durationMs, output, error });

    if (!passed) {
      console.log('\n⛔ Stopping suite after first failure. Fix the issue and re-run:\n');
      console.log(`  npx ts-node --esm scripts/e2e/${test.file}\n`);
      const nextIdx = TESTS.findIndex((t) => t.id === test.id) + 1;
      if (nextIdx < TESTS.length) {
        console.log(`Or resume from next test:\n`);
        console.log(`  npx ts-node --esm scripts/e2e/run-all.ts --from=${TESTS[nextIdx].id}\n`);
      }
      break;
    }
  }

  printSummary(results);

  const allPassed = results.every((r) => r.passed);
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error('Suite runner crashed:', err.message);
  process.exit(1);
});
