/**
 * Seeds initial admin, compliance, issuer, and investor test users.
 * Only runs if users don't already exist.
 *
 * Usage: npx ts-node --esm scripts/seed-admin.ts
 */

import * as dotenv from 'dotenv';
import path from 'path';
import { randomBytes } from 'crypto';
import { Pool } from 'pg';
import argon2 from 'argon2';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// Use pg directly to avoid Prisma client generation dependencies
const pool = new Pool({ connectionString: process.env.IDENTITY_DATABASE_URL });

const USERS = [
  { email: 'admin@chainstrike.io',       password: 'Admin@ChainStrike2024!',      role: 'ADMIN' },
  { email: 'compliance@chainstrike.io',   password: 'Compliance@ChainStrike2024!', role: 'COMPLIANCE_OFFICER' },
  { email: 'issuer@testnet.io',           password: 'Issuer@Test2024!',            role: 'ISSUER' },
  { email: 'investor@testnet.io',         password: 'Investor@Test2024!',          role: 'INVESTOR' },
];

async function main() {
  for (const user of USERS) {
    // Check existing
    const existing = await pool.query(
      'SELECT id FROM identity.users WHERE email = $1',
      [user.email],
    );
    if (existing.rows.length > 0) {
      console.log(`  ℹ  Already exists: ${user.email}`);
      continue;
    }

    const passwordHash = await argon2.hash(user.password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });

    const emailToken = randomBytes(32).toString('hex');

    await pool.query(
      `INSERT INTO identity.users
         (id, email, "passwordHash", "emailVerified", "emailToken", role, status, "mfaEnabled", "createdAt", "updatedAt")
       VALUES
         (gen_random_uuid(), $1, $2, true, $3, $4, 'ACTIVE', false, now(), now())`,
      [user.email, passwordHash, emailToken, user.role],
    );

    console.log(`  ✓  Created ${user.role}: ${user.email}`);
  }

  console.log('\nTestnet credentials:');
  for (const u of USERS) {
    console.log(`  ${u.role.padEnd(20)} ${u.email} / ${u.password}`);
  }
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => pool.end());
