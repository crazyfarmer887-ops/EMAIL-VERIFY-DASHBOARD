import test from 'node:test';
import assert from 'node:assert/strict';
import { extractAuthCode } from '../src/lib/auth-code-extractor.ts';

test('extracts Korean numeric auth code from subject and text with high confidence', () => {
  const result = extractAuthCode({
    subject: '[Graytag] 인증 코드 482913',
    text: '로그인을 계속하려면 인증 코드 482913 를 입력하세요.',
  });

  assert.deepEqual(result.codes, ['482913']);
  assert.equal(result.confidence, 'high');
  assert.equal(result.source, 'mixed');
  assert.equal(result.matchedPattern, 'auth-word-before-code');
});

test('extracts English verification code from text', () => {
  const result = extractAuthCode({
    subject: 'Your login code',
    text: 'Your verification code is: 7410. It expires in 10 minutes.',
  });

  assert.deepEqual(result.codes, ['7410']);
  assert.equal(result.confidence, 'high');
  assert.equal(result.source, 'text');
});

test('extracts code and auth URLs from HTML href and visible text', () => {
  const result = extractAuthCode({
    html: '<p>Security code: <b>889900</b></p><a href="https://example.com/verify?ticket=abc">Verify account</a> https://accounts.example.test/auth/confirm?ticket=abc',
  });

  assert.deepEqual(result.codes, ['889900']);
  assert.deepEqual(result.links, [
    'https://example.com/verify?ticket=abc',
    'https://accounts.example.test/auth/confirm?ticket=abc',
  ]);
  assert.equal(result.confidence, 'high');
  assert.equal(result.source, 'html');
});

test('prefers nearby auth words and ignores years prices and long order IDs', () => {
  const result = extractAuthCode({
    subject: 'Invoice 2026 order 123456789012',
    text: '2026년 결제 금액은 12,000원입니다. OTP: 654321. 주문번호 9876543210.',
  });

  assert.deepEqual(result.codes, ['654321']);
  assert.equal(result.confidence, 'high');
});

test('returns none for common false positives without auth context', () => {
  const result = extractAuthCode({
    subject: '2026년 4월 이용 요금 안내',
    text: '상품 가격은 12,000원이고 주문번호는 9876543210 입니다. 2026년에 갱신됩니다.',
  });

  assert.deepEqual(result.codes, []);
  assert.deepEqual(result.links, []);
  assert.equal(result.confidence, 'none');
  assert.equal(result.source, 'none');
});
