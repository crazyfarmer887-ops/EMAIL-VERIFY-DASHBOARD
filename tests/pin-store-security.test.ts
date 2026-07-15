import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { AliasPinStore } from '../src/api/security/pin-store.ts';

function tempStore() {
  const root = mkdtempSync(join(tmpdir(), 'alias-pin-security-'));
  const path = join(root, 'data', 'alias-pins.json');
  return { root, path, store: new AliasPinStore(path) };
}

describe('AliasPinStore security', () => {
  test('stores a salted scrypt hash with private file and directory permissions', async () => {
    const { path, store } = tempStore();

    await store.set('101', '1234');

    const persisted = JSON.parse(readFileSync(path, 'utf8'));
    expect(persisted['101'].pin).toBeUndefined();
    expect(persisted['101'].hash).toMatch(/^scrypt\$/);
    expect(JSON.stringify(persisted)).not.toContain('1234');
    expect(statSync(join(path, '..')).mode & 0o777).toBe(0o700);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  test('migrates a matching legacy plaintext PIN after successful verification', async () => {
    const { path, store } = tempStore();
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, JSON.stringify({ '101': { pin: '1234', updatedAt: 'legacy' } }));

    await expect(store.verify('101', '1234')).resolves.toEqual({ configured: true, matched: true });

    const persisted = JSON.parse(readFileSync(path, 'utf8'));
    expect(persisted['101'].pin).toBeUndefined();
    expect(persisted['101'].hash).toMatch(/^scrypt\$/);
    await expect(store.verify('101', '1234')).resolves.toEqual({ configured: true, matched: true });
  });

  test('serializes concurrent writes so updates are not lost and removal is atomic', async () => {
    const { path, store } = tempStore();

    await Promise.all([
      store.set('101', '1111'),
      store.set('202', '2222'),
      store.set('303', '3333'),
    ]);
    await store.remove('202');

    const persisted = JSON.parse(readFileSync(path, 'utf8'));
    expect(Object.keys(persisted).sort()).toEqual(['101', '303']);
    await expect(store.verify('101', '1111')).resolves.toEqual({ configured: true, matched: true });
    await expect(store.verify('303', '3333')).resolves.toEqual({ configured: true, matched: true });
  });

  test('fails closed when a stored hash is malformed even if it decodes to matching bytes', async () => {
    const { path, store } = tempStore();
    await store.set('101', '1234');
    const persisted = JSON.parse(readFileSync(path, 'utf8'));
    const parts = persisted['101'].hash.split('$');
    parts[4] += '!';
    persisted['101'].hash = parts.join('$');
    writeFileSync(path, JSON.stringify(persisted));

    await expect(store.verify('101', '1234')).resolves.toEqual({ configured: true, matched: false });
  });

  test('treats malformed JSON as configured and fails closed', async () => {
    const { path, store } = tempStore();
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, '{"101":');

    await expect(store.has('101')).resolves.toBe(true);
    await expect(store.verify('101', '1234')).resolves.toEqual({ configured: true, matched: false });
    await expect(store.count()).resolves.toBe(1);
  });

  test('does not report a legacy match when secure migration persistence fails', async () => {
    const { path } = tempStore();
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, JSON.stringify({ '101': { pin: '1234', updatedAt: 'legacy' } }));

    class MigrationFailingStore extends AliasPinStore {
      protected override async persistRecords(): Promise<void> {
        throw new Error('simulated migration write failure');
      }
    }

    const store = new MigrationFailingStore(path);
    await expect(store.verify('101', '1234')).resolves.toEqual({ configured: true, matched: false });
  });
});
