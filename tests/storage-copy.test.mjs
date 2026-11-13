import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { copyStorage } from '../scripts/copy-storage.mjs';

test('storage copy duplicates the database and key without deleting the source', () => {
  const from = fs.mkdtempSync(path.join(os.tmpdir(), 'offerbiu-storage-from-'));
  const to = path.join(os.tmpdir(), 'offerbiu-storage-to-' + Date.now());
  fs.writeFileSync(path.join(from, 'offerbiu.sqlite'), 'db');
  fs.writeFileSync(path.join(from, '.encryption-key'), Buffer.alloc(32, 7));
  const copied = copyStorage(from, to);
  assert.deepEqual(copied.copied.sort(), ['.encryption-key', 'offerbiu.sqlite']);
  assert.equal(fs.readFileSync(path.join(from, 'offerbiu.sqlite'), 'utf8'), 'db');
  assert.equal(fs.readFileSync(path.join(to, 'offerbiu.sqlite'), 'utf8'), 'db');
  assert.equal(fs.statSync(path.join(to, '.encryption-key')).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.join(to, 'offerbiu.sqlite')).mode & 0o777, 0o600);
  assert.throws(() => copyStorage(from, to), /已有数据库/);
  fs.rmSync(from, { recursive: true, force: true });
  fs.rmSync(to, { recursive: true, force: true });
});
