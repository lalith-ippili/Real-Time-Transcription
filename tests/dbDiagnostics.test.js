import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diagnoseDbError, isConnectionError } from '../src/utils/dbDiagnostics.js';

const DIRECT = 'postgresql://postgres:pw@db.abcd.supabase.co:5432/postgres';
const POOLER = 'postgresql://postgres.abcd:pw@aws-0-ap-south-1.pooler.supabase.com:5432/postgres';

test('explains the IPv6-only direct Supabase host', () => {
  const err = Object.assign(new Error('connect ENETUNREACH 2a05::1:5432'), { code: 'ENETUNREACH' });
  assert.equal(diagnoseDbError(err, DIRECT).reason, 'ipv6_only_host');
  assert.equal(isConnectionError(err), true);
});

test('recognises auth, pooler-user, timeout and missing config problems', () => {
  assert.equal(diagnoseDbError({ code: '28P01', message: 'password authentication failed' }, POOLER).reason, 'auth_failed');
  assert.equal(diagnoseDbError(new Error('Tenant or user not found'), POOLER).reason, 'pooler_user');
  assert.equal(diagnoseDbError(new Error('Connection terminated due to connection timeout'), POOLER).reason, 'timeout');
  assert.equal(diagnoseDbError(new Error('x'), '').reason, 'not_configured');
  assert.equal(diagnoseDbError(new Error('x'), 'postgresql://postgres:[YOUR-PASSWORD]@h/db').reason, 'placeholder_password');
});

test('hints never contain the connection string', () => {
  const { hint } = diagnoseDbError({ code: '28P01', message: 'password authentication failed' }, POOLER);
  assert.ok(!hint.includes('pw@'));
});
