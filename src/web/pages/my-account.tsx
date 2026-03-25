import { useState } from "react";

interface CookieSet {
  id: string;
  label: string;
  AWSALB: string;
  AWSALBCORS: string;
  JSESSIONID: string;
}

interface Deal {
  dealUsid: string;
  productUsid: string;
  productName: string;
  productType: string;
  counterpartName: string;
  price: string;
  remainderDays: number;
  endDateTime: string;
  dealStatus: string;
  dealStatusName: string;
  productKeepAcctYn?: boolean;
  keepAcct?: string;
}

interface AccountData {
  borrowerDeals: Deal[];
  lenderDeals: Deal[];
  totalBorrower: number;
  totalLender: number;
}

interface ResultState {
  loading: boolean;
  data: AccountData | null;
  error: string | null;
  code?: string;
}

const STORAGE_KEY = 'graytag_cookies_v2';
const load = (): CookieSet[] => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; } };
const save = (cs: CookieSet[]) => localStorage.setItem(STORAGE_KEY, JSON.stringify(cs));

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  OnSale:                   { label: '판매 중',    color: '#059669', bg: '#ECFDF5' },
  Using:                    { label: '이용 중',    color: '#7C3AED', bg: '#F5F3FF' },
  UsingNearExpiration:      { label: '만료 임박',  color: '#D97706', bg: '#FFFBEB' },
  Delivered:                { label: '전달 완료',  color: '#2563EB', bg: '#EFF6FF' },
  Delivering:               { label: '전달 중',   color: '#0891B2', bg: '#ECFEFF' },
  Reserved:                 { label: '예약됨',    color: '#6366F1', bg: '#EEF2FF' },
  LendingAcceptanceWaiting: { label: '수락 대기',  color: '#D97706', bg: '#FFFBEB' },
  NormalFinished:           { label: '완료',      color: '#6B7280', bg: '#F3F4F6' },
  CancelByNoShow:           { label: '취소됨',    color: '#EF4444', bg: '#FFF0F0' },
  FinishedByBorrowerRequest:{ label: '중도 종료',  color: '#9CA3AF', bg: '#F9FAFB' },
  FinishedByLenderRequest:  { label: '중도 종료',  color: '#9CA3AF', bg: '#F9FAFB' },
};

function badge(status: string, name: string) {
  return STATUS_MAP[status] || { label: name || status, color: '#6B7280', bg: '#F3F4F6' };
}

