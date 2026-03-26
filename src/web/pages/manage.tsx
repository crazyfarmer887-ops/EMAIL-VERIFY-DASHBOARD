import { useState } from "react";
import { CATEGORIES } from "../lib/constants";
import { RefreshCw, KeyRound, Mail, ChevronDown, ChevronRight, TrendingUp, Loader2, AlertCircle, ExternalLink } from "lucide-react";

interface Member {
  dealUsid: string; name: string | null; status: string; statusName: string;
  price: string; purePrice: number; realizedSum: number; progressRatio: string;
  startDateTime: string | null; endDateTime: string | null; remainderDays: number; source: 'after'|'before';
}
interface Account {
  email: string; serviceType: string; members: Member[]; usingCount: number;
  activeCount: number; totalSlots: number; totalIncome: number; totalRealizedIncome: number; expiryDate: string | null;
}
interface ServiceGroup { serviceType: string; accounts: Account[]; totalUsingMembers: number; totalActiveMembers: number; totalIncome: number; totalRealized: number; }
interface ManageData { services: ServiceGroup[]; summary: { totalUsingMembers: number; totalActiveMembers: number; totalIncome: number; totalRealized: number; totalAccounts: number; }; updatedAt: string; }

const STORAGE_KEY = 'graytag_cookies_v2';
interface CookieSet { id: string; label: string; AWSALB: string; AWSALBCORS: string; JSESSIONID: string; }
const loadCookies = (): CookieSet[] => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; } };

const USING_SET = new Set(['Using', 'UsingNearExpiration']);
const ACTIVE_SET = new Set(['Using','UsingNearExpiration','Delivered','Delivering','DeliveredAndCheckPrepaid','LendingAcceptanceWaiting','Reserved','OnSale']);

const STATUS_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  Using:                       { label:'이용 중',   color:'#7C3AED', bg:'#F5F3FF' },
  UsingNearExpiration:         { label:'만료 임박',  color:'#D97706', bg:'#FFFBEB' },
  OnSale:                      { label:'판매 중',   color:'#059669', bg:'#ECFDF5' },
  Delivered:                   { label:'전달 완료',  color:'#2563EB', bg:'#EFF6FF' },
  Delivering:                  { label:'전달 중',   color:'#0891B2', bg:'#ECFEFF' },
  Reserved:                    { label:'예약됨',    color:'#6366F1', bg:'#EEF2FF' },
  LendingAcceptanceWaiting:    { label:'수락 대기',  color:'#D97706', bg:'#FFFBEB' },
  NormalFinished:              { label:'완료',      color:'#6B7280', bg:'#F3F4F6' },
  FinishedByBorrowerRequest:   { label:'중도 종료',  color:'#9CA3AF', bg:'#F9FAFB' },
  FinishedByLenderRequest:     { label:'중도 종료',  color:'#9CA3AF', bg:'#F9FAFB' },
  CancelByNoShow:              { label:'취소(노쇼)', color:'#EF4444', bg:'#FFF0F0' },
  CancelByDepositRejection:    { label:'취소(입금)', color:'#EF4444', bg:'#FFF0F0' },
  CancelByInspectionRejection: { label:'취소(검수)', color:'#EF4444', bg:'#FFF0F0' },
};

const bge = (s: string, n: string) => STATUS_BADGE[s] || { label:n||s, color:'#6B7280', bg:'#F3F4F6' };
const svcLogo = (s: string) => CATEGORIES.find(c => c.label===s || s.includes(c.label.slice(0,3)))?.logo;
const svcColors = (s: string) => { const c = CATEGORIES.find(c => c.label===s || s.includes(c.label.slice(0,3))); return { color: c?.color||'#6B7280', bg: c?.bg||'#F3F4F6' }; };
const fmtMoney = (n: number) => n > 0 ? n.toLocaleString()+'원' : '-';
const fmtDate = (s: string|null) => s ? s.replace(/\s/g,'').replace(/\.(?=\S)/g,'/').replace(/\.$/, '') : '-';

