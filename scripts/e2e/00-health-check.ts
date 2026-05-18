/**
 * E2E Test 00 — Health Check
 * Verifies all required services are reachable before running the full E2E suite.
 * Settlement service is optional (not used in AMM flow).
 *
 * Run: npx ts-node --esm scripts/e2e/00-health-check.ts
 */

import axios from 'axios';

const SERVICES = [
  { name: 'API Gateway',        url: 'http://localhost:8080/health',              optional: false },
  { name: 'Identity Service',   url: 'http://localhost:3001/health',              optional: false },
  { name: 'Asset Service',      url: 'http://localhost:3002/health',              optional: false },
  { name: 'Compliance Service', url: 'http://localhost:3004/health',              optional: false },
  { name: 'Settlement Service', url: 'http://localhost:3005/health',              optional: true  },
  { name: 'Issuer App',         url: 'http://localhost:3101',                     optional: true  },
  { name: 'Investor App',       url: 'http://localhost:3000',                     optional: true  },
  { name: 'Admin App',          url: 'http://localhost:3100',                     optional: true  },
];

const GATEWAY = 'http://localhost:8080/api/v1';

interface Result { name: string; ok: boolean; status?: number; error?: string; latencyMs?: number; }

async function checkService(name: string, url: string): Promise<Result> {
  const start = Date.now();
  try {
    const res = await axios.get(url, { timeout: 5000, validateStatus: () => true });
    return { name, ok: res.status < 500, status: res.status, latencyMs: Date.now() - start };
  } catch (err: any) {
    return { name, ok: false, error: err.message, latencyMs: Date.now() - start };
  }
}

async function checkAlgorandNode(): Promise<Result> {
  const start = Date.now();
  try {
    const res = await axios.get('https://testnet-api.algonode.cloud/v2/status', { timeout: 8000 });
    const round = res.data['last-round'];
    return { name: 'Algorand Testnet Node', ok: true, status: 200, latencyMs: Date.now() - start };
  } catch (err: any) {
    return { name: 'Algorand Testnet Node', ok: false, error: err.message };
  }
}

async function checkTinymanApi(): Promise<Result> {
  const start = Date.now();
  try {
    const res = await axios.get('https://testnet.analytics.tinyman.org/api/v1/pools/', {
      timeout: 8000,
      validateStatus: () => true,
    });
    return { name: 'Tinyman Testnet API', ok: res.status < 500, status: res.status, latencyMs: Date.now() - start };
  } catch (err: any) {
    return { name: 'Tinyman Testnet API', ok: false, error: err.message, latencyMs: Date.now() - start };
  }
}

async function checkGatewayRouting(): Promise<Result> {
  try {
    const res = await axios.post(
      `${GATEWAY}/auth/login`,
      { email: 'admin@testnet.io', password: 'Admin@Test2024!' },
      { timeout: 5000, validateStatus: () => true },
    );
    if (res.status === 200 && res.data.accessToken) {
      return { name: 'Gateway → Identity routing', ok: true, status: 200 };
    }
    return { name: 'Gateway → Identity routing', ok: false, status: res.status, error: JSON.stringify(res.data) };
  } catch (err: any) {
    return { name: 'Gateway → Identity routing', ok: false, error: err.message };
  }
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║   ChainStrike E2E — 00: Health Check (AMM)        ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  const results: Result[] = [];

  results.push(await checkAlgorandNode());
  results.push(await checkTinymanApi());

  for (const svc of SERVICES) {
    const r = await checkService(svc.name, svc.url);
    if (svc.optional) r.name = `[optional] ${r.name}`;
    results.push(r);
  }

  results.push(await checkGatewayRouting());

  let allRequired = true;
  for (const r of results) {
    const isOptional = r.name.startsWith('[optional]');
    const icon = r.ok ? '✅' : (isOptional ? '⚠️ ' : '❌');
    const latency = r.latencyMs ? ` (${r.latencyMs}ms)` : '';
    const detail = r.ok ? `HTTP ${r.status ?? 200}` : (r.error ?? `HTTP ${r.status}`);
    console.log(`${icon} ${r.name.padEnd(35)} ${detail}${latency}`);
    if (!r.ok && !isOptional) allRequired = false;
  }

  console.log('');
  if (allRequired) {
    console.log('✅ All required services are healthy. Ready for AMM E2E testing.\n');
    process.exit(0);
  } else {
    console.log('❌ One or more required services are DOWN. Fix them before running E2E tests.\n');
    console.log('Tip: Start services with: npm run dev (from root)\n');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Health check crashed:', err.message);
  process.exit(1);
});
