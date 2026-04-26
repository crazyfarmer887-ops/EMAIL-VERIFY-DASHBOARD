import { apiPath } from '../lib/path';
import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import {
  Mail, RefreshCw, Lock, AlertCircle, Clock, Inbox, Shield, Settings,
} from "lucide-react";
import { useCooldown } from "../hooks/use-cooldown";
import { getAdminSession } from "../lib/pin-api";

const SERVICE_MAP: Record<string, string> = {
  disney: '디즈니', netflix: '넷플릭스', watcha: '왓챠', wavve: '웨이브',
  tving: '티빙', coupang: '쿠팡플레이', laftel: '라프텔',
  youtube: '유튜브', apple: 'Apple', prime: '프라임',
};

const ALIAS_CACHE_KEY = 'sl_aliases_cache_v1';
const ALIAS_CACHE_TTL_MS = 5 * 60 * 1000;
const AUTO_REFRESH_INTERVAL = 5000; // 5초마다 auto-refresh

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
  hasPin?: boolean;
  pin?: string; // 관리자 전용: API가 반환하는 PIN 값
}

// ─── 알림 소리 재생 ────────────────────────────────────
const playNotificationSound = () => {
  try {
    // data URL로 간단한 beep 톤 생성 (Web Audio API)
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    // 두 개의 짧은 톤 재생 (ding-dong 효과)
    oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.15);
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.15);

    // 두 번째 톤
    const osc2 = audioContext.createOscillator();
    osc2.connect(gainNode);
    osc2.frequency.setValueAtTime(600, audioContext.currentTime + 0.2);
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime + 0.2);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.35);
    osc2.start(audioContext.currentTime + 0.2);
    osc2.stop(audioContext.currentTime + 0.35);
  } catch (e) {
    // 폴백: 간단한 비프 음
    try {
      const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAAB9AAACABAAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj==');
      audio.play().catch(() => {});
    } catch {}
  }
};

