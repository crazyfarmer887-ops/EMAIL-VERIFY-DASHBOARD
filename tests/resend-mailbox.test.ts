import { test } from 'node:test';
import assert from 'node:assert/strict';
import { disneyCodeRow, netflixCodeRow, createResendMailboxSync } from '../src/api/email/resend-mailbox.ts';
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

test('Netflix code and household mail remain recipient/sender scoped and omit original content',()=>{
 const nf={...mail,from:'Netflix <info@account.netflix.com>',subject:'Your sign-in code',text:'Your sign-in code: 4321',html:'<p>private original account data</p>'};
 const row=netflixCodeRow(nf,'disney@example.com',now)!;assert.ok(row);assert.ok(row.text_body?.includes('4321'));assert.equal(row.html,null);assert.ok(!JSON.stringify(row).includes('private original'));
 assert.ok(netflixCodeRow({...nf,html:'<div>tracking code: 8765</div>'},'disney@example.com',now)?.text_body?.includes('4321'));
 assert.equal(disneyCodeRow(nf,'disney@example.com',now),null);
 for(const patch of [{from:'fake@netflix.com.evil'},{authentication:{dkim:'fail',dmarc:'pass'}},{received_for:['other@example.com']},{to:['other@example.com']},{subject:'Reset your password code'},{text:'password reset code: 4321'},{created_at:new Date(now-16*60000).toISOString()},{text:'code: 4321 code: 8765'}]) assert.equal(netflixCodeRow({...nf,...patch},'disney@example.com',now),null);
 const household={...nf,subject:'Confirm your Netflix Household',text:'Confirm https://www.netflix.com/account/travel/verify?nftoken=fixture-only',html:''};
 assert.ok(netflixCodeRow(household,'disney@example.com',now)?.text_body?.includes('/account/travel/verify'));
 assert.ok(netflixCodeRow({...nf,subject:'이메일 주소를 인증해 주세요',text:'이메일 인증 https://www.netflix.com/verifyemail?nftoken=fixture-only'},'disney@example.com',now));
 for(const url of ['https://www.netflix.com/password?token=fixture','https://www.netflix.com.evil/account/travel/verify?token=fixture','https://www.netflix.com/email?token=fixture']) assert.equal(netflixCodeRow({...household,text:url},'disney@example.com',now),null);
});
test('Netflix allowlist does not admit Disney codes, unlisted recipients or ambiguous service ownership',async()=>{
 let reads=0,writes=0;const nf={...mail,from:'info@account.netflix.com',subject:'Your sign-in code',text:'code: 654321'};
 const sync=createResendMailboxSync({now:()=>now,upsert:async()=>{writes++},fetcher:async()=>{reads++;return new Response(JSON.stringify(reads===1?{data:[nf]}:nf))}});
 await sync('other@example.com',{RESEND_API_KEY:'fixture',RESEND_NETFLIX_MAILBOXES:'disney@example.com'});assert.equal(reads,0);
 await sync('disney@example.com',{RESEND_API_KEY:'fixture',RESEND_NETFLIX_MAILBOXES:'disney@example.com',RESEND_DISNEY_MAILBOXES:'disney@example.com'});assert.equal(reads,0);
 await sync('disney@example.com',{RESEND_API_KEY:'fixture',RESEND_NETFLIX_MAILBOXES:'disney@example.com'});assert.equal(reads,2);assert.equal(writes,1);
});
