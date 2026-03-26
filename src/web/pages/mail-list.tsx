import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import {
  Mail, RefreshCw, Lock, AlertCircle, Clock, Inbox, Shield,
} from "lucide-react";
import { getAliasPin } from "../lib/pin-store";
import { useCooldown } from "../hooks/use-cooldown";

const SERVICE_MAP: Record<string, string> = {
  disney: '디즈니', netflix: '넷플릭스', watcha: '왓챠', wavve: '웨이브',
  tving: '티빙', coupang: '쿠팡플레이', laftel: '라프텔',
  youtube: '유튜브', apple: 'Apple', prime: '프라임',
};

function emailToLabel(email: string): string {
  const local = email.split('@')[0];
  const firstPart = local.split('.')[0];
  for (const [key, label] of Object.entries(SERVICE_MAP)) {
    if (firstPart.toLowerCase().startsWith(key)) {
      const rest = firstPart.slice(key.length);
      const num = rest.match(/^\d+/)?.[0] || '';
      return `${label}${num}`;
    }
  }
  return local.length > 18 ? local.slice(0, 16) + '..' : local;
}

interface Alias {
  id: number; email: string; enabled: boolean;
  nb_forward: number; nb_block: number; nb_reply: number;
  note: string | null; creation_date: string;
}