// ─── 큰 팝업 알림 ────────────────────────────────────
const showNotificationPopup = (newCount: number) => {
  // 이미 팝업이 표시 중이면 추가하지 않음
  if (document.getElementById('notification-popup')) return;

  const modal = document.createElement('div');
  modal.id = 'notification-popup';
  modal.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: linear-gradient(135deg, #10B981 0%, #059669 100%);
    color: white;
    padding: 40px 32px;
    border-radius: 28px;
    box-shadow: 0 25px 50px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.2);
    z-index: 9999;
    text-align: center;
    max-width: 380px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    animation: notifSlideUp 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
    border: 2px solid rgba(255,255,255,0.1);
  `;

  modal.innerHTML = `
    <div style="font-size: 56px; margin-bottom: 16px; animation: notifBounce 0.6s ease-in-out infinite; display: inline-block;">✉️</div>
    <div style="font-size: 28px; font-weight: 800; margin-bottom: 10px; letter-spacing: -0.5px;">새 이메일 도착!</div>
    <div style="font-size: 18px; opacity: 0.95; font-weight: 500;">${newCount}개의 새로운 메일</div>
    <div style="font-size: 13px; opacity: 0.8; margin-top: 12px; font-weight: 400;">탭하여 확인해주세요</div>
  `;

  document.body.appendChild(modal);

  // 클릭 시 닫기
  modal.addEventListener('click', () => {
    modal.style.animation = 'notifSlideDown 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
    setTimeout(() => modal.remove(), 400);
  });

  // 3초 후 자동 닫기
  setTimeout(() => {
    if (modal.parentNode) {
      modal.style.animation = 'notifSlideDown 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
      setTimeout(() => modal.remove(), 400);
    }
  }, 3000);
};

// ─── 애니메이션 CSS 등록 ────────────────────────────────────
const ensureAnimationStyles = () => {
  if (document.getElementById('notification-anim-styles')) return;

  const style = document.createElement('style');
  style.id = 'notification-anim-styles';
  style.textContent = `
    @keyframes notifSlideUp {
      from {
        transform: translate(-50%, -50%) scale(0.7);
        opacity: 0;
      }
      to {
        transform: translate(-50%, -50%) scale(1);
        opacity: 1;
      }
    }
    @keyframes notifSlideDown {
      from {
        transform: translate(-50%, -50%) scale(1);
        opacity: 1;
      }
      to {
        transform: translate(-50%, -50%) scale(0.7);
        opacity: 0;
      }
    }
    @keyframes notifBounce {
      0%, 100% { transform: scale(1) translateY(0); }
      25% { transform: scale(1.05) translateY(-4px); }
      50% { transform: scale(1) translateY(0); }
    }
  `;
  document.head.appendChild(style);
};

export default function MailListPage() {
  const [, navigate] = useLocation();
  const [aliases, setAliases] = useState<Alias[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCached, setIsCached] = useState(false);
  const [isRateLimited, setIsRateLimited] = useState(false);
  const [, setTick] = useState(0); // pin 상태 갱신용
  const [isAdmin, setIsAdmin] = useState(false);
  const cooldown = useCooldown(15_000); // 15초

  // auto-refresh 폴링
  const autoRefreshTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const prevAliasesRef = useRef<Alias[]>([]);

  // 관리자 세션 체크
  useEffect(() => {
    getAdminSession().then(s => setIsAdmin(!!s.authenticated)).catch(() => setIsAdmin(false));
  }, []);

  // 새 이메일 감지 + 알림
  const detectNewEmails = (newAliases: Alias[]) => {
    if (prevAliasesRef.current.length === 0) {
      prevAliasesRef.current = newAliases;
      return;
    }

    let totalNewEmails = 0;
    for (const newAlias of newAliases) {
      const prevAlias = prevAliasesRef.current.find(a => a.id === newAlias.id);
      if (prevAlias && newAlias.nb_forward > prevAlias.nb_forward) {
        const diff = newAlias.nb_forward - prevAlias.nb_forward;
        totalNewEmails += diff;
      }
    }

    if (totalNewEmails > 0) {
      ensureAnimationStyles();
      playNotificationSound();
      showNotificationPopup(totalNewEmails);
    }

    prevAliasesRef.current = newAliases;
  };

  const fetchAliases = async (force = false, isAutoRefresh = false) => {
    if (!isAutoRefresh) {
      setLoading(true);
      setError(null);
      setIsRateLimited(false);
    }
    try {
      const res = await fetch(apiPath(`/sl/aliases?page=0${force ? '&force=1' : ''}`));
      const data = await res.json() as any;
      if (res.status === 429 || data._rate_limited) {
        if (!isAutoRefresh) setIsRateLimited(true);
        if (data.aliases?.length) {
          const sorted = (data.aliases as Alias[]).sort((a: Alias, b: Alias) => b.nb_forward - a.nb_forward);
          setAliases(sorted);
          if (!isAutoRefresh) detectNewEmails(sorted);
          if (!isAutoRefresh) setIsCached(true);
        } else if (!isAutoRefresh) {
          setError('API 요청 한도 초과. 잠시 후 다시 시도해주세요.');
        }
        return;
      }
      if (data.error) throw new Error(data.error);
      const sorted = (data.aliases || []).sort((a: Alias, b: Alias) => b.nb_forward - a.nb_forward);
      setAliases(sorted);
      detectNewEmails(sorted);
      if (!isAutoRefresh) setIsCached(!!data._cached);
      try {
        localStorage.setItem(ALIAS_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), aliases: sorted }));
      } catch {
        // ignore storage failures
      }
    } catch (e: any) {
      if (!isAutoRefresh) setError(e.message);
    }
    finally {
      if (!isAutoRefresh) setLoading(false);
    }
  };

  // 초기 로드
  useEffect(() => {
    try {
      const cached = localStorage.getItem(ALIAS_CACHE_KEY);
      if (!cached) return;
      const parsed = JSON.parse(cached) as { savedAt: number; aliases: Alias[] };
      if (Date.now() - parsed.savedAt > ALIAS_CACHE_TTL_MS) return;
      if (Array.isArray(parsed.aliases) && parsed.aliases.length > 0) {
        const sorted = parsed.aliases.sort((a: Alias, b: Alias) => b.nb_forward - a.nb_forward);
        setAliases(sorted);
        prevAliasesRef.current = sorted;
        setIsCached(true);
      }
    } catch {
      // ignore broken cache
    }
  }, []);

  useEffect(() => {
    fetchAliases();
  }, []);

  // Auto-refresh 폴링 (5초마다)
  useEffect(() => {
    ensureAnimationStyles();

    const startAutoRefresh = () => {
      autoRefreshTimeoutRef.current = setInterval(() => {
        fetchAliases(false, true);
      }, AUTO_REFRESH_INTERVAL);
    };

    startAutoRefresh();

    return () => {
      if (autoRefreshTimeoutRef.current) {
        clearInterval(autoRefreshTimeoutRef.current);
      }
    };
  }, []);

  const totalForwards = aliases.reduce((s, a) => s + a.nb_forward, 0);

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', minHeight: '100vh', background: '#F8F6FF', paddingBottom: 80 }}>
      {/* 헤더 */}
      <div style={{
        background: '#fff', borderBottom: '1px solid #E9E4FF',
        padding: '16px 16px 12px', position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: '#1E1B4B', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>메일함</h1>
            <p style={{ fontSize: 11, color: '#9CA3AF', margin: '3px 0 0' }}>
              SimpleLogin 별칭 · {aliases.length}개
            </p>
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <button
              onClick={() => navigate('/admin')}
              style={{ background: '#F3F0FF', border: 'none', borderRadius: 10, padding: '8px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#7C3AED', fontWeight: 600, fontFamily: 'inherit' }}
            >
              <Settings size={13} /> 관리
            </button>
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
          <div style={{ background: '#fff', borderRadius: 20, padding: '40px 20px', textAlign: 'center', boxShadow: '0 2px 12px rgba(167,139,250,0.08)', marginBottom: 12 }}>
            <AlertCircle size={40} color="#EF4444" style={{ margin: '0 auto 16px', display: 'block' }} />
            <div style={{ fontSize: 18, fontWeight: 700, color: '#1E1B4B', marginBottom: 8, lineHeight: 1.4 }}>
              재로딩을 해서<br/>이메일을 다시 가져와주세요!
            </div>
            <div style={{ fontSize: 13, color: '#9CA3AF', marginBottom: 20 }}>{error}</div>
            <button
              onClick={() => { fetchAliases(true); setTick(t => t + 1); }}
              disabled={loading}
              style={{
                background: '#A78BFA', border: 'none', borderRadius: 14,
                padding: '14px 32px', fontSize: 16, fontWeight: 700, color: '#fff',
                cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                boxShadow: '0 4px 16px rgba(167,139,250,0.35)',
                display: 'inline-flex', alignItems: 'center', gap: 8,
                opacity: loading ? 0.7 : 1,
              }}
            >
              <RefreshCw size={18} style={loading ? { animation: 'spin 1s linear infinite' } : {}} />
              {loading ? '로딩 중...' : '다시 불러오기'}
            </button>
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
              const hasPin = !!alias.hasPin;

              return (
                <button
                  key={alias.id}
                  onClick={() => { try { sessionStorage.setItem('sl_from_list', '1'); } catch {} navigate(`/mail/${alias.id}`); }}
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
                      {hasPin && !isAdmin && (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 3,
                          background: '#F3F0FF', borderRadius: 6, padding: '2px 6px',
                          fontSize: 10, color: '#7C3AED', fontWeight: 600,
                        }}>
                          <Lock size={9} /> PIN
                        </span>
                      )}
                      {hasPin && isAdmin && alias.pin && (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          background: '#FEF3C7', borderRadius: 7, padding: '3px 8px',
                          fontSize: 11, color: '#92400E', fontWeight: 700,
                          border: '1px solid #FDE68A', letterSpacing: 2,
                          fontFamily: 'monospace',
                        }}>
                          🔑 {alias.pin}
                        </span>
                      )}
                      {hasPin && isAdmin && !alias.pin && (
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
