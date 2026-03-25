import { Hono } from 'hono';
import { cors } from "hono/cors"

const app = new Hono().basePath('api');
app.use(cors({ origin: "*" }));

const CATEGORIES = [
  { key: 'netflix',  label: '넷플릭스',    query: '넷플릭스' },
  { key: 'disney',   label: '디즈니플러스', query: '디즈니플러스' },
  { key: 'youtube',  label: '유튜브',      query: '유튜브' },
  { key: 'watcha',   label: '왓챠플레이',   query: '왓챠플레이' },
  { key: 'wavve',    label: '웨이브',      query: '웨이브' },
  { key: 'laftel',   label: '라프텔',      query: '라프텔' },
  { key: 'tving',    label: '티빙',        query: '티빙' },
  { key: 'coupang',  label: '쿠팡플레이',   query: '쿠팡플레이' },
  { key: 'apple',    label: 'AppleOne',   query: 'AppleOne' },
  { key: 'prime',    label: '프라임비디오', query: '프라임비디오' },
];

const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/javascript, */*; q=0.01',
  'X-Requested-With': 'XMLHttpRequest',
};

async function safeJson(resp: Response) {
  if (resp.status === 302 || resp.status === 301) return { ok: false, redirect: true };
  const ct = resp.headers.get('content-type') || '';
  const text = await resp.text();
  if (!ct.includes('json') && !ct.includes('javascript')) return { ok: false, html: text.slice(0, 200) };
  try { return { ok: true, data: JSON.parse(text) }; }
  catch { return { ok: false, html: text.slice(0, 200) }; }
}

// 가격 조회 - 카테고리별 Top10
app.get('/prices/:category', async (c) => {
  const { category } = c.req.param();
  const cat = CATEGORIES.find(c => c.key === category);
  if (!cat) return c.json({ error: '알 수 없는 카테고리' }, 400);
  try {
    const url = `https://graytag.co.kr/ws/product/findProducts?productAvailable=OnSale&sorting=PricePerDay&productCategory=${encodeURIComponent(cat.query)}&page=1&rows=10`;
    const resp = await fetch(url, { headers: { ...BASE_HEADERS, Referer: 'https://graytag.co.kr/home' } });
    const r = await safeJson(resp);
    if (!r.ok || !r.data?.succeeded) return c.json({ error: '조회 실패' }, 500);
    const products = (r.data.data?.products || []).map((p: any, i: number) => ({
      rank: i + 1, usid: p.usid,
      name: (p.name || '').replace(/&#x[0-9a-fA-F]+;/g, '').replace(/&[a-z]+;/g, '').replace(/\s+/g, ' ').trim(),
      lenderName: p.lenderName, pricePerDay: p.pricePerDay,
      pricePerDayNum: parseInt((p.pricePerDay || '0').replace(/[^0-9]/g, '') || '0'),
      price: p.price, purePrice: p.purePrice, endDate: p.endDate, remainderDays: p.remainderDays, seats: p.netflixSeatCount || 6,
    }));
    return c.json({ category: cat.label, count: r.data.data?.onSaleCount || 0, products, updatedAt: new Date().toISOString() });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// 전체 카테고리 최저가 요약
app.get('/prices', async (c) => {
  const results = await Promise.all(CATEGORIES.map(async (cat) => {
    try {
      const url = `https://graytag.co.kr/ws/product/findProducts?productAvailable=OnSale&sorting=PricePerDay&productCategory=${encodeURIComponent(cat.query)}&page=1&rows=1`;
      const resp = await fetch(url, { headers: { ...BASE_HEADERS, Referer: 'https://graytag.co.kr/home' } });
      const r = await safeJson(resp);
      const p = r.data?.data?.products?.[0];
      return { key: cat.key, label: cat.label, count: r.data?.data?.onSaleCount || 0,
        lowestPricePerDay: p?.pricePerDay || '-', lowestPricePerDayNum: parseInt((p?.pricePerDay || '0').replace(/[^0-9]/g, '') || '0'),
        lowestPrice: p?.price || '-', lenderName: p?.lenderName || '-' };
    } catch { return { key: cat.key, label: cat.label, count: 0, lowestPricePerDay: '-', lowestPricePerDayNum: 0, lowestPrice: '-', lenderName: '-' }; }
  }));
  return c.json({ categories: results, updatedAt: new Date().toISOString() });
});

// 내 계정 파티 조회
app.post('/my/accounts', async (c) => {
  const body = await c.req.json() as any;
  const { AWSALB, AWSALBCORS, JSESSIONID } = body;
  if (!JSESSIONID?.trim()) return c.json({ error: 'JSESSIONID가 필요합니다' }, 400);

  const cookieStr = [AWSALB ? `AWSALB=${AWSALB}` : '', AWSALBCORS ? `AWSALBCORS=${AWSALBCORS}` : '', `JSESSIONID=${JSESSIONID}`].filter(Boolean).join('; ');
  const authedHeaders = (referer: string) => ({ ...BASE_HEADERS, Cookie: cookieStr, Referer: referer });

  const testResp = await fetch('https://graytag.co.kr/ws/borrower/findBorrowerDeals?finishedDealIncluded=false&page=1&rows=1',
    { headers: authedHeaders('https://graytag.co.kr/borrower/deal/list'), redirect: 'manual' });
  if (testResp.status === 302 || testResp.status === 301)
    return c.json({ error: '쿠키가 만료됐어요. graytag.co.kr에서 다시 로그인 후 쿠키를 새로 복사해주세요.', code: 'COOKIE_EXPIRED' }, 401);

  try {
    const [borrowerResp, lenderResp] = await Promise.all([
      fetch('https://graytag.co.kr/ws/borrower/findBorrowerDeals?finishedDealIncluded=false&page=1&rows=50',
        { headers: authedHeaders('https://graytag.co.kr/borrower/deal/list'), redirect: 'manual' }),
      fetch('https://graytag.co.kr/ws/lender/findBeforeUsingLenderDeals?finishedDealIncluded=false&sorting=Latest&page=1&rows=50',
        { headers: authedHeaders('https://graytag.co.kr/lender/deal/list'), redirect: 'manual' }),
    ]);
    const [br, lr] = await Promise.all([safeJson(borrowerResp), safeJson(lenderResp)]);
    const mapDeal = (d: any, role: 'borrower' | 'lender') => ({
      dealUsid: d.dealUsid, productUsid: d.productUsid, productName: d.productName,
      productType: d.productTypeString, counterpartName: role === 'borrower' ? d.lenderName : d.borrowerName,
      price: d.price, remainderDays: d.remainderDays, endDateTime: d.endDateTime,
      dealStatus: d.dealStatus, dealStatusName: role === 'borrower' ? d.borrowerDealStatusName : d.lenderDealStatusName,
    });
    return c.json({
      borrowerDeals: (br.data?.data?.borrowerDeals || []).map((d: any) => mapDeal(d, 'borrower')),
      lenderDeals: (lr.data?.data?.lenderDeals || []).map((d: any) => mapDeal(d, 'lender')),
      totalBorrower: (br.data?.data?.borrowerDeals || []).length,
      totalLender: (lr.data?.data?.lenderDeals || []).length,
    });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// 계정 관리 - 서비스별 > 상품별 > 파티원 + 수입 통계
app.post('/my/management', async (c) => {
  const body = await c.req.json() as any;
  const { AWSALB, AWSALBCORS, JSESSIONID } = body;
  if (!JSESSIONID?.trim()) return c.json({ error: 'JSESSIONID가 필요합니다' }, 400);

  const cookieStr = [AWSALB ? `AWSALB=${AWSALB}` : '', AWSALBCORS ? `AWSALBCORS=${AWSALBCORS}` : '', `JSESSIONID=${JSESSIONID}`].filter(Boolean).join('; ');
  const authedHeaders = (referer: string) => ({ ...BASE_HEADERS, Cookie: cookieStr, Referer: referer });

  // 쿠키 유효성 확인
  const testResp = await fetch('https://graytag.co.kr/ws/borrower/findBorrowerDeals?finishedDealIncluded=false&page=1&rows=1',
    { headers: authedHeaders('https://graytag.co.kr/borrower/deal/list'), redirect: 'manual' });
  if (testResp.status === 302 || testResp.status === 301)
    return c.json({ error: '쿠키가 만료됐어요.', code: 'COOKIE_EXPIRED' }, 401);

  try {
    // 두 API 병렬 호출:
    // - findAfterUsingLenderDeals: 이용중(Using) 파티원 - 핵심 데이터
    // - findBeforeUsingLenderDeals: 판매중/전달중 등 미이용 상태
    const [afterResp, beforeResp] = await Promise.all([
      fetch('https://graytag.co.kr/ws/lender/findAfterUsingLenderDeals?finishedDealIncluded=true&sorting=Latest&page=1&rows=100',
        { headers: authedHeaders('https://graytag.co.kr/lender/deal/listAfterUsing'), redirect: 'manual' }),
      fetch('https://graytag.co.kr/ws/lender/findBeforeUsingLenderDeals?finishedDealIncluded=false&sorting=Latest&page=1&rows=100',
        { headers: authedHeaders('https://graytag.co.kr/lender/deal/list'), redirect: 'manual' }),
    ]);

    const [afterR, beforeR] = await Promise.all([safeJson(afterResp), safeJson(beforeResp)]);

    const afterDeals: any[] = afterR.data?.data?.lenderDeals || [];
    const beforeDeals: any[] = beforeR.data?.data?.lenderDeals || [];

    // 중복 제거 후 합치기 (dealUsid 기준)
    const seenDeals = new Set<string>();
    const allDeals: any[] = [];
    for (const deal of [...afterDeals, ...beforeDeals]) {
      if (!seenDeals.has(deal.dealUsid)) {
        seenDeals.add(deal.dealUsid);
        allDeals.push(deal);
      }
    }

    const ACTIVE_STATUSES = new Set(['Using', 'UsingNearExpiration', 'Delivered', 'Delivering', 'DeliveredAndCheckPrepaid', 'LendingAcceptanceWaiting', 'Reserved', 'OnSale']);
    const USING_STATUSES = new Set(['Using', 'UsingNearExpiration']);
    const SKIP_STATUSES = new Set(['Deleted']);

    type MemberEntry = {
      dealUsid: string;
      name: string | null;
      status: string;
      statusName: string;
      price: string;
      purePrice: number;
      realizedSum: number;
      progressRatio: string;
      startDateTime: string | null;
      endDateTime: string | null;
      remainderDays: number;
      source: 'after' | 'before';
    };

    type AccountEntry = {
      email: string;
      serviceType: string;
      members: MemberEntry[];
      usingCount: number;
      activeCount: number;
      totalSlots: number;
      totalIncome: number;
      totalRealizedIncome: number;
      expiryDate: string | null; // 계정 만료일 (멤버 endDateTime 중 가장 먼 것)
    };

    // email(keepAcct) 기준으로 그룹핑
    const accountMap: Record<string, AccountEntry> = {};

    for (const deal of allDeals) {
      if (SKIP_STATUSES.has(deal.dealStatus)) continue;

      const email = deal.keepAcct?.trim() || '(직접전달)';
      const svc = deal.productTypeString || '기타';
      const key = `${email}__${svc}`; // 같은 이메일이라도 서비스가 다르면 분리

      if (!accountMap[key]) {
        accountMap[key] = {
          email,
          serviceType: svc,
          members: [],
          usingCount: 0,
          activeCount: 0,
          totalSlots: deal.netflixSeatCount || 6,
          totalIncome: 0,
          totalRealizedIncome: 0,
          expiryDate: null,
        };
      }

      const realizedNum = parseInt((deal.realizedSum || '0').replace(/[^0-9]/g, '') || '0');
      const priceNum = parseInt((deal.price || '0').replace(/[^0-9]/g, '') || '0');
      const isActive = ACTIVE_STATUSES.has(deal.dealStatus);
      const isUsing = USING_STATUSES.has(deal.dealStatus);
      const isFromAfter = afterDeals.some(d => d.dealUsid === deal.dealUsid);

      accountMap[key].members.push({
        dealUsid: deal.dealUsid,
        name: deal.borrowerName?.trim() || null,
        status: deal.dealStatus,
        statusName: deal.lenderDealStatusName || deal.dealStatus,
        price: deal.price,
        purePrice: priceNum,
        realizedSum: realizedNum,
        progressRatio: deal.progressRatio || '0%',
        startDateTime: deal.startDateTime,
        endDateTime: deal.endDateTime,
        remainderDays: deal.remainderDays,
        source: isFromAfter ? 'after' : 'before',
      });

      if (isActive) { accountMap[key].activeCount++; accountMap[key].totalIncome += priceNum; }
      if (isUsing) accountMap[key].usingCount++;
      accountMap[key].totalRealizedIncome += realizedNum;

      // 만료일 = 멤버 endDateTime 중 가장 먼 것
      if (deal.endDateTime) {
        const cur = accountMap[key].expiryDate;
        if (!cur || deal.endDateTime > cur) accountMap[key].expiryDate = deal.endDateTime;
      }
      // totalSlots는 가장 큰 값으로 업데이트
      if ((deal.netflixSeatCount || 6) > accountMap[key].totalSlots) {
        accountMap[key].totalSlots = deal.netflixSeatCount || 6;
      }
    }

    // 서비스 타입별로 계정 묶기
    const serviceMap: Record<string, {
      serviceType: string;
      accounts: AccountEntry[];
      totalUsingMembers: number;
      totalActiveMembers: number;
      totalIncome: number;
      totalRealized: number;
    }> = {};

    for (const entry of Object.values(accountMap)) {
      const svc = entry.serviceType;
      if (!serviceMap[svc]) serviceMap[svc] = { serviceType: svc, accounts: [], totalUsingMembers: 0, totalActiveMembers: 0, totalIncome: 0, totalRealized: 0 };
      serviceMap[svc].accounts.push(entry);
      serviceMap[svc].totalUsingMembers += entry.usingCount;
      serviceMap[svc].totalActiveMembers += entry.activeCount;
      serviceMap[svc].totalIncome += entry.totalIncome;
      serviceMap[svc].totalRealized += entry.totalRealizedIncome;
    }

    // 정렬: 서비스는 이용중 많은 순, 계정은 이용중 많은 순
    const services = Object.values(serviceMap)
      .map(s => ({ ...s, accounts: s.accounts.sort((a, b) => b.usingCount - a.usingCount || b.activeCount - a.activeCount) }))
      .sort((a, b) => b.totalUsingMembers - a.totalUsingMembers || b.totalActiveMembers - a.totalActiveMembers);

    return c.json({
      services,
      summary: {
        totalUsingMembers: services.reduce((s, sv) => s + sv.totalUsingMembers, 0),
        totalActiveMembers: services.reduce((s, sv) => s + sv.totalActiveMembers, 0),
        totalIncome: services.reduce((s, sv) => s + sv.totalIncome, 0),
        totalRealized: services.reduce((s, sv) => s + sv.totalRealized, 0),
        totalAccounts: Object.keys(accountMap).length,
      },
      updatedAt: new Date().toISOString(),
    });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// 글 작성 - 상품 등록
app.post('/post/create', async (c) => {
  const body = await c.req.json() as any;
  const { AWSALB, AWSALBCORS, JSESSIONID, productModel } = body;
  if (!JSESSIONID?.trim()) return c.json({ error: 'JSESSIONID가 필요합니다' }, 400);

  const cookieStr = [
    AWSALB ? `AWSALB=${AWSALB}` : '',
    AWSALBCORS ? `AWSALBCORS=${AWSALBCORS}` : '',
    `JSESSIONID=${JSESSIONID}`,
  ].filter(Boolean).join('; ');

  // 쿠키 유효성 확인
  const test = await fetch('https://graytag.co.kr/ws/borrower/findBorrowerDeals?finishedDealIncluded=false&page=1&rows=1', {
    headers: { ...BASE_HEADERS, Cookie: cookieStr, Referer: 'https://graytag.co.kr' }, redirect: 'manual',
  });
  if (test.status === 302 || test.status === 301)
    return c.json({ error: '쿠키가 만료됐어요.', code: 'COOKIE_EXPIRED' }, 401);

  try {
    // multipart/form-data 구성
    const formData = new FormData();
    formData.append('productModel', new Blob([JSON.stringify(productModel)], { type: 'application/json' }));

    const resp = await fetch('https://graytag.co.kr/ws/lender/registerProduct', {
      method: 'POST',
      headers: {
        'Cookie': cookieStr,
        'User-Agent': BASE_HEADERS['User-Agent'],
        'Referer': 'https://graytag.co.kr/lender/product/register/input',
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        // Content-Type은 FormData가 자동 설정
      },
      body: formData,
      redirect: 'manual',
    });

    const r = await safeJson(resp);
    if (!r.ok) return c.json({ error: `등록 실패 (${resp.status})`, detail: r.html }, 500);
    if (!r.data?.succeeded) return c.json({ error: r.data?.message || '등록 실패' }, 400);

    return c.json({ productUsid: r.data.data, ok: true });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// 계정 자동 전달 설정
app.post('/post/keepAcct', async (c) => {
  const body = await c.req.json() as any;
  const { AWSALB, AWSALBCORS, JSESSIONID, productUsid, keepAcct, keepPasswd, keepMemo } = body;
  if (!JSESSIONID?.trim() || !productUsid) return c.json({ error: '필수 파라미터 누락' }, 400);

  const cookieStr = [
    AWSALB ? `AWSALB=${AWSALB}` : '',
    AWSALBCORS ? `AWSALBCORS=${AWSALBCORS}` : '',
    `JSESSIONID=${JSESSIONID}`,
  ].filter(Boolean).join('; ');

  try {
    const payload = {
      productUsid,
      keepAcct: keepAcct?.trim(),
      keepPasswd: keepPasswd?.trim(),
      keepMemo: keepMemo?.trim() || '',
    };

    const resp = await fetch('https://graytag.co.kr/ws/lender/updateProductKeepAcct', {
      method: 'POST',
      headers: {
        ...BASE_HEADERS,
        'Cookie': cookieStr,
        'Referer': `https://graytag.co.kr/lender/product/keepAcctSetting?productUsid=${productUsid}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      redirect: 'manual',
    });

    const r = await safeJson(resp);
    if (!r.ok) return c.json({ error: `계정 설정 실패 (${resp.status})` }, 500);
    if (!r.data?.succeeded) return c.json({ error: r.data?.message || '계정 설정 실패' }, 400);

    return c.json({ ok: true });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

app.get('/ping', (c) => c.json({ ok: true }));
export default app;