type FilterMode = 'using'|'active'|'all';

export default function ManagePage() {
  const cookies = loadCookies();
  const [selectedId, setSelectedId] = useState(cookies[0]?.id||'');
  const [data, setData] = useState<ManageData|null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string|null>(null);
  const [openService, setOpenService] = useState<string|null>(null);
  const [openAccount, setOpenAccount] = useState<string|null>(null);
  const [filter, setFilter] = useState<FilterMode>('using');

  const doFetch = async (id?: string) => {
    const cs = cookies.find(c => c.id===(id||selectedId));
    if (!cs) return;
    setLoading(true); setError(null); setData(null);
    try {
      const res = await fetch('/api/my/management', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ AWSALB:cs.AWSALB, AWSALBCORS:cs.AWSALBCORS, JSESSIONID:cs.JSESSIONID }) });
      const json = await res.json() as any;
      if (!res.ok) setError(json.error);
      else { setData(json); if (json.services?.[0]) setOpenService(json.services[0].serviceType); }
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  if (cookies.length === 0) return (
    <div style={{ padding:'20px 16px' }}>
      <h1 style={{ fontSize:22, fontWeight:700, color:'#1E1B4B', margin:'0 0 16px' }}>계정 관리</h1>
      <div style={{ background:'#EDE9FE', borderRadius:16, padding:20, textAlign:'center' }}>
        <KeyRound size={36} color="#C4B5FD" style={{ margin:'0 auto 10px' }} />
        <div style={{ fontSize:14, fontWeight:600, color:'#7C3AED' }}>내 계정 탭에서 쿠키를 먼저 등록해주세요</div>
      </div>
    </div>
  );

  const sum = data?.summary;

  return (
    <div style={{ padding:'20px 16px 0' }}>
      {/* 헤더 */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:700, color:'#1E1B4B', margin:0 }}>계정 관리</h1>
          <p style={{ fontSize:12, color:'#9CA3AF', margin:'4px 0 0' }}>
            {data?.updatedAt ? `${new Date(data.updatedAt).getHours().toString().padStart(2,'0')}:${new Date(data.updatedAt).getMinutes().toString().padStart(2,'0')} 기준` : '이메일 계정별 파티원 현황'}
          </p>
        </div>
        <button onClick={() => doFetch()} disabled={loading} style={{ background:'#A78BFA', border:'none', borderRadius:12, padding:'8px 14px', fontSize:13, color:'#fff', cursor:loading?'not-allowed':'pointer', fontWeight:600, fontFamily:'inherit', opacity:loading?0.7:1, display:'flex', alignItems:'center', gap:6 }}>
          {loading ? <Loader2 size={14} style={{ animation:'spin 1s linear infinite' }} /> : <RefreshCw size={14} />}
          {loading ? '조회중' : '조회'}
        </button>
      </div>

      {/* 계정 선택 */}
      {cookies.length > 1 && (
        <div className="no-scrollbar" style={{ display:'flex', gap:8, marginBottom:12, overflowX:'auto' }}>
          {cookies.map(cs => (
            <button key={cs.id} onClick={() => setSelectedId(cs.id)} style={{ flexShrink:0, padding:'6px 14px', borderRadius:20, border:'none', fontFamily:'inherit', fontSize:12, fontWeight:600, cursor:'pointer', background: selectedId===cs.id ? '#A78BFA' : '#fff', color: selectedId===cs.id ? '#fff' : '#6B7280', boxShadow:'0 1px 4px rgba(0,0,0,0.06)' }}>
              {cs.label}
            </button>
          ))}
        </div>
      )}

      {/* 초기 안내 */}
      {!data && !loading && !error && (
        <div style={{ background:'#EDE9FE', borderRadius:16, padding:20, textAlign:'center' }}>
          <Mail size={32} color="#C4B5FD" style={{ margin:'0 auto 10px' }} />
          <div style={{ fontSize:14, fontWeight:600, color:'#7C3AED' }}>조회 버튼을 눌러주세요</div>
          <div style={{ fontSize:12, color:'#9CA3AF', marginTop:4 }}>이메일 계정별 파티원 · 수입 현황</div>
        </div>
      )}

      {/* 에러 */}
      {error && (
        <div style={{ background:'#FFF0F0', borderRadius:16, padding:'14px 16px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, fontWeight:600, color:'#EF4444', marginBottom:4 }}>
            <AlertCircle size={15} /> 오류
          </div>
          <div style={{ fontSize:12, color:'#6B7280' }}>{error}</div>
          {error.includes('만료') && (
            <a href="https://graytag.co.kr/login" target="_blank" rel="noreferrer" style={{ display:'inline-flex', alignItems:'center', gap:4, marginTop:8, fontSize:12, color:'#7C3AED', fontWeight:600 }}>
              graytag.co.kr 로그인 <ExternalLink size={11} />
            </a>
          )}
        </div>
      )}

      {/* 로딩 */}
      {loading && <div style={{ display:'flex', flexDirection:'column', gap:10 }}>{[1,2,3].map(i => <div key={i} style={{ background:'#fff', borderRadius:16, height:80, opacity:0.5, animation:'pulse 1.5s infinite' }} />)}</div>}

      {data && !loading && (
        <>
          {/* 요약 배너 */}
          <div style={{ background:'linear-gradient(135deg, #A78BFA 0%, #818CF8 100%)', borderRadius:20, padding:'16px 20px', marginBottom:14, color:'#fff' }}>
            <div style={{ fontSize:12, opacity:0.85, marginBottom:10 }}>전체 현황</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:6, textAlign:'center' }}>
              {[
                { label:'계정 수', value:`${sum!.totalAccounts}개` },
                { label:'이용 중', value:`${sum!.totalUsingMembers}명` },
                { label:'현재 수입', value:fmtMoney(sum!.totalIncome) },
                { label:'정산 완료', value:fmtMoney(sum!.totalRealized) },
              ].map(item => (
                <div key={item.label} style={{ background:'rgba(255,255,255,0.15)', borderRadius:10, padding:'8px 4px' }}>
                  <div style={{ fontSize:13, fontWeight:700, lineHeight:1.2 }}>{item.value}</div>
                  <div style={{ fontSize:9, opacity:0.8, marginTop:3 }}>{item.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* 필터 */}
          <div style={{ display:'flex', gap:6, marginBottom:14 }}>
            {([
              { key:'using',  label:'이용 중' },
              { key:'active', label:'전체 활성' },
              { key:'all',    label:'전체 내역' },
            ] as { key: FilterMode; label: string }[]).map(f => (
              <button key={f.key} onClick={() => setFilter(f.key)} style={{ flex:1, padding:'7px 4px', borderRadius:10, border:'none', fontFamily:'inherit', fontSize:11, fontWeight:600, cursor:'pointer', background: filter===f.key ? '#A78BFA' : '#F3F0FF', color: filter===f.key ? '#fff' : '#6B7280' }}>{f.label}</button>
            ))}
          </div>

          {/* 서비스별 */}
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {data.services.map(svc => {
              const sc = svcColors(svc.serviceType);
              const logo = svcLogo(svc.serviceType);
              const isOpen = openService === svc.serviceType;
              return (
                <div key={svc.serviceType} style={{ background:'#fff', borderRadius:16, overflow:'hidden', boxShadow:'0 2px 12px rgba(167,139,250,0.08)', border:`1.5px solid ${isOpen?'#A78BFA':'#F3F0FF'}` }}>
                  <button onClick={() => setOpenService(isOpen ? null : svc.serviceType)} style={{ width:'100%', display:'flex', alignItems:'center', gap:12, padding:'14px 16px', background:'none', border:'none', cursor:'pointer', fontFamily:'inherit' }}>
                    <div style={{ width:40, height:40, borderRadius:12, background:sc.bg, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                      {logo ? <img src={logo} alt={svc.serviceType} style={{ width:26, height:26, objectFit:'contain' }} onError={e=>{(e.target as HTMLImageElement).style.display='none';}} /> : null}
                    </div>
                    <div style={{ flex:1, textAlign:'left' }}>
                      <div style={{ fontSize:15, fontWeight:700, color:'#1E1B4B' }}>{svc.serviceType}</div>
                      <div style={{ fontSize:11, color:'#9CA3AF', marginTop:2 }}>계정 {svc.accounts.length}개 · 이용중 {svc.totalUsingMembers}명</div>
                    </div>
                    <div style={{ textAlign:'right', flexShrink:0 }}>
                      <div style={{ fontSize:14, fontWeight:700, color:'#A78BFA' }}>{fmtMoney(svc.totalIncome)}</div>
                      <div style={{ fontSize:10, color:'#059669', marginTop:1 }}>정산 {fmtMoney(svc.totalRealized)}</div>
                    </div>
                    {isOpen ? <ChevronDown size={16} color="#A78BFA" /> : <ChevronRight size={16} color="#A78BFA" />}
                  </button>

                  {isOpen && (
                    <div style={{ borderTop:'1px solid #F3F0FF', padding:'8px 12px 12px' }}>
                      {svc.accounts.map(acct => {
                        const acctKey = `${acct.email}__${acct.serviceType}`;
                        const isAcctOpen = openAccount === acctKey;
                        const filteredMembers = acct.members.filter(m => {
                          if (filter==='using') return USING_SET.has(m.status);
                          if (filter==='active') return ACTIVE_SET.has(m.status);
                          return true;
                        });
                        if (filter !== 'all' && acct.usingCount===0 && acct.activeCount===0) return null;
                        const filledSlots = acct.usingCount || acct.activeCount;
                        const totalSlots = Math.max(acct.totalSlots, filledSlots, 1);
                        const fillPct = Math.round((filledSlots/totalSlots)*100);
                        return (
                          <div key={acctKey} style={{ marginBottom:8, background:'#F8F6FF', borderRadius:12, overflow:'hidden' }}>
                            <button onClick={() => setOpenAccount(isAcctOpen ? null : acctKey)} style={{ width:'100%', display:'flex', alignItems:'center', gap:10, padding:'12px 14px', background:'none', border:'none', cursor:'pointer', fontFamily:'inherit' }}>
                              {/* 슬롯 게이지 */}
                              <div style={{ flexShrink:0, display:'flex', flexDirection:'column', alignItems:'center', gap:3, minWidth:36 }}>
                                <div style={{ display:'flex', gap:3 }}>
                                  {Array.from({length:totalSlots}).map((_,i) => (
                                    <div key={i} style={{ width: i<acct.usingCount?7:6, height: i<acct.usingCount?18:14, borderRadius:3, background: i<acct.usingCount?'#A78BFA': i<acct.activeCount?'#C4B5FD':'#E9E4FF', alignSelf:'flex-end' }} />
                                  ))}
                                </div>
                                <div style={{ fontSize:9, color:'#9CA3AF' }}>{acct.usingCount}/{totalSlots}</div>
                              </div>
                              <div style={{ flex:1, textAlign:'left', minWidth:0 }}>
                                <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                                  <Mail size={12} color="#9CA3AF" />
                                  <span style={{ fontSize:12, fontWeight:700, color:'#1E1B4B', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{acct.email}</span>
                                </div>
                                <div style={{ display:'flex', gap:6, alignItems:'center', marginTop:3 }}>
                                  {acct.usingCount === totalSlots && <span style={{ fontSize:10, color:'#059669', fontWeight:600, display:'flex', alignItems:'center', gap:3 }}><TrendingUp size={10} /> 만석</span>}
                                  <span style={{ fontSize:10, color:'#9CA3AF' }}>{fillPct}% 사용</span>
                                  {acct.expiryDate && <span style={{ fontSize:10, color:'#9CA3AF' }}>~{fmtDate(acct.expiryDate)}</span>}
                                </div>
                              </div>
                              <div style={{ textAlign:'right', flexShrink:0 }}>
                                <div style={{ fontSize:13, fontWeight:700, color:'#A78BFA' }}>{fmtMoney(acct.totalIncome)}</div>
                                {acct.totalRealizedIncome > 0 && <div style={{ fontSize:10, color:'#059669', marginTop:1 }}>정산 {fmtMoney(acct.totalRealizedIncome)}</div>}
                              </div>
                              {isAcctOpen ? <ChevronDown size={13} color="#C4B5FD" /> : <ChevronRight size={13} color="#C4B5FD" />}
                            </button>

                            {isAcctOpen && (
                              <div style={{ borderTop:'1px solid #EDE9FE', padding:'8px 14px' }}>
                                {filteredMembers.length === 0 ? (
                                  <div style={{ fontSize:12, color:'#9CA3AF', textAlign:'center', padding:'8px 0' }}>해당 조건의 파티원 없음</div>
                                ) : filteredMembers.map((m, idx) => {
                                  const b = bge(m.status, m.statusName);
                                  const isUsing = USING_SET.has(m.status);
                                  return (
                                    <div key={m.dealUsid} style={{ display:'flex', alignItems:'flex-start', gap:10, padding:'9px 0', borderBottom: idx<filteredMembers.length-1 ? '1px solid #F3F0FF' : 'none' }}>
                                      <div style={{ width:26, height:26, borderRadius:8, flexShrink:0, background: isUsing?'#A78BFA': ACTIVE_SET.has(m.status)?'#C4B5FD':'#E9E4FF', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, marginTop:2, color: isUsing?'#fff': ACTIVE_SET.has(m.status)?'#fff':'#9CA3AF' }}>{idx+1}</div>
                                      <div style={{ flex:1, minWidth:0 }}>
                                        <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                                          <span style={{ fontSize:13, fontWeight:700, color:'#1E1B4B' }}>{m.name||'(미확인)'}</span>
                                          <span style={{ fontSize:10, fontWeight:600, color:b.color, background:b.bg, borderRadius:6, padding:'2px 7px' }}>{b.label}</span>
                                        </div>
                                        {(m.startDateTime||m.endDateTime) && <div style={{ fontSize:11, color:'#9CA3AF', marginTop:2 }}>{m.startDateTime&&fmtDate(m.startDateTime)}{m.startDateTime&&m.endDateTime&&' ~ '}{m.endDateTime&&fmtDate(m.endDateTime)}{m.remainderDays>0&&` (${m.remainderDays}일)`}</div>}
                                        {isUsing && m.progressRatio && m.progressRatio!=='0%' && (
                                          <div style={{ marginTop:5 }}>
                                            <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:'#9CA3AF', marginBottom:2 }}><span>진행률</span><span>{m.progressRatio}</span></div>
                                            <div style={{ background:'#E9E4FF', borderRadius:4, height:4 }}><div style={{ background:'#A78BFA', borderRadius:4, height:'100%', width:m.progressRatio, maxWidth:'100%' }} /></div>
                                          </div>
                                        )}
                                      </div>
                                      <div style={{ textAlign:'right', flexShrink:0 }}>
                                        <div style={{ fontSize:13, fontWeight:700, color:'#A78BFA' }}>{m.price}</div>
                                        {m.realizedSum>0 && <div style={{ fontSize:10, color:'#059669', marginTop:2 }}>정산 {m.realizedSum.toLocaleString()}원</div>}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
      <div style={{ height:20 }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes pulse{0%,100%{opacity:.4} 50%{opacity:.7}}`}</style>
    </div>
  );
}