export default function MyAccountPage() {
  const [cookies, setCookies] = useState<CookieSet[]>(load);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ label: '', AWSALB: '', AWSALBCORS: '', JSESSIONID: '' });
  const [jsonInput, setJsonInput] = useState('');
  const [inputMode, setInputMode] = useState<'json' | 'manual'>('json');
  const [results, setResults] = useState<Record<string, ResultState>>({});
  const [tabs, setTabs] = useState<Record<string, 'borrower' | 'lender'>>({});

  const addCookie = () => {
    if (!form.JSESSIONID.trim()) return;
    const c: CookieSet = {
      id: Date.now().toString(),
      label: form.label || `계정 ${cookies.length + 1}`,
      AWSALB: form.AWSALB.trim(),
      AWSALBCORS: form.AWSALBCORS.trim(),
      JSESSIONID: form.JSESSIONID.trim(),
    };
    const next = [...cookies, c];
    setCookies(next); save(next);
    setForm({ label: '', AWSALB: '', AWSALBCORS: '', JSESSIONID: '' });
    setJsonInput(''); setShowAdd(false);
  };

  const parseJson = () => {
    try {
      const arr = jsonInput.trim().startsWith('[') ? JSON.parse(jsonInput) : [JSON.parse(jsonInput)];
      const m: Record<string, string> = {};
      arr.forEach((x: any) => { if (x.name && x.value) m[x.name] = x.value; });
      if (!m['JSESSIONID']) return alert('JSESSIONID를 찾을 수 없어요');
      setForm(f => ({ ...f, AWSALB: m['AWSALB'] || '', AWSALBCORS: m['AWSALBCORS'] || '', JSESSIONID: m['JSESSIONID'] }));
    } catch { alert('JSON 형식이 올바르지 않아요'); }
  };

  const del = (id: string) => {
    const next = cookies.filter(c => c.id !== id);
    setCookies(next); save(next);
    setResults(r => { const n = { ...r }; delete n[id]; return n; });
  };

  const query = async (cs: CookieSet) => {
    setResults(r => ({ ...r, [cs.id]: { loading: true, data: null, error: null } }));
    setTabs(t => ({ ...t, [cs.id]: 'lender' }));
    try {
      const res = await fetch('/api/my/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ AWSALB: cs.AWSALB, AWSALBCORS: cs.AWSALBCORS, JSESSIONID: cs.JSESSIONID }),
      });
      const json = await res.json() as any;
      if (!res.ok) setResults(r => ({ ...r, [cs.id]: { loading: false, data: null, error: json.error, code: json.code } }));
      else setResults(r => ({ ...r, [cs.id]: { loading: false, data: json, error: null } }));
    } catch (e: any) {
      setResults(r => ({ ...r, [cs.id]: { loading: false, data: null, error: e.message } }));
    }
  };

  return (
    <div style={{ padding: '20px 16px 0' }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1E1B4B', margin: 0 }}>👤 내 계정</h1>
          <p style={{ fontSize: 12, color: '#9CA3AF', margin: '4px 0 0' }}>쿠키 기반 파티 거래 조회</p>
        </div>
        <button onClick={() => setShowAdd(v => !v)} style={btn('#A78BFA', '#fff', '8px 16px')}>
          {showAdd ? '닫기' : '+ 추가'}
        </button>
      </div>

      {/* 가이드 */}
      {cookies.length === 0 && !showAdd && (
        <div style={{ background: '#EDE9FE', borderRadius: 16, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#7C3AED', marginBottom: 8 }}>🍪 쿠키 가져오는 방법</div>
          <ol style={{ fontSize: 12, color: '#6B7280', margin: 0, paddingLeft: 18, lineHeight: 2 }}>
            <li>PC Chrome에서 graytag.co.kr 로그인</li>
            <li><b>EditThisCookie</b> 확장 설치 → 아이콘 클릭 → JSON 내보내기</li>
            <li>복사한 JSON을 아래에 붙여넣기</li>
          </ol>
          <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 8 }}>
            또는 F12 → Application → Cookies에서 JSESSIONID, AWSALB, AWSALBCORS 직접 복사
          </div>
        </div>
      )}

      {/* 추가 폼 */}
      {showAdd && (
        <div style={{ background: '#fff', borderRadius: 20, padding: 20, boxShadow: '0 4px 20px rgba(167,139,250,0.15)', border: '1.5px solid #EDE9FE', marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#1E1B4B', marginBottom: 14 }}>계정 추가</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            {(['json', 'manual'] as const).map(m => (
              <button key={m} onClick={() => setInputMode(m)} style={{
                flex: 1, padding: 8, borderRadius: 10, border: 'none', fontFamily: 'inherit',
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
                background: inputMode === m ? '#A78BFA' : '#F3F0FF',
                color: inputMode === m ? '#fff' : '#6B7280',
              }}>
                {m === 'json' ? '📋 JSON 붙여넣기' : '✏️ 직접 입력'}
              </button>
            ))}
          </div>

          <input placeholder="계정 별명 (선택)" value={form.label}
            onChange={e => setForm(f => ({ ...f, label: e.target.value }))} style={inp} />

          {inputMode === 'json' ? (
            <>
              <textarea
                placeholder={'EditThisCookie에서 내보낸 JSON 붙여넣기\n[{"name":"JSESSIONID","value":"..."},{"name":"AWSALB","value":"..."}]'}
                value={jsonInput} onChange={e => setJsonInput(e.target.value)}
                style={{ ...inp, height: 110, resize: 'vertical', fontFamily: 'monospace', fontSize: 11 }}
              />
              <button onClick={parseJson} style={{ ...btn('#EDE9FE', '#7C3AED', '10px'), width: '100%', marginBottom: 8 }}>
                JSON 파싱하기
              </button>
              {form.JSESSIONID && (
                <div style={{ background: '#F0FDF4', borderRadius: 10, padding: '10px 12px', marginBottom: 8, fontSize: 12 }}>
                  <span style={{ color: '#059669', fontWeight: 700 }}>✓ 파싱 완료</span>
                  <span style={{ color: '#9CA3AF', marginLeft: 8 }}>JSESSIONID: {form.JSESSIONID.slice(0, 20)}...</span>
                </div>
              )}
            </>
          ) : (
            <>
              <input placeholder="JSESSIONID *" value={form.JSESSIONID}
                onChange={e => setForm(f => ({ ...f, JSESSIONID: e.target.value }))} style={inp} />
              <input placeholder="AWSALB (선택)" value={form.AWSALB}
                onChange={e => setForm(f => ({ ...f, AWSALB: e.target.value }))} style={inp} />
              <input placeholder="AWSALBCORS (선택)" value={form.AWSALBCORS}
                onChange={e => setForm(f => ({ ...f, AWSALBCORS: e.target.value }))} style={inp} />
            </>
          )}

          <button onClick={addCookie} disabled={!form.JSESSIONID.trim()} style={{
            width: '100%', padding: 13, borderRadius: 12, border: 'none', fontFamily: 'inherit',
            background: form.JSESSIONID ? '#A78BFA' : '#E9E4FF',
            color: form.JSESSIONID ? '#fff' : '#9CA3AF',
            fontWeight: 700, fontSize: 14, cursor: form.JSESSIONID ? 'pointer' : 'not-allowed',
          }}>
            계정 저장
          </button>
        </div>
      )}

      {/* 계정 없음 */}
      {cookies.length === 0 && !showAdd && (
        <div style={{ background: '#fff', borderRadius: 16, padding: '40px 20px', textAlign: 'center', color: '#9CA3AF' }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>🔐</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>저장된 계정이 없어요</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>위의 + 추가를 눌러 등록하세요</div>
        </div>
      )}

      {/* 계정 카드 목록 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {cookies.map(cs => {
          const r = results[cs.id];
          const tab = tabs[cs.id] || 'lender';
          const deals = tab === 'borrower' ? r?.data?.borrowerDeals : r?.data?.lenderDeals;
          const total = tab === 'borrower' ? r?.data?.totalBorrower : r?.data?.totalLender;

          return (
            <div key={cs.id} style={{
              background: '#fff', borderRadius: 16,
              boxShadow: '0 2px 12px rgba(167,139,250,0.08)',
              border: `1.5px solid ${r?.data ? '#A78BFA' : '#F3F0FF'}`,
              overflow: 'hidden',
            }}>
              {/* 헤더 */}
              <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: '#EDE9FE', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>🍪</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#1E1B4B' }}>{cs.label}</div>
                  <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>{cs.JSESSIONID.slice(0, 18)}...</div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button onClick={() => query(cs)} disabled={r?.loading} style={{ ...btn('#EDE9FE', '#7C3AED', '6px 12px'), fontSize: 12, opacity: r?.loading ? 0.6 : 1 }}>
                    {r?.loading ? '조회중..' : '조회'}
                  </button>
                  <button onClick={() => del(cs.id)} style={{ ...btn('#FFF0F0', '#EF4444', '6px 10px'), fontSize: 12 }}>삭제</button>
                </div>
              </div>

              {/* 결과 영역 */}
              {r && (
                <div style={{ borderTop: '1px solid #F3F0FF' }}>
                  {r.loading && <div style={{ padding: 16, textAlign: 'center', color: '#A78BFA', fontSize: 13 }}>⏳ 파티 거래 조회 중...</div>}

                  {r.error && (
                    <div style={{ padding: '12px 16px' }}>
                      <div style={{ background: '#FFF0F0', borderRadius: 12, padding: '12px 14px' }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#EF4444', marginBottom: 4 }}>
                          {r.code === 'COOKIE_EXPIRED' ? '🔑 쿠키 만료' : '⚠️ 오류'}
                        </div>
                        <div style={{ fontSize: 12, color: '#6B7280', lineHeight: 1.6 }}>{r.error}</div>
                        {r.code === 'COOKIE_EXPIRED' && (
                          <a href="https://graytag.co.kr/login" target="_blank" rel="noreferrer"
                            style={{ display: 'inline-block', marginTop: 8, fontSize: 12, color: '#7C3AED', fontWeight: 600 }}>
                            → graytag.co.kr 로그인
                          </a>
                        )}
                      </div>
                    </div>
                  )}

                  {!r.loading && !r.error && r.data && (
                    <div style={{ padding: '12px 16px' }}>
                      {/* 탭 */}
                      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                        {(['lender', 'borrower'] as const).map(t => (
                          <button key={t} onClick={() => setTabs(v => ({ ...v, [cs.id]: t }))} style={{
                            flex: 1, padding: '8px', borderRadius: 10, border: 'none', fontFamily: 'inherit',
                            fontSize: 12, fontWeight: 600, cursor: 'pointer',
                            background: tab === t ? '#A78BFA' : '#F3F0FF',
                            color: tab === t ? '#fff' : '#6B7280',
                          }}>
                            {t === 'lender'
                              ? `📦 판매한 파티 (${r.data!.totalLender})`
                              : `🛒 구매한 파티 (${r.data!.totalBorrower})`}
                          </button>
                        ))}
                      </div>

                      {/* 딜 목록 */}
                      {(!deals || deals.length === 0) ? (
                        <div style={{ textAlign: 'center', padding: '20px 0', color: '#9CA3AF', fontSize: 13 }}>
                          진행 중인 {tab === 'lender' ? '판매' : '구매'} 거래가 없어요
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {deals.map((d: Deal) => {
                            const b = badge(d.dealStatus, d.dealStatusName);
                            return (
                              <div key={d.dealUsid} style={{ background: '#F8F6FF', borderRadius: 12, padding: '12px 14px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 13, fontWeight: 700, color: '#1E1B4B' }}>
                                      {d.productType}
                                    </div>
                                    {d.productName && (
                                      <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {d.productName}
                                      </div>
                                    )}
                                    <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>
                                      {tab === 'lender' ? '파티원' : '파티장'}: {d.counterpartName || '미확인'}
                                      {d.remainderDays > 0 && <span> · {d.remainderDays}일 남음</span>}
                                    </div>
                                  </div>
                                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                    <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 600, color: b.color, background: b.bg, borderRadius: 6, padding: '3px 8px', marginBottom: 4 }}>
                                      {b.label}
                                    </span>
                                    <div style={{ fontSize: 14, fontWeight: 700, color: '#A78BFA' }}>{d.price}</div>
                                  </div>
                                </div>
                                {d.endDateTime && (
                                  <div style={{ fontSize: 11, color: '#C4B5FD', marginTop: 6 }}>
                                    만료: {new Date(d.endDateTime).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ height: 20 }} />
    </div>
  );
}

const btn = (bg: string, color: string, padding: string): React.CSSProperties => ({
  background: bg, border: 'none', borderRadius: 10, color, fontWeight: 600,
  fontFamily: 'inherit', cursor: 'pointer', padding,
});

const inp: React.CSSProperties = {
  width: '100%', padding: '11px 14px', borderRadius: 10, border: '1.5px solid #EDE9FE',
  fontSize: 13, color: '#1E1B4B', background: '#F8F6FF', outline: 'none',
  fontFamily: 'inherit', marginBottom: 8, boxSizing: 'border-box',
};
