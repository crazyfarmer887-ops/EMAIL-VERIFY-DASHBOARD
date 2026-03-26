import { useState } from "react";
import { Cookie, Plus, X, Trash2, Search, AlertCircle, ExternalLink, ChevronRight, Loader2, CheckCircle2, KeyRound, ClipboardList, Pencil } from "lucide-react";

interface CookieSet { id: string; label: string; AWSALB: string; AWSALBCORS: string; JSESSIONID: string; }
interface Deal {
  dealUsid: string; productUsid: string; productName: string; productType: string;
  counterpartName: string; price: string; remainderDays: number;
  endDateTime: string; dealStatus: string; dealStatusName: string;
}
interface AccountData { borrowerDeals: Deal[]; lenderDeals: Deal[]; totalBorrower: number; totalLender: number; }
interface ResultState { loading: boolean; data: AccountData | null; error: string | null; code?: string; }

const STORAGE_KEY = 'graytag_cookies_v2';
const load = (): CookieSet[] => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; } };
const save = (cs: CookieSet[]) => localStorage.setItem(STORAGE_KEY, JSON.stringify(cs));

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  OnSale:                   { label: '판매 중',   color: '#059669', bg: '#ECFDF5' },
  Using:                    { label: '이용 중',   color: '#7C3AED', bg: '#F5F3FF' },
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
const badge = (s: string, n: string) => STATUS_MAP[s] || { label: n||s, color: '#6B7280', bg: '#F3F4F6' };

