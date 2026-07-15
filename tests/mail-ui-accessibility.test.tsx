import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'vitest';
import {
  MailSearchFeedback,
  RestrictedMailRow,
} from '../src/web/components/mail-ui-contracts.tsx';

function renderDom(node: ReactNode): Document {
  return new JSDOM(renderToStaticMarkup(node)).window.document;
}

test('restricted 메일 행은 비활성 상태이며 키보드 탭 순서에서 제외된다', () => {
  const document = renderDom(
    <RestrictedMailRow restricted onOpen={() => { throw new Error('열리면 안 됨'); }}>
      제한된 메일
    </RestrictedMailRow>,
  );
  const row = document.querySelector('button');

  assert.ok(row);
  assert.equal(row.hasAttribute('disabled'), true);
  assert.equal(row.getAttribute('aria-disabled'), 'true');
  assert.equal(row.tabIndex, -1);
});

test('일반 메일 행은 활성 상태와 기본 탭 순서를 유지한다', () => {
  const document = renderDom(
    <RestrictedMailRow restricted={false} onOpen={() => {}}>일반 메일</RestrictedMailRow>,
  );
  const row = document.querySelector('button');

  assert.ok(row);
  assert.equal(row.hasAttribute('disabled'), false);
  assert.equal(row.getAttribute('aria-disabled'), 'false');
  assert.equal(row.tabIndex, 0);
});

test('검색 결과 수는 polite live region으로 렌더링된다', () => {
  const document = renderDom(<MailSearchFeedback count={2} hasQuery />);
  const status = document.querySelector('[role="status"]');

  assert.ok(status);
  assert.equal(status.getAttribute('aria-live'), 'polite');
  assert.equal(status.getAttribute('aria-atomic'), 'true');
  assert.match(status.textContent ?? '', /검색 결과 2개/);
});

test('검색 결과가 없으면 검색 전용 빈 상태를 렌더링한다', () => {
  const document = renderDom(<MailSearchFeedback count={0} hasQuery />);

  assert.match(document.body.textContent ?? '', /검색 조건에 맞는 별칭이 없어요/);
});
