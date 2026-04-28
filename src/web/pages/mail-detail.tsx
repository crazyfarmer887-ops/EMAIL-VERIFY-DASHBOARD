import { apiPath } from '../lib/path';
import { useState, useEffect, useRef } from "react";
import { useLocation, useParams } from "wouter";
import { useCooldown } from "../hooks/use-cooldown";
import {
  ArrowLeft, Mail, RefreshCw, Clock, Lock, KeyRound,
  Eye, EyeOff, AlertCircle, Inbox, Settings,
  Shield, X, Info,
} from "lucide-react";
import {
  isAliasUnlocked, setAliasUnlocked, getGuestId, getEmailAccessHeaders,
} from "../lib/pin-store";
import {
  verifyAliasPin,
  getAdminSession,
} from "../lib/pin-api";

// ─── 헬퍼 ──────────────────────────────────────────────────────
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

function detectService(from: string): { label: string; color: string; bg: string; logo: string } | null {
  const f = from.toLowerCase();
  if (f.includes('disney'))  return { label: '디즈니+',  color: '#1A3E8C', bg: '#EEF3FF', logo: '/email/logos/disney.png' };
  if (f.includes('netflix')) return { label: '넷플릭스', color: '#E50914', bg: '#FFF0F0', logo: '/email/logos/netflix.png' };
  if (f.includes('watcha'))  return { label: '왓챠',     color: '#FF153C', bg: '#FFF0F3', logo: '/email/logos/watcha.png' };
  if (f.includes('wavve'))   return { label: '웨이브',   color: '#006BE9', bg: '#EEF5FF', logo: '/email/logos/wavve.png' };
  if (f.includes('tving'))   return { label: '티빙',     color: '#FF153C', bg: '#FFF0F3', logo: '/email/logos/tving.png' };
  if (f.includes('coupang')) return { label: '쿠팡',     color: '#E8343B', bg: '#FFF0F0', logo: '/email/logos/coupang.png' };
  if (f.includes('laftel'))  return { label: '라프텔',   color: '#6B4FBB', bg: '#F3EEFF', logo: '/email/logos/laftel.png' };
  if (f.includes('youtube') || f.includes('google')) return { label: '유튜브', color: '#FF0000', bg: '#FFF0F0', logo: '/email/logos/youtube.png' };
  if (f.includes('apple'))   return { label: 'Apple',   color: '#555',    bg: '#F5F5F5', logo: '/email/logos/apple.png' };
  if (f.includes('amazon') || f.includes('prime')) return { label: 'Prime', color: '#00A8E0', bg: '#EEF9FF', logo: '/email/logos/prime.png' };
  return null;
}

