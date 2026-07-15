import assert from 'node:assert/strict';
import test from 'node:test';

import { resolvePostgresConfig } from '../src/api/email/database-config.ts';

test('DATABASE_URL takes precedence over discrete PostgreSQL settings', () => {
  const config = resolvePostgresConfig({
    DATABASE_URL: 'postgresql://example.invalid/app',
    PGHOST: 'ignored.invalid',
    PGPORT: '9999',
    PGDATABASE: 'ignored',
    PGUSER: 'ignored',
    PGPASSWORD: 'placeholder-not-a-secret',
  });

  assert.deepEqual(config, {
    connectionString: 'postgresql://example.invalid/app',
  });
});

test('uses complete discrete PostgreSQL settings when DATABASE_URL is absent', () => {
  const config = resolvePostgresConfig({
    PGHOST: 'db.internal',
    PGPORT: '5433',
    PGDATABASE: 'appdb',
    PGUSER: 'appuser',
    PGPASSWORD: 'placeholder-not-a-secret',
  });

  assert.deepEqual(config, {
    host: 'db.internal',
    port: 5433,
    database: 'appdb',
    user: 'appuser',
    password: 'placeholder-not-a-secret',
  });
});

test('fails closed when neither DATABASE_URL nor all discrete settings are present', () => {
  const passwordMarker = 'password-value-marker';

  assert.throws(
    () => resolvePostgresConfig({
      PGPORT: '5432',
      PGDATABASE: 'appdb',
      PGUSER: 'appuser',
      PGPASSWORD: passwordMarker,
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, 'Missing required PostgreSQL configuration: PGHOST');
      assert.doesNotMatch(error.message, new RegExp(passwordMarker));
      return true;
    },
  );
});

test('rejects an invalid PGPORT without echoing configuration values', () => {
  assert.throws(
    () => resolvePostgresConfig({
      PGHOST: 'db.internal',
      PGPORT: 'not-a-port',
      PGDATABASE: 'appdb',
      PGUSER: 'appuser',
      PGPASSWORD: 'password-value-marker',
    }),
    { message: 'PGPORT must be an integer between 1 and 65535' },
  );
});