export default function MailListPage() {
  const [, navigate] = useLocation();
  const [aliases, setAliases] = useState<Alias[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCached, setIsCached] = useState(false);
  const [isRateLimited, setIsRateLimited] = useState(false);
  const [tick, setTick] = useState(0); // pin 상태 갱신용
  const cooldown = useCooldown(15_000); // 15초

  const fetchAliases = async (force = false) => {
    setLoading(true); setError(null); setIsRateLimited(false);
    try {
      const res = await fetch(`/api/sl/aliases?page=0${force ? '&force=1' : ''}`);
      const data = await res.json() as any;
      if (res.status === 429 || data._rate_limited) {
        setIsRateLimited(true);
        if (data.aliases?.length) {
          setAliases(data.aliases.sort((a: Alias, b: Alias) => b.nb_forward - a.nb_forward));
          setIsCached(true);
        } else {
          setError('API 요청 한도 초과. 잠시 후 다시 시도해주세요.');
        }
        return;
      }
      if (data.error) throw new Error(data.error);
      setAliases((data.aliases || []).sort((a: Alias, b: Alias) => b.nb_forward - a.nb_forward));
      setIsCached(!!data._cached);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchAliases(); }, []);

  const totalForwards = aliases.reduce((s, a) => s + a.nb_forward, 0);

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', minHeight: '100vh', background: '#F8F6FF', paddingBottom: 80 }}>
      {/* 헤더 */}
      <div style={{
        background: '#fff', borderBottom: '1px solid #E9E4FF',
        padding: '16px 16px 12px', position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: '#1E1B4B', margin: 0 }}>메일함</h1>
            <p style={{ fontSize: 11, color: '#9CA3AF', margin: '3px 0 0' }}>
              SimpleLogin 별칭 · {aliases.length}개
            </p>
          </div>
          <button
            onClick={() => cooldown.trigger(() => { fetchAliases(true); setTick(t => t + 1); })}
            disabled={loading || !cooldown.ready}
            style={{
              background: !cooldown.ready ? '#F3F4F6' : isRateLimited ? '#FFF3E0' : '#EDE9FE',
              border: 'none', borderRadius: 10, padding: '8px 12px',
              cursor: (loading || !cooldown.ready) ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 5, minWidth: 72, justifyContent: 'center',
              fontSize: 12, color: !cooldown.ready ? '#9CA3AF' : isRateLimited ? '#E65100' : '#7C3AED',
              fontWeight: 600, fontFamily: 'inherit', opacity: (loading || !cooldown.ready) ? 0.7 : 1,
              transition: 'all 0.2s',
            }}
          >
            <RefreshCw size={13} style={loading ? { animation: 'spin 1s linear infinite' } : {}} />
            {loading ? '로딩 중' : !cooldown.ready ? `${cooldown.remaining}초` : isRateLimited ? '재시도' : '새로고침'}
          </button>
        </div>
      </div>

      <div style={{ padding: '14px 14px 0' }}>
        {/* 요약 배너 */}
        {!loading && aliases.length > 0 && (
          <div style={{
            background: 'linear-gradient(135deg, #A78BFA 0%, #818CF8 100%)',
            borderRadius: 18, padding: '14px 18px', marginBottom: 14, color: '#fff',
            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, textAlign: 'center',
          }}>
            {[
              { label: '별칭', value: `${aliases.length}개` },
              { label: '활성', value: `${aliases.filter(a => a.enabled).length}개` },
              { label: '총 수신', value: `${totalForwards}건` },
            ].map(item => (
              <div key={item.label} style={{ background: 'rgba(255,255,255,0.15)', borderRadius: 10, padding: '8px 4px' }}>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{item.value}</div>
                <div style={{ fontSize: 10, opacity: 0.8, marginTop: 2 }}>{item.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* 안내 배너 */}
        {!loading && !error && (
          <div style={{
            background: '#EDE9FE', borderRadius: 12, padding: '9px 14px', marginBottom: 12,
            display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#7C3AED',
          }}>
            <Shield size={13} />
            이메일을 탭하면 상세 화면으로 이동해요. 각 이메일에 개별 PIN을 설정할 수 있어요.
          </div>
        )}

        {isRateLimited && (
          <div style={{ background: '#FFF3E0', borderRadius: 12, padding: '10px 14px', marginBottom: 10, display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: '#E65100' }}>
            <AlertCircle size={14} />
            API 요청 한도 초과 — {isCached ? '이전 데이터 표시 중. 1분 후 재시도.' : '잠시 후 재시도해주세요.'}
          </div>
        )}
        {!isRateLimited && isCached && (
          <div style={{ background: '#F3F0FF', borderRadius: 10, padding: '8px 12px', marginBottom: 10, fontSize: 11, color: '#9CA3AF', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Clock size={11} /> 캐시된 데이터 (최대 5분)
          </div>
        )}
        {error && (
          <div style={{ background: '#FFF0F0', borderRadius: 12, padding: '10px 14px', marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: '#EF4444' }}>
            <AlertCircle size={14} /> {error}
          </div>
        )}

        {/* 로딩 스켈레톤 */}
        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[1, 2, 3, 4].map(i => (
              <div key={i} style={{ background: '#fff', borderRadius: 14, height: 72, animation: 'pulse 1.5s infinite', opacity: 0.5 }} />
            ))}
          </div>
        )}

        {/* 별칭 목록 */}
        {!loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {aliases.length === 0 && !error && (
              <div style={{ textAlign: 'center', padding: '40px 0', color: '#9CA3AF' }}>
                <Inbox size={32} color="#E9E4FF" style={{ margin: '0 auto 10px', display: 'block' }} />
                별칭이 없어요
              </div>
            )}
            {aliases.map(alias => {
              const label = emailToLabel(alias.email);
              const hasPin = !!getAliasPin(alias.id);

              return (
                <button
                  key={alias.id}
                  onClick={() => navigate(`/mail/${alias.id}`)}
                  style={{
                    background: '#fff', borderRadius: 16, overflow: 'hidden',
                    boxShadow: '0 2px 10px rgba(167,139,250,0.08)',
                    border: `1.5px solid ${alias.enabled ? '#EDE9FE' : '#F0F0F0'}`,
                    opacity: alias.enabled ? 1 : 0.65,
                    width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                    padding: '13px 14px', cursor: 'pointer', fontFamily: 'inherit',
                    textAlign: 'left', transition: 'border-color 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = '#A78BFA')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = alias.enabled ? '#EDE9FE' : '#F0F0F0')}
                >
                  {/* 아이콘 */}
                  <div style={{
                    width: 44, height: 44, borderRadius: 13, flexShrink: 0,
                    background: alias.enabled ? '#EDE9FE' : '#F3F4F6',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Mail size={21} color={alias.enabled ? '#A78BFA' : '#9CA3AF'} strokeWidth={2} />
                  </div>

                  {/* 텍스트 */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: '#1E1B4B' }}>{label}</span>
                      {hasPin && (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 3,
                          background: '#F3F0FF', borderRadius: 6, padding: '2px 6px',
                          fontSize: 10, color: '#7C3AED', fontWeight: 600,
                        }}>
                          <Lock size={9} /> PIN
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: '#9CA3AF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
                      {alias.email}
                    </div>
                  </div>

                  {/* 수신수 + 상태 */}
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: alias.nb_forward > 0 ? '#A78BFA' : '#C4B5FD' }}>
                      {alias.nb_forward}건
                    </div>
                    <div style={{ fontSize: 10, color: alias.enabled ? '#059669' : '#9CA3AF', marginTop: 2 }}>
                      {alias.enabled ? '활성' : '비활성'}
                    </div>
                  </div>

                  <span style={{ fontSize: 16, color: '#C4B5FD', marginLeft: 2 }}>›</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100%{opacity:.4} 50%{opacity:.7} }
      `}</style>
    </div>
  );
}