export default function MyAccountPage() {
  const [cookies, setCookies] = useState<CookieSet[]>(load);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ label: '', AWSALB: '', AWSALBCORS: '', JSESSIONID: '' });
  const [jsonInput, setJsonInput] = useState('');
  const [inputMode, setInputMode] = useState<'json'|'manual'>('json');
  const [results, setResults] = useState<Record<string, ResultState>>({});
  const [tabs, setTabs] = useState<Record<string, 'borrower'|'lender'>>({});

  const addCookie = () => {
    if (!form.JSESSIONID.trim()) return;
    const c: CookieSet = { id: Date.now().toString(), label: form.label || `계정 ${cookies.length+1}`, AWSALB: form.AWSALB.trim(), AWSALBCORS: form.AWSALBCORS.trim(), JSESSIONID: form.JSESSIONID.trim() };
    const next = [...cookies, c]; setCookies(next); save(next);
    setForm({ label:'', AWSALB:'', AWSALBCORS:'', JSESSIONID:'' }); setJsonInput(''); setShowAdd(false);
  };

  const parseJson = () => {
    try {
      const arr = jsonInput.trim().startsWith('[') ? JSON.parse(jsonInput) : [JSON.parse(jsonInput)];
      const m: Record<string,string> = {};
      arr.forEach((x: any) => { if (x.name && x.value) m[x.name] = x.value; });
      if (!m['JSESSIONID']) return alert('JSESSIONID를 찾을 수 없어요');
      setForm(f => ({ ...f, AWSALB: m['AWSALB']||'', AWSALBCORS: m['AWSALBCORS']||'', JSESSIONID: m['JSESSIONID'] }));
    } catch { alert('JSON 형식이 올바르지 않아요'); }
  };

  const del = (id: string) => {
    const next = cookies.filter(c => c.id !== id); setCookies(next); save(next);
    setResults(r => { const n={...r}; delete n[id]; return n; });
  };

  const query = async (cs: CookieSet) => {
    setResults(r => ({ ...r, [cs.id]: { loading: true, data: null, error: null } }));
    setTabs(t => ({ ...t, [cs.id]: 'lender' }));
    try {
      const res = await fetch('/api/my/accounts', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ AWSALB:cs.AWSALB, AWSALBCORS:cs.AWSALBCORS, JSESSIONID:cs.JSESSIONID }) });
      const json = await res.json() as any;
      if (!res.ok) setResults(r => ({ ...r, [cs.id]: { loading: false, data: null, error: json.error, code: json.code } }));
      else setResults(r => ({ ...r, [cs.id]: { loading: false, data: json, error: null } }));
    } catch (e: any) { setResults(r => ({ ...r, [cs.id]: { loading: false, data: null, error: e.message } })); }
  };

  return (
    <div style={{ padding: '20px 16px 0' }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1E1B4B', margin: 0 }}>내 계정</h1>
          <p style={{ fontSize: 12, color: '#9CA3AF', margin: '4px 0 0' }}>쿠키 기반 파티 거래 조회</p>
        </div>
        <button onClick={() => setShowAdd(v => !v)} style={{ background: showAdd ? '#EDE9FE' : '#A78BFA', border: 'none', borderRadius: 12, padding: '8px 14px', fontSize: 13, color: showAdd ? '#7C3AED' : '#fff', cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}>
          {showAdd ? <X size={14} /> : <Plus size={14} />} {showAdd ? '닫기' : '추가'}
        </button>
      </div>

      {/* 가이드 */}
      {cookies.length === 0 && !showAdd && (
        <div style={{ background: '#EDE9FE', borderRadius: 16, padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 700, color: '#7C3AED', marginBottom: 8 }}>
            <Cookie size={16} /> 쿠키 가져오는 방법
          </div>
          <ol style={{ fontSize: 12, color: '#6B7280', margin: 0, paddingLeft: 18, lineHeight: 2 }}>
            <li>PC Chrome에서 graytag.co.kr 로그인</li>
            <li><b>EditThisCookie</b> 확장 설치 → JSON 내보내기</li>
            <li>복사한 JSON을 아래에 붙여넣기</li>
          </ol>
          <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 8 }}>또는 F12 → Application → Cookies에서 직접 복사</div>
        </div>
      )}

      {/* 추가 폼 */}
      {showAdd && (
        <div style={{ background: '#fff', borderRadius: 20, padding: 20, boxShadow: '0 4px 20px rgba(167,139,250,0.15)', border: '1.5px solid #EDE9FE', marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#1E1B4B', marginBottom: 14 }}>계정 추가</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            {(['json','manual'] as const).map(m => (
              <button key={m} onClick={() => setInputMode(m)} style={{ flex:1, padding:8, borderRadius:10, border:'none', fontFamily:'inherit', fontSize:12, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:6, background: inputMode===m ? '#A78BFA' : '#F3F0FF', color: inputMode===m ? '#fff' : '#6B7280' }}>
                {m === 'json' ? <><ClipboardList size={13} /> JSON 붙여넣기</> : <><Pencil size={13} /> 직접 입력</>}
              </button>
            ))}
          </div>
          <input placeholder="계정 별명 (선택)" value={form.label} onChange={e => setForm(f=>({...f,label:e.target.value}))} style={inp} />
          {inputMode === 'json' ? (
            <>
              <textarea placeholder={'EditThisCookie JSON 붙여넣기\n[{"name":"JSESSIONID","value":"..."},...]'} value={jsonInput} onChange={e => setJsonInput(e.target.value)} style={{ ...inp, height:110, resize:'vertical', fontFamily:'monospace', fontSize:11 }} />
              <button onClick={parseJson} style={{ width:'100%', background:'#EDE9FE', border:'none', borderRadius:10, padding:'10px', fontSize:13, color:'#7C3AED', fontWeight:600, cursor:'pointer', fontFamily:'inherit', marginBottom:8, display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
                <Search size={14} /> JSON 파싱하기
              </button>
              {form.JSESSIONID && (
                <div style={{ background:'#F0FDF4', borderRadius:10, padding:'10px 12px', marginBottom:8, display:'flex', alignItems:'center', gap:8, fontSize:12 }}>
                  <CheckCircle2 size={14} color="#059669" />
                  <span style={{ color:'#059669', fontWeight:700 }}>파싱 완료</span>
                  <span style={{ color:'#9CA3AF' }}>{form.JSESSIONID.slice(0,20)}...</span>
                </div>
              )}
            </>
          ) : (
            <>
              <input placeholder="JSESSIONID *" value={form.JSESSIONID} onChange={e => setForm(f=>({...f,JSESSIONID:e.target.value}))} style={inp} />
              <input placeholder="AWSALB (선택)" value={form.AWSALB} onChange={e => setForm(f=>({...f,AWSALB:e.target.value}))} style={inp} />
              <input placeholder="AWSALBCORS (선택)" value={form.AWSALBCORS} onChange={e => setForm(f=>({...f,AWSALBCORS:e.target.value}))} style={inp} />
            </>
          )}
          <button onClick={addCookie} disabled={!form.JSESSIONID.trim()} style={{ width:'100%', padding:13, borderRadius:12, border:'none', background: form.JSESSIONID ? '#A78BFA' : '#E9E4FF', color: form.JSESSIONID ? '#fff' : '#9CA3AF', fontWeight:700, fontSize:14, cursor: form.JSESSIONID ? 'pointer' : 'not-allowed', fontFamily:'inherit' }}>
            계정 저장
          </button>
        </div>
      )}

      {/* 빈 상태 */}
      {cookies.length === 0 && !showAdd && (
        <div style={{ background:'#fff', borderRadius:16, padding:'40px 20px', textAlign:'center', color:'#9CA3AF', boxShadow:'0 2px 12px rgba(167,139,250,0.08)' }}>
          <KeyRound size={36} color="#C4B5FD" style={{ margin:'0 auto 10px' }} />
          <div style={{ fontSize:14, fontWeight:600 }}>저장된 계정이 없어요</div>
          <div style={{ fontSize:12, marginTop:4 }}>위의 추가 버튼으로 등록하세요</div>
        </div>
      )}

      {/* 계정 카드 */}
      <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
        {cookies.map(cs => {
          const r = results[cs.id];
          const tab = tabs[cs.id] || 'lender';
          const deals = tab === 'borrower' ? r?.data?.borrowerDeals : r?.data?.lenderDeals;
          return (
            <div key={cs.id} style={{ background:'#fff', borderRadius:16, boxShadow:'0 2px 12px rgba(167,139,250,0.08)', border:`1.5px solid ${r?.data ? '#A78BFA' : '#F3F0FF'}`, overflow:'hidden' }}>
              <div style={{ padding:'14px 16px', display:'flex', alignItems:'center', gap:12 }}>
                <div style={{ width:40, height:40, borderRadius:12, background:'#EDE9FE', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                  <Cookie size={20} color="#A78BFA" strokeWidth={2} />
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:14, fontWeight:700, color:'#1E1B4B' }}>{cs.label}</div>
                  <div style={{ fontSize:11, color:'#9CA3AF', marginTop:2 }}>{cs.JSESSIONID.slice(0,18)}...</div>
                </div>
                <div style={{ display:'flex', gap:6, flexShrink:0 }}>
                  <button onClick={() => query(cs)} disabled={r?.loading} style={{ background:'#EDE9FE', border:'none', borderRadius:8, padding:'6px 12px', fontSize:12, color:'#7C3AED', cursor:r?.loading?'not-allowed':'pointer', fontWeight:600, fontFamily:'inherit', display:'flex', alignItems:'center', gap:5, opacity:r?.loading?0.6:1 }}>
                    {r?.loading ? <Loader2 size={13} style={{ animation:'spin 1s linear infinite' }} /> : <Search size={13} />}
                    {r?.loading ? '조회중' : '조회'}
                  </button>
                  <button onClick={() => del(cs.id)} style={{ background:'#FFF0F0', border:'none', borderRadius:8, padding:'6px 10px', fontSize:12, color:'#EF4444', cursor:'pointer', fontFamily:'inherit', display:'flex', alignItems:'center' }}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              {r && (
                <div style={{ borderTop:'1px solid #F3F0FF' }}>
                  {r.loading && (
                    <div style={{ padding:16, textAlign:'center', color:'#A78BFA', fontSize:13, display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
                      <Loader2 size={16} style={{ animation:'spin 1s linear infinite' }} /> 파티 거래 조회 중...
                    </div>
                  )}
                  {r.error && (
                    <div style={{ padding:'12px 16px' }}>
                      <div style={{ background:'#FFF0F0', borderRadius:12, padding:'12px 14px' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, fontWeight:700, color:'#EF4444', marginBottom:4 }}>
                          <AlertCircle size={15} /> {r.code === 'COOKIE_EXPIRED' ? '쿠키 만료' : '오류'}
                        </div>
                        <div style={{ fontSize:12, color:'#6B7280', lineHeight:1.6 }}>{r.error}</div>
                        {r.code === 'COOKIE_EXPIRED' && (
                          <a href="https://graytag.co.kr/login" target="_blank" rel="noreferrer" style={{ display:'inline-flex', alignItems:'center', gap:4, marginTop:8, fontSize:12, color:'#7C3AED', fontWeight:600 }}>
                            graytag.co.kr 로그인 <ExternalLink size={11} />
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                  {!r.loading && !r.error && r.data && (
                    <div style={{ padding:'12px 16px' }}>
                      <div style={{ display:'flex', gap:8, marginBottom:12 }}>
                        {(['lender','borrower'] as const).map(t => (
                          <button key={t} onClick={() => setTabs(v=>({...v,[cs.id]:t}))} style={{ flex:1, padding:'8px', borderRadius:10, border:'none', fontFamily:'inherit', fontSize:12, fontWeight:600, cursor:'pointer', background: tab===t ? '#A78BFA' : '#F3F0FF', color: tab===t ? '#fff' : '#6B7280' }}>
                            {t==='lender' ? `판매한 파티 (${r.data!.totalLender})` : `구매한 파티 (${r.data!.totalBorrower})`}
                          </button>
                        ))}
                      </div>
                      {(!deals || deals.length === 0) ? (
                        <div style={{ textAlign:'center', padding:'20px 0', color:'#9CA3AF', fontSize:13 }}>진행 중인 거래가 없어요</div>
                      ) : (
                        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                          {deals.map((d: Deal) => {
                            const b = badge(d.dealStatus, d.dealStatusName);
                            return (
                              <div key={d.dealUsid} style={{ background:'#F8F6FF', borderRadius:12, padding:'12px 14px' }}>
                                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8 }}>
                                  <div style={{ flex:1, minWidth:0 }}>
                                    <div style={{ fontSize:13, fontWeight:700, color:'#1E1B4B' }}>{d.productType}</div>
                                    {d.productName && <div style={{ fontSize:11, color:'#6B7280', marginTop:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{d.productName}</div>}
                                    <div style={{ fontSize:11, color:'#9CA3AF', marginTop:4 }}>
                                      {tab==='lender' ? '파티원' : '파티장'}: {d.counterpartName||'미확인'}
                                      {d.remainderDays > 0 && <span> · {d.remainderDays}일 남음</span>}
                                    </div>
                                  </div>
                                  <div style={{ textAlign:'right', flexShrink:0 }}>
                                    <span style={{ display:'inline-block', fontSize:11, fontWeight:600, color:b.color, background:b.bg, borderRadius:6, padding:'3px 8px', marginBottom:4 }}>{b.label}</span>
                                    <div style={{ fontSize:14, fontWeight:700, color:'#A78BFA' }}>{d.price}</div>
                                  </div>
                                </div>
                                {d.endDateTime && <div style={{ fontSize:11, color:'#C4B5FD', marginTop:6 }}>만료: {new Date(d.endDateTime).toLocaleDateString('ko-KR',{year:'numeric',month:'long',day:'numeric'})}</div>}
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
      <div style={{ height:20 }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

const inp: React.CSSProperties = { width:'100%', padding:'11px 14px', borderRadius:10, border:'1.5px solid #EDE9FE', fontSize:13, color:'#1E1B4B', background:'#F8F6FF', outline:'none', fontFamily:'inherit', marginBottom:8, boxSizing:'border-box' };
