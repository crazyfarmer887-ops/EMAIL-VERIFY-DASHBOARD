import { test } from 'node:test';
import assert from 'node:assert/strict';
import { disneyCodeRow, createResendMailboxSync } from '../src/api/email/resend-mailbox.ts';
const now=Date.parse('2026-10-28T08:00:00Z');
const mail={authentication:{dkim:'pass',dmarc:'pass'},received_for:['disney@example.com'],id:'165a03fb-b030-48f6-bd6f-d9113f2e0eae',to:['disney@example.com'],from:'disneyplus@trx.mail2.disneyplus.com',subject:'디즈니+ 인증 코드 123456',text:'인증 코드: 123456',created_at:new Date(now).toISOString()};
test('only fresh exact-recipient Disney authentication codes enter the mailbox; no raw financial content',()=>{
 const row=disneyCodeRow({...mail,html:'<b>private original content</b>'},'disney@example.com',now)!;
 assert.ok(row.uid<0);assert.equal(row.html,null);assert.ok(!JSON.stringify(row).includes('private original'));
 for(const change of [{authentication:{dkim:'fail',dmarc:'fail'}},{received_for:['other@example.com']},{to:['other@example.com']},{from:'fake@disneyplus.com.evil'},{subject:'비밀번호 재설정 코드 123456'},{created_at:'2026-10-27T08:00:00Z'},{subject:'디즈니+에 오신 걸 환영합니다'}]) assert.equal(disneyCodeRow({...mail,...change},'disney@example.com',now),null);
});
test('allowlist, parallel lookup deduplication, no external reads for unknown mailbox, errors are generic',async()=>{
 let reads=0;let writes=0;const sync=createResendMailboxSync({now:()=>now,upsert:async()=>{writes++},fetcher:async()=>{reads++;return new Response(JSON.stringify(reads===1?{data:[mail]}:mail))}});
 const env={RESEND_API_KEY:'fixture-secret',RESEND_DISNEY_MAILBOXES:'disney@example.com'};
 await sync('other@example.com',env);assert.equal(reads,0);
 await Promise.all([sync('disney@example.com',env),sync('disney@example.com',env)]);assert.equal(reads,2);assert.equal(writes,1);
 await sync('disney@example.com',env);assert.equal(reads,2);
});

test('Korean one-time passcodes are recognized without admitting password resets',()=>{assert.ok(disneyCodeRow({...mail,subject:'MyDisney 일회용 암호',text:'일회용 암호: 123456'},'disney@example.com',now));});
