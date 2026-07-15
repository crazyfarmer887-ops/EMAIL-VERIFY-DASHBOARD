import assert from 'node:assert/strict';
import test from 'node:test';
import { filterBlockedEmails, isBlockedEmailContent, blockedEmailResponseBody } from '../src/lib/email-blocklist.ts';

const safeEmail = {
  uid: 1,
  subject: '인증 코드 안내',
  text_body: '로그인 인증번호는 123456 입니다.',
  html: '<p>로그인 인증번호</p>',
};

const blockedEmail = {
  uid: 2,
  subject: '계정 정보 변경 요청',
  text_body: '고객님의 계정 정보 변경 요청을 처리하려면 아래 링크를 누르세요.',
  html: '<p>계정 정보 변경 요청</p>',
};

test('blocks emails when account-info-change keywords appear in the subject', () => {
  const result = isBlockedEmailContent({ subject: '계정 정보 변경 요청 접수' });
  assert.equal(result.blocked, true);
  assert.equal(result.reason, 'account-info-change-request');
});

test('blocks password reset request keywords', () => {
  assert.equal(isBlockedEmailContent({ subject: '비밀번호 재설정 요청' }).blocked, true);
  assert.equal(isBlockedEmailContent({ subject: 'Reset your password' }).blocked, true);
});

test('blocks emails when dangerous account-change keywords appear only in body/html', () => {
  const result = isBlockedEmailContent({
    subject: '보안 알림',
    text: '아래 버튼을 눌러 로그인 정보 변경 요청을 완료하세요.',
    html: '<p>이메일 변경 요청</p>',
  });
  assert.equal(result.blocked, true);
});

test('does not block normal verification-code email content', () => {
  const result = isBlockedEmailContent({ subject: '인증 코드 안내', text: '인증번호 123456' });
  assert.equal(result.blocked, false);
});

test('filters blocked rows out of list responses and reports a safe count', () => {
  const result = filterBlockedEmails([safeEmail, blockedEmail] as any);
  assert.deepEqual(result.allowed.map((email: any) => email.uid), [1]);
  assert.equal(result.blockedCount, 1);
});

test('blocked response body does not echo subject body or sensitive text', () => {
  const body = blockedEmailResponseBody();
  assert.equal(body.blocked, true);
  assert.equal(body.restricted, true);
  assert.equal(body.warning, '계정 정보 이메일 확인되었습니다. 변경하지 마세요!');
  assert.equal(body.html, null);
  assert.equal(body.text, null);
  assert.deepEqual(body.extractedAuth.codes, []);
  assert.deepEqual(body.extractedAuth.links, []);
  assert.equal(JSON.stringify(body).includes('계정 정보 변경 요청'), false);
});
