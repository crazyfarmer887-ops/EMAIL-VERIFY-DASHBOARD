import assert from 'node:assert/strict';
import test from 'node:test';
import { filterMailAliases } from '../src/web/lib/mail-list-filter.ts';

const aliases = [
  { id: 11, email: 'netflix1.alpha@example.com', note: '가족용 계정' },
  { id: 22, email: 'wavve2.beta@example.com', note: '주말 전용' },
  { id: 33, email: 'netflix3.gamma@example.com', note: null },
];

const displayName = (alias: (typeof aliases)[number]) =>
  alias.email.startsWith('netflix') ? `넷플릭스${alias.id === 11 ? '1' : '3'}` : '티빙+웨이브2';

test('표시명·email·id·note를 대소문자와 앞뒤 공백에 관계없이 검색한다', () => {
  assert.deepEqual(filterMailAliases(aliases, '전체', ' 넷플릭스1 ', displayName), [aliases[0]]);
  assert.deepEqual(filterMailAliases(aliases, '전체', 'BETA@EXAMPLE', displayName), [aliases[1]]);
  assert.deepEqual(filterMailAliases(aliases, '전체', '33', displayName), [aliases[2]]);
  assert.deepEqual(filterMailAliases(aliases, '전체', '가족용', displayName), [aliases[0]]);
});

test('카테고리와 검색어를 AND 조건으로 적용한다', () => {
  assert.deepEqual(filterMailAliases(aliases, '넷플릭스', '3', displayName), [aliases[2]]);
  assert.deepEqual(filterMailAliases(aliases, '넷플릭스', '주말', displayName), []);
});

test('검색어가 비어 있으면 선택한 카테고리 결과를 그대로 반환한다', () => {
  assert.deepEqual(filterMailAliases(aliases, '티빙+웨이브', '   ', displayName), [aliases[1]]);
});
