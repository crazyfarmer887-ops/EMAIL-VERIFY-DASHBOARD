import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), 'utf8');

test('shared UI primitives exist for email dashboard pages', () => {
  for (const file of [
    'src/web/components/ui/page-shell.tsx',
    'src/web/components/ui/card.tsx',
    'src/web/components/ui/status-badge.tsx',
    'src/web/components/ui/empty-state.tsx',
  ]) {
    assert.equal(existsSync(join(root, file)), true, `${file} should exist`);
  }
});

test('global tokens include semantic email dashboard states', () => {
  const css = read('src/web/styles.css');
  for (const token of ['--success', '--warning', '--danger', '--info', '--surface-raised', '--text-muted']) {
    assert.match(css, new RegExp(token.replace('--', '--')), `${token} token should exist`);
  }
});

test('mailbox, pin detail, and admin screens expose clearer states', () => {
  const mailList = read('src/web/pages/mail-list.tsx');
  const mailDetail = read('src/web/pages/mail-detail.tsx');
  const admin = read('src/web/pages/admin.tsx');
  assert.match(mailList, /최근 10분/);
  assert.match(mailList, /잠금 필요/);
  assert.match(mailDetail, /이 별칭만 30분/);
  assert.match(admin, /Gmail sync/);
  assert.match(admin, /관리자 세션/);
});