function timeAgo(ts: number) {
  const diff = Math.floor(Date.now() / 1000 - ts);
  if (diff < 60) return `${diff}초 전`;
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}일 전`;
  return new Date(ts * 1000).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
}

function senderLabel(from: string) {
  const m = from.match(/^"?([^"<]+)"?\s*</);
  return m ? m[1].trim() : from.replace(/<.*>/, '').trim() || from;
}

// ─── 사용법 안내 팝업 ──────────────────────────────────────────
function GuidePopup({ onClose }: { onClose: () => void }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(30,27,75,0.55)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: '0 0 16px',
    }}>
      <div style={{
        background: '#fff', borderRadius: 24, padding: '28px 24px 24px',
        width: '100%', maxWidth: 460,
        boxShadow: '0 -8px 40px rgba(167,139,250,0.18)',
        animation: 'slideUp 0.25s ease',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: '#EDE9FE', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Info size={20} color="#A78BFA" />
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#1E1B4B' }}>처음 오셨군요!</div>
              <div style={{ fontSize: 12, color: '#9CA3AF' }}>이메일 확인 서비스 사용법</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: '#F3F0FF', border: 'none', borderRadius: 10, padding: 8, cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
            <X size={16} color="#7C3AED" />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 20 }}>
          {[
            { step: '1', icon: '📋', title: '이메일 목록 확인', desc: '메인 화면에서 서비스별 이메일 별칭 목록을 볼 수 있어요' },
            { step: '2', icon: '🔒', title: 'PIN 입력', desc: 'PIN이 설정된 이메일은 번호를 입력해야 내용을 볼 수 있어요' },
            { step: '3', icon: '📧', title: '최근 10분 메일', desc: '이 화면에서는 최근 10분 내 수신된 이메일만 표시돼요' },
            { step: '4', icon: '🔔', title: '새 메일 알림', desc: '새 이메일이 도착하면 상단에 알림 배너가 뜨고 자동 업데이트돼요' },
          ].map(item => (
            <div key={item.step} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: '#F3F0FF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>
                {item.icon}
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1E1B4B', marginBottom: 2 }}>{item.title}</div>
                <div style={{ fontSize: 12, color: '#9CA3AF', lineHeight: 1.5 }}>{item.desc}</div>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={onClose}
          style={{ width: '100%', padding: 14, borderRadius: 14, border: 'none', background: 'linear-gradient(135deg, #A78BFA 0%, #818CF8 100%)', color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer', fontFamily: 'inherit' }}
        >
          확인했어요
        </button>
      </div>
    </div>
  );
}

// ─── 새 메일 전광판 배너 (marquee 스타일) ───────────────────────
function NewMailBanner({ count, subject, onView, onDismiss }: {
  count: number; subject: string; onView: () => void; onDismiss: () => void;
}) {
  const text = `📬 새 이메일 ${count}건 도착! · ${subject}`;
  return (
    <div style={{
      position: 'fixed', top: 0, left: '50%', transform: 'translateX(-50%)',
      zIndex: 900, width: '100%', maxWidth: 480,
      overflow: 'hidden',
      boxShadow: '0 4px 20px rgba(124,58,237,0.4)',
    }}>
      {/* 전광판 띠 */}
      <div style={{
        display: 'flex', alignItems: 'stretch',
        background: 'linear-gradient(90deg, #7C3AED, #A78BFA, #818CF8, #7C3AED)',
        backgroundSize: '300% 100%',
        animation: 'marqueeGradient 4s linear infinite',
      }}>
        {/* NEW 뱃지 */}
        <div style={{
          flexShrink: 0, background: '#EF4444', color: '#fff',
          fontWeight: 800, fontSize: 11, padding: '10px 12px',
          display: 'flex', alignItems: 'center', gap: 5,
          letterSpacing: '0.05em',
        }}>
          <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#fff', animation: 'blink 0.8s ease-in-out infinite' }} />
          NEW
        </div>

        {/* 스크롤 텍스트 영역 */}
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }} onClick={onView}>
          <div style={{
            display: 'inline-flex',
            animation: 'marqueeScroll 14s linear infinite',
            cursor: 'pointer',
          }}>
            {[0,1,2,3].map(i => (
              <span key={i} style={{
                fontSize: 12, color: '#fff', fontWeight: 600,
                padding: '10px 40px 10px 8px', whiteSpace: 'nowrap',
                display: 'inline-block',
              }}>
                {text}
              </span>
            ))}
          </div>
        </div>

        {/* 닫기 버튼 */}
        <button
          onClick={onDismiss}
          style={{ flexShrink: 0, background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', cursor: 'pointer', padding: '10px 12px', display: 'flex', alignItems: 'center' }}
        >
          <X size={14} color="rgba(255,255,255,0.9)" />
        </button>
      </div>
    </div>
  );
}

// ─── PIN 입력 컴포넌트 ──────────────────────────────────────────
function PinInput({
  onSubmitPin, onCancel,
}: {
  mode: 'unlock';
  onSubmitPin: (pin: string) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleUnlock = async () => {
    const value = pin.trim();
    if (value.length < 4) { setError('4자리 이상 입력해주세요'); return; }
    setLoading(true); setError('');
    try {
      const ok = await onSubmitPin(value);
      if (!ok) { setError('핀번호가 틀렸어요'); setPin(''); }
    } finally { setLoading(false); }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #F8F6FF 0%, #EDE9FE 100%)', padding: 24 }}>
      <div style={{ background: '#fff', borderRadius: 24, padding: '32px 28px', width: '100%', maxWidth: 360, boxShadow: '0 8px 32px rgba(167,139,250,0.18)' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ width: 64, height: 64, borderRadius: 20, background: '#EDE9FE', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
            <Lock size={28} color="#A78BFA" strokeWidth={2} />
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#1E1B4B', margin: 0 }}>핀번호 입력</h2>
          <p style={{ fontSize: 13, color: '#9CA3AF', margin: '6px 0 0' }}>메일을 보려면 핀번호를 입력해주세요</p>
          <p style={{ fontSize: 11, color: '#059669', background: '#ECFDF5', borderRadius: 999, padding: '5px 10px', margin: '10px auto 0', display: 'inline-block', fontWeight: 700 }}>관리자는 PIN 없이 바로 열람</p>
          <p style={{ fontSize: 11, color: '#7C3AED', background: '#F3F0FF', borderRadius: 999, padding: '5px 10px', margin: '6px auto 0', display: 'inline-block', fontWeight: 700 }}>이 별칭만 30분 동안 열림</p>
        </div>

        <div style={{ position: 'relative', marginBottom: 8 }}>
          <KeyRound size={15} color="#C4B5FD" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)' }} />
          <input
            ref={inputRef}
            type={showPin ? 'text' : 'password'}
            inputMode="numeric"
            placeholder="핀번호"
            value={pin}
            onChange={e => { setPin(e.target.value.replace(/\D/g, '').slice(0, 12)); setError(''); }}
            onKeyDown={e => { if (e.key === 'Enter') handleUnlock(); }}
            style={{ width: '100%', padding: '13px 44px 13px 38px', borderRadius: 12, border: `1.5px solid ${error ? '#FCA5A5' : '#EDE9FE'}`, fontSize: 20, letterSpacing: 8, textAlign: 'center', color: '#1E1B4B', background: '#F8F6FF', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
          />
          <button type="button" onClick={() => setShowPin(v => !v)} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            {showPin ? <EyeOff size={16} color="#C4B5FD" /> : <Eye size={16} color="#C4B5FD" />}
          </button>
        </div>

        {error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#EF4444', marginBottom: 10 }}>
            <AlertCircle size={13} /> {error}
          </div>
        )}

        <button
          onClick={handleUnlock}
          disabled={loading || pin.trim().length < 4}
          style={{ width: '100%', padding: 14, borderRadius: 12, border: 'none', background: loading || pin.trim().length < 4 ? '#E9E4FF' : '#A78BFA', color: loading || pin.trim().length < 4 ? '#C4B5FD' : '#fff', fontWeight: 700, fontSize: 15, cursor: loading || pin.trim().length < 4 ? 'not-allowed' : 'pointer', fontFamily: 'inherit', marginBottom: 10 }}
        >
          {loading ? '확인 중' : '확인'}
        </button>

        {onCancel && (
          <button onClick={onCancel} style={{ width: '100%', padding: '10px', borderRadius: 12, border: 'none', background: '#F3F0FF', color: '#7C3AED', fontWeight: 600, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>
            취소
          </button>
        )}
      </div>
    </div>
  );
}

interface DbEmail {
  uid: number; subject: string; from_addr: string;
  original_from: string; alias_to: string; date_str: string; timestamp_sec: number;
}

interface Alias {
  id: number; email: string; enabled: boolean;
  nb_forward: number; nb_block: number; nb_reply: number;
  note: string | null; hasPin?: boolean;
}

// ─── 첫 방문 감지 ──────────────────────────────────────────────
const GUIDE_KEY = 'sl_guide_shown_v1';
function isFirstVisit(): boolean {
  try { return !localStorage.getItem(GUIDE_KEY); } catch { return false; }
}
function markGuideShown() {
  try { localStorage.setItem(GUIDE_KEY, '1'); } catch {}
}

// ─── 메인 페이지 ───────────────────────────────────────────────
export default function MailDetailPage() {
  const params = useParams<{ aliasId: string }>();
  const aliasId = Number(params.aliasId);
  const [, navigate] = useLocation();

  // 외부 직접 접속 여부 (referrer 없거나 다른 도메인이면 true)
  const isExternalEntry = (() => {
    try {
      const ref = document.referrer;
      if (!ref) return true;
      return new URL(ref).hostname !== window.location.hostname;
    } catch { return true; }
  })();

  const [pinMode, setPinMode] = useState<'locked' | 'unlocked' | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [alias, setAlias] = useState<Alias | null>(null);
  const [emails, setEmails] = useState<DbEmail[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cooldown = useCooldown(15_000);

  // 새 메일 알림
  const prevEmailUids = useRef<Set<number>>(new Set());
  const [newMailBanner, setNewMailBanner] = useState<{ count: number; subject: string } | null>(null);
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 사용법 가이드
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    (async () => {
      try { const s = await getAdminSession(); setIsAdmin(!!s.authenticated); } catch { setIsAdmin(false); }
    })();
    // 첫 방문이면 PIN 해제 후 가이드 표시 예약
    if (isFirstVisit()) setShowGuide(true);
  }, []);

  // ── 뒤로가기: 항상 '/' 로 이동 (PIN 화면 없이) ──────────────
  const handleBack = () => {
    try { sessionStorage.removeItem('sl_from_list'); } catch {}
    navigate('/');
  };

  useEffect(() => {
    setPinMode(null); setAlias(null); setEmails([]); setError(null);
    prevEmailUids.current = new Set();
  }, [aliasId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const adminSession = await getAdminSession();
        if (cancelled) return;
        if (adminSession.authenticated) {
          setIsAdmin(true);
          const aliasRes = await fetch(apiPath(`/sl/aliases/${aliasId}`));
          const aliasData = await aliasRes.json() as any;
          const pinStatusRes = await fetch(apiPath(`/sl/aliases/${aliasId}/pin/status`));
          const pinStatus = await pinStatusRes.json() as any;
          if (aliasData && !aliasData.error) {
            aliasData.hasPin = !!pinStatus.hasPin;
            setAlias(aliasData);
          }
          setPinMode('unlocked');
          return;
        }
        setIsAdmin(false);
        const [pinStatusRes, aliasRes] = await Promise.all([
          fetch(apiPath(`/sl/aliases/${aliasId}/pin/status`)),
          fetch(apiPath(`/sl/aliases/${aliasId}`)),
        ]);
        if (cancelled) return;
        const pinStatus = await pinStatusRes.json() as any;
        const aliasData = await aliasRes.json() as any;
        if (cancelled) return;
        if (aliasData && !aliasData.error) {
          aliasData.hasPin = !!pinStatus.hasPin;
          setAlias(aliasData);
        }
        if (!pinStatus.hasPin) {
          setPinMode('unlocked');
        } else {
          const unlocked = await isAliasUnlocked(aliasId);
          if (!cancelled) setPinMode(unlocked ? 'unlocked' : 'locked');
        }
      } catch {
        if (!cancelled) setPinMode('locked');
      }
    })();
    return () => { cancelled = true; };
  }, [aliasId]);

  const fetchData = async (_force = false) => {
    setLoading(true); setError(null);
    try {
      const aliasRes = await fetch(apiPath(`/sl/aliases/${aliasId}`));
      const aliasData = await aliasRes.json() as any;
      if (aliasData && !aliasData.error) {
        setAlias(aliasData);
        const emailListRes = await fetch(apiPath(`/email/list?alias=${encodeURIComponent(aliasData.email)}&limit=50`), {
          headers: getEmailAccessHeaders(aliasId),
        });
        const emailListData = await emailListRes.json() as any;
        const fetched: DbEmail[] = emailListData.emails || [];
        setEmails(fetched);
        // 초기 로드시 uid 기록
        prevEmailUids.current = new Set(fetched.map(e => e.uid));
      }
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (pinMode === 'unlocked') fetchData();
  }, [pinMode, aliasId]);

  // 1분 폴링 — 새 메일 감지 + 알림 배너
  useEffect(() => {
    if (pinMode !== 'unlocked') return;
    const timer = setInterval(() => {
      if (!alias) return;
      fetch(apiPath('/email/list?alias=' + encodeURIComponent(alias.email) + '&limit=50'), {
        headers: getEmailAccessHeaders(aliasId),
      })
        .then(r => r.json())
        .then((data: any) => {
          if (!data.emails) return;
          const fetched: DbEmail[] = data.emails;

          // 10분 내 새 uid 감지
          const TEN_MIN = 10 * 60;
          const cutoff = Math.floor(Date.now() / 1000) - TEN_MIN;
          const newOnes = fetched.filter(e => e.timestamp_sec >= cutoff && !prevEmailUids.current.has(e.uid));

          if (newOnes.length > 0) {
            // uid 목록 갱신
            fetched.forEach(e => prevEmailUids.current.add(e.uid));
            setEmails(fetched);

            // 배너 표시
            setNewMailBanner({ count: newOnes.length, subject: newOnes[0].subject || '(제목 없음)' });
            if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
            bannerTimerRef.current = setTimeout(() => setNewMailBanner(null), 6000);
          } else {
            setEmails(fetched);
          }
        })
        .catch(() => {});
    }, 60000);
    return () => { clearInterval(timer); if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current); };
  }, [pinMode, alias]);

  if (pinMode === null) {
    return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9CA3AF', fontSize: 14 }}>로딩 중...</div>;
  }

  if (pinMode === 'locked') {
    return (
      <PinInput
        mode="unlock"
        onSubmitPin={async (pin) => {
          const result = await verifyAliasPin(aliasId, pin, getGuestId());
          if (result.ok && result.data?.unlockToken) {
            setAliasUnlocked(aliasId, result.data.unlockToken);
            setPinMode('unlocked');
            return true;
          }
          return false;
        }}
        // ── 뒤로가기: PIN 화면에서도 목록으로 바로 ──
        onCancel={handleBack}
      />
    );
  }

  const hasPin = !!alias?.hasPin;
  const label = alias ? emailToLabel(alias.email) : `#${aliasId}`;

  const TEN_MIN_SEC = 10 * 60;
  const cutoff = Math.floor(Date.now() / 1000) - TEN_MIN_SEC;
  // 계정 정보 변경 요청 등 민감 메일 필터링
  const BLOCKED_KEYWORDS = [
    '계정 정보 변경', '정보 변경 요청', '비밀번호 변경 요청', '이메일 변경 요청',
    'change your account', 'update your account', 'account information change',
    'change your email', 'change your password', 'update your email',
    'change your netflix', 'update your netflix',
    '계정 변경', '이메일 주소 변경', '계정 이메일 변경',
    'account change', 'email address change',
  ];
  const isBlockedEmail = (e: DbEmail) => {
    const subject = (e.subject || '').toLowerCase();
    const from = (e.from_addr || '').toLowerCase();
    return BLOCKED_KEYWORDS.some(kw => subject.includes(kw.toLowerCase()) || from.includes(kw.toLowerCase()));
  };
  const recentEmails = emails.filter(e => e.timestamp_sec >= cutoff && !isBlockedEmail(e));

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', minHeight: '100vh', background: '#F8F6FF', paddingBottom: 80 }}>

      {/* 새 메일 알림 배너 */}
      {newMailBanner && (
        <>
          {/* 전광판 뒤 배경 공간 확보 */}
          <div style={{ height: 38 }} />
          <NewMailBanner
            count={newMailBanner.count}
            subject={newMailBanner.subject}
            onView={() => setNewMailBanner(null)}
            onDismiss={() => setNewMailBanner(null)}
          />
        </>
      )}

      {/* 사용법 가이드 팝업 (unlocked 상태에서만) */}
      {showGuide && (
        <GuidePopup onClose={() => { markGuideShown(); setShowGuide(false); }} />
      )}

      {/* 헤더 */}
      <div style={{ background: '#fff', borderBottom: '1px solid #E9E4FF', padding: '14px 16px 12px', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* 뒤로가기: 외부 직접 접속이면 숨김 */}
          {!isExternalEntry && (
            <button onClick={handleBack} style={{ background: '#F3F0FF', border: 'none', borderRadius: 10, padding: 8, cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
              <ArrowLeft size={17} color="#7C3AED" />
            </button>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <h1 style={{ fontSize: 17, fontWeight: 700, color: '#1E1B4B', margin: 0 }}>{label}</h1>
              {hasPin && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: '#EDE9FE', borderRadius: 6, padding: '2px 6px', fontSize: 10, color: '#7C3AED', fontWeight: 600 }}>
                  <Lock size={9} /> PIN
                </span>
              )}
            </div>
            {alias && <p style={{ fontSize: 10, color: '#9CA3AF', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{alias.email}</p>}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {isAdmin && (
              <button onClick={() => navigate('/admin')} style={{ background: '#F3F0FF', border: 'none', borderRadius: 10, padding: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#7C3AED', fontWeight: 600, fontFamily: 'inherit' }}>
                <Settings size={16} color="#A78BFA" /> 관리
              </button>
            )}
            <button
              onClick={() => cooldown.trigger(() => fetchData(true))}
              disabled={loading || !cooldown.ready}
              style={{ background: !cooldown.ready ? '#F3F4F6' : '#EDE9FE', border: 'none', borderRadius: 10, padding: '8px 10px', cursor: (loading || !cooldown.ready) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 4, minWidth: 52, justifyContent: 'center', fontSize: 11, color: !cooldown.ready ? '#9CA3AF' : '#7C3AED', fontWeight: 600, fontFamily: 'inherit', opacity: (loading || !cooldown.ready) ? 0.7 : 1 }}
            >
              <RefreshCw size={13} style={loading ? { animation: 'spin 1s linear infinite' } : {}} />
              {!loading && !cooldown.ready && <span>{cooldown.remaining}s</span>}
            </button>
          </div>
        </div>

        {isAdmin && (
          <div style={{ marginTop: 10, background: '#F8F6FF', borderRadius: 12, padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ fontSize: 11, color: '#7C3AED', fontWeight: 600 }}>관리자 계정으로 PIN을 관리할 수 있어요</div>
            <button onClick={() => navigate('/admin')} style={settingBtn}>
              <Shield size={13} color="#A78BFA" /> PIN 관리
            </button>
          </div>
        )}
      </div>

      <div style={{ padding: '14px 14px 0' }}>
        {alias && (
          <div style={{ background: '#fff', borderRadius: 16, padding: '14px 16px', marginBottom: 14, boxShadow: '0 2px 10px rgba(167,139,250,0.08)', border: '1.5px solid #EDE9FE', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, textAlign: 'center' }}>
            {[
              { label: '수신', value: `${alias.nb_forward}건`, color: '#A78BFA' },
              { label: '차단', value: `${alias.nb_block}건`, color: '#EF4444' },
              { label: '상태', value: alias.enabled ? '활성' : '비활성', color: alias.enabled ? '#059669' : '#9CA3AF' },
            ].map(item => (
              <div key={item.label}>
                <div style={{ fontSize: 15, fontWeight: 700, color: item.color }}>{item.value}</div>
                <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2 }}>{item.label}</div>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div style={{ background: '#FFF0F0', borderRadius: 12, padding: '10px 14px', marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: '#EF4444' }}>
            <AlertCircle size={14} /> {error}
          </div>
        )}

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[1, 2, 3].map(i => <div key={i} style={{ background: '#fff', borderRadius: 14, height: 72, animation: 'pulse 1.5s infinite', opacity: 0.5 }} />)}
          </div>
        ) : recentEmails.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#9CA3AF' }}>
            <Inbox size={32} color="#E9E4FF" style={{ margin: '0 auto 10px', display: 'block' }} />
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>최근 10분 내 수신된 메일이 없어요</div>
            <div style={{ fontSize: 12, color: '#C4B5FD' }}>새 메일이 오면 자동으로 표시돼요</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#9CA3AF', marginBottom: 4 }}>
              최근 10분 수신 메일 {recentEmails.length}건
            </div>
            {recentEmails.map((email) => {
              const svc = detectService(email.from_addr);
              const sender = senderLabel(email.from_addr);
              return (
                <button
                  key={email.uid}
                  onClick={() => navigate(`/mail/${aliasId}/email/${email.uid}`)}
                  style={{ background: '#fff', borderRadius: 14, padding: '12px 14px', boxShadow: '0 2px 8px rgba(167,139,250,0.07)', border: '1.5px solid #EDE9FE', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', width: '100%', textAlign: 'left', fontFamily: 'inherit', transition: 'border-color 0.15s' }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = '#A78BFA')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = '#EDE9FE')}
                >
                  <div style={{ width: 40, height: 40, borderRadius: 11, flexShrink: 0, background: svc ? svc.bg : '#F3F0FF', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                    {svc ? <img src={svc.logo} alt={svc.label} style={{ width: 26, height: 26, objectFit: 'contain' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} /> : <Mail size={16} color="#A78BFA" />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#1E1B4B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {email.subject || '(제목 없음)'}
                    </div>
                    <div style={{ fontSize: 11, color: '#9CA3AF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>{sender}</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                    <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 5, background: '#EEF5FF', color: '#2563EB' }}>수신</span>
                    <span style={{ fontSize: 10, color: '#C4B5FD', display: 'flex', alignItems: 'center', gap: 3 }}>
                      <Clock size={9} /> {timeAgo(email.timestamp_sec)}
                    </span>
                  </div>
                  <span style={{ fontSize: 16, color: '#C4B5FD' }}>›</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100%{opacity:.4} 50%{opacity:.7} }
        @keyframes slideUp { from { transform: translateY(100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes slideDown { from { transform: translate(-50%, -20px); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }
      `}</style>
    </div>
  );
}

const settingBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
  borderRadius: 10, border: '1px solid #EDE9FE', background: '#fff',
  fontSize: 13, fontWeight: 600, color: '#7C3AED', cursor: 'pointer', fontFamily: 'inherit',
};
