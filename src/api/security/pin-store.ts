import { randomBytes, scrypt as nodeScrypt, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, open, readFile, rename } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';

const scrypt = (password: string, salt: Buffer, keyLength: number, options: { N: number; r: number; p: number; maxmem: number }) =>
  new Promise<Buffer>((resolve, reject) => {
    nodeScrypt(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;

type LegacyPinRecord = { pin: string; updatedAt?: string };
type HashedPinRecord = { hash: string; updatedAt: string };
type PinRecord = LegacyPinRecord | HashedPinRecord;
type PinRecords = Record<string, PinRecord>;
type PinStoreRead = { records: PinRecords; malformed: boolean };

async function encodePin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(pin, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 32 * 1024 * 1024,
  }) as Buffer;
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

async function verifyEncodedPin(encoded: string, pin: string): Promise<boolean> {
  try {
    const parts = encoded.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [n, r, p] = parts.slice(1, 4).map(Number);
    if (n !== SCRYPT_N || r !== SCRYPT_R || p !== SCRYPT_P) return false;
    if (!/^[A-Za-z0-9_-]{22}$/.test(parts[4]) || !/^[A-Za-z0-9_-]{86}$/.test(parts[5])) return false;
    const salt = Buffer.from(parts[4], 'base64url');
    const expected = Buffer.from(parts[5], 'base64url');
    if (salt.length !== 16 || expected.length !== KEY_LENGTH) return false;
    const actual = await scrypt(pin, salt, KEY_LENGTH, {
      N: n,
      r,
      p,
      maxmem: 32 * 1024 * 1024,
    }) as Buffer;
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export class AliasPinStore {
  readonly path: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.path = path;
  }

  private async readRecords(): Promise<PinStoreRead> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { records: {}, malformed: true };
      }
      return { records: parsed as PinRecords, malformed: false };
    } catch (error: any) {
      if (error?.code === 'ENOENT') return { records: {}, malformed: false };
      return { records: {}, malformed: true };
    }
  }

  private serializeWrite(work: () => Promise<void>): Promise<void> {
    const next = this.writeQueue.then(work, work);
    this.writeQueue = next.catch(() => undefined);
    return next;
  }

  private async writeRecords(records: PinRecords): Promise<void> {
    const dir = dirname(this.path);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700);

    const tempPath = join(dir, `.${basename(this.path)}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`);
    const handle = await open(tempPath, 'wx', 0o600);
    try {
      await handle.writeFile(JSON.stringify(records, null, 2), 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tempPath, this.path);
    await chmod(this.path, 0o600);
  }

  protected async persistRecords(records: PinRecords): Promise<void> {
    await this.writeRecords(records);
  }

  async has(aliasId: number | string): Promise<boolean> {
    const { records, malformed } = await this.readRecords();
    return malformed || Object.hasOwn(records, String(aliasId));
  }

  async count(): Promise<number> {
    const { records, malformed } = await this.readRecords();
    return malformed ? Math.max(1, Object.keys(records).length) : Object.keys(records).length;
  }

  async set(aliasId: number | string, pin: string): Promise<void> {
    const hash = await encodePin(pin);
    await this.serializeWrite(async () => {
      const { records, malformed } = await this.readRecords();
      if (malformed) throw new Error('PIN store is malformed');
      records[String(aliasId)] = { hash, updatedAt: new Date().toISOString() };
      await this.persistRecords(records);
    });
  }

  async remove(aliasId: number | string): Promise<void> {
    await this.serializeWrite(async () => {
      const { records, malformed } = await this.readRecords();
      if (malformed) throw new Error('PIN store is malformed');
      delete records[String(aliasId)];
      await this.persistRecords(records);
    });
  }

  async verify(aliasId: number | string, pin: string): Promise<{ configured: boolean; matched: boolean }> {
    const key = String(aliasId);
    const initial = await this.readRecords();
    if (initial.malformed) return { configured: true, matched: false };
    const record = initial.records[key];
    if (!record || typeof record !== 'object') return { configured: false, matched: false };

    if ('hash' in record) {
      if (typeof record.hash !== 'string') return { configured: true, matched: false };
      return { configured: true, matched: await verifyEncodedPin(record.hash, pin) };
    }

    if (!('pin' in record) || typeof record.pin !== 'string') return { configured: true, matched: false };
    if (record.pin !== pin) return { configured: true, matched: false };

    const legacyPin = record.pin;
    const hash = await encodePin(pin);
    try {
      await this.serializeWrite(async () => {
        const { records, malformed } = await this.readRecords();
        if (malformed) throw new Error('PIN store is malformed');
        const current = records[key];
        if (!current || !('pin' in current) || current.pin !== legacyPin) {
          throw new Error('PIN record changed during migration');
        }
        records[key] = { hash, updatedAt: new Date().toISOString() };
        await this.persistRecords(records);
      });
      return { configured: true, matched: true };
    } catch {
      return { configured: true, matched: false };
    }
  }
}
