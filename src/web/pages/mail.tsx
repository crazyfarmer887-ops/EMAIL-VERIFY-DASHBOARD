import { apiPath } from '../lib/path';
import { useState, useEffect, useRef } from "react";
import {
  Mail, Inbox, ChevronRight, ChevronDown, RefreshCw,
  AlertCircle, Loader2, Clock, Lock, Shield,
  Eye, EyeOff, Settings, KeyRound
} from "lucide-react";

// ─── 핀 관련 상수 ──────────────────────────────────────────────
const PIN_STORAGE_KEY = 'sl_mail_pin';
const PIN_UNLOCKED_KEY = 'sl_mail_unlocked_until';
const UNLOCK_DURATION_MS = 30 * 60 * 1000; // 30분

function getStoredPin(): string | null {
  return localStorage.getItem(PIN_STORAGE_KEY);
}
function setStoredPin(pin: string) {
  localStorage.setItem(PIN_STORAGE_KEY, pin);
}
function removePin() {
  localStorage.removeItem(PIN_STORAGE_KEY);
  localStorage.removeItem(PIN_UNLOCKED_KEY);
}
function isUnlocked(): boolean {
  const until = localStorage.getItem(PIN_UNLOCKED_KEY);
  if (!until) return false;
  return Date.now() < Number(until);
}
function setUnlocked() {
  localStorage.setItem(PIN_UNLOCKED_KEY, String(Date.now() + UNLOCK_DURATION_MS));
}

// ─── 이메일 라벨 변환 ──────────────────────────────────────────
const SERVICE_MAP: Record<string, string> = {
  disney:   '디즈니',
  netflix:  '넷플릭스',
  watcha:   '왓챠',
  wavve:    '웨이브',
  tving:    '티빙',
  coupang:  '쿠팡플레이',
  laftel:   '라프텔',
  youtube:  '유튜브',
  apple:    'Apple',
  prime:    '프라임',
};

function emailToLabel(email: string): string {
  // "disney2.dollhouse753@aleeas.com" → "디즈니2"
  // 패턴: (서비스명)(숫자).(랜덤)@...
  const local = email.split('@')[0]; // "disney2.dollhouse753"
  const firstPart = local.split('.')[0]; // "disney2"

  for (const [key, label] of Object.entries(SERVICE_MAP)) {
    if (firstPart.toLowerCase().startsWith(key)) {
      const rest = firstPart.slice(key.length);
      const num = rest.match(/^\d+/)?.[0] || '';
      return `${label}${num}`;
    }
  }
  // 변환 안 되면 원본 표시 (짧게)
  return local.length > 18 ? local.slice(0, 16) + '..' : local;
}

// ─── 카테고리 정의 ──────────────────────────────────────────────
const CATEGORIES = [
  { key: 'all',     label: '전체',    color: '#7C3AED', bg: '#EDE9FE',  emoji: '📬' },
  { key: 'netflix', label: '넷플릭스', color: '#E50914', bg: '#FFF0F0',  emoji: '🎬' },
  { key: 'disney',  label: '디즈니+',  color: '#1A3E8C', bg: '#EEF3FF',  emoji: '✨' },
  { key: 'wavve',   label: '웨이브',   color: '#006BE9', bg: '#EEF5FF',  emoji: '🌊' },
  { key: 'tving',   label: '티빙',     color: '#FF153C', bg: '#FFF0F3',  emoji: '📺' },
  { key: 'watcha',  label: '왓챠',     color: '#FF4B84', bg: '#FFF0F6',  emoji: '🎞️' },
  { key: 'coupang', label: '쿠팡플레이',color: '#E8343B', bg: '#FFF0F0',  emoji: '🛒' },
  { key: 'laftel',  label: '라프텔',   color: '#6B4FBB', bg: '#F3EEFF',  emoji: '🌸' },
  { key: 'youtube', label: '유튜브',   color: '#FF0000', bg: '#FFF0F0',  emoji: '▶️' },
  { key: 'apple',   label: 'Apple',   color: '#333',    bg: '#F5F5F5',  emoji: '🍎' },
  { key: 'prime',   label: 'Prime',   color: '#00A8E0', bg: '#EEF9FF',  emoji: '📦' },
  { key: 'other',   label: '기타',     color: '#6B7280', bg: '#F3F4F6',  emoji: '📧' },
] as const;

type CategoryKey = typeof CATEGORIES[number]['key'];

function getCategoryKey(email: string): CategoryKey {
  const e = email.toLowerCase();
  for (const cat of CATEGORIES) {
    if (cat.key === 'all' || cat.key === 'other') continue;
    if (e.includes(cat.key)) return cat.key;
  }
  return 'other';
}

// ─── 카테고리 정렬 순서 ──────────────────────────────────────────
const CATEGORY_ORDER = ['netflix', 'disney', 'wavve', 'tving', 'watcha', 'coupang', 'laftel', 'youtube', 'google', 'apple', 'amazon', 'prime'];

function getCategoryRank(email: string): number {
  const e = email.toLowerCase();
  const idx = CATEGORY_ORDER.findIndex(k => e.includes(k));
  return idx === -1 ? CATEGORY_ORDER.length : idx;
}

function sortByCategory(aliases: Alias[]): Alias[] {
  return [...aliases].sort((a, b) => {
    const ra = getCategoryRank(a.email);
    const rb = getCategoryRank(b.email);
    if (ra !== rb) return ra - rb;
    return b.nb_forward - a.nb_forward;
  });
}

// ─── OTT 감지 ──────────────────────────────────────────────────
function detectService(from: string): { label: string; color: string; bg: string } | null {
  const f = from.toLowerCase();
  if (f.includes('disney'))  return { label: '디즈니+',   color: '#1A3E8C', bg: '#EEF3FF' };
  if (f.includes('netflix')) return { label: '넷플릭스',  color: '#E50914', bg: '#FFF0F0' };
  if (f.includes('watcha'))  return { label: '왓챠',      color: '#FF153C', bg: '#FFF0F3' };
  if (f.includes('wavve'))   return { label: '웨이브',    color: '#006BE9', bg: '#EEF5FF' };
  if (f.includes('tving'))   return { label: '티빙',      color: '#FF153C', bg: '#FFF0F3' };
  if (f.includes('coupang')) return { label: '쿠팡',      color: '#E8343B', bg: '#FFF0F0' };
  if (f.includes('laftel'))  return { label: '라프텔',    color: '#6B4FBB', bg: '#F3EEFF' };
  if (f.includes('youtube') || f.includes('google')) return { label: '유튜브', color: '#FF0000', bg: '#FFF0F0' };
  if (f.includes('apple'))   return { label: 'Apple',    color: '#555',    bg: '#F5F5F5' };
  if (f.includes('amazon') || f.includes('prime')) return { label: 'Prime', color: '#00A8E0', bg: '#EEF9FF' };
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

// ─── 핀 입력 컴포넌트 ──────────────────────────────────────────
function PinInput({
  mode, // 'unlock' | 'setup' | 'change'
  storedPin,
  onSuccess,
  onCancel,
}: {
  mode: 'unlock' | 'setup' | 'change';
  storedPin: string | null;
  onSuccess: (pin?: string) => void;
  onCancel?: () => void;
}) {
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [step, setStep] = useState<'enter' | 'confirm'>('enter');
  const [error, setError] = useState('');
  const [showPin, setShowPin] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, [step]);

  const handleUnlock = () => {
    if (pin === storedPin) {
      setUnlocked();
      onSuccess();
    } else {
      setError('핀번호가 틀렸어요');
      setPin('');
    }
  };

  const handleSetup = () => {
    if (pin.length < 4) { setError('4자리 이상 입력해주세요'); return; }
    if (step === 'enter') { setStep('confirm'); setError(''); return; }
    if (pin !== confirm) { setError('핀번호가 일치하지 않아요'); setConfirm(''); return; }
    setStoredPin(pin);
    setUnlocked();
    onSuccess(pin);
  };

  const isUnlockMode = mode === 'unlock';

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #F8F6FF 0%, #EDE9FE 100%)',
      padding: 24,
    }}>
      <div style={{ background: '#fff', borderRadius: 24, padding: '32px 28px', width: '100%', maxWidth: 360, boxShadow: '0 8px 32px rgba(167,139,250,0.18)' }}>
        {/* 아이콘 */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ width: 64, height: 64, borderRadius: 20, background: '#EDE9FE', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
            <Lock size={28} color="#A78BFA" strokeWidth={2} />
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#1E1B4B', margin: 0 }}>
            {isUnlockMode ? '핀번호 입력' : mode === 'setup' ? '핀번호 설정' : '핀번호 변경'}
          </h2>
          <p style={{ fontSize: 13, color: '#9CA3AF', margin: '6px 0 0' }}>
            {isUnlockMode
              ? '메일을 보려면 핀번호를 입력해주세요'
              : step === 'enter' ? '사용할 핀번호를 입력해주세요' : '핀번호를 한 번 더 입력해주세요'}
          </p>
        </div>

        {/* 입력 */}
        <div style={{ position: 'relative', marginBottom: 8 }}>
          <KeyRound size={15} color="#C4B5FD" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)' }} />
          <input
            ref={inputRef}
            type={showPin ? 'text' : 'password'}
            inputMode="numeric"
            placeholder={step === 'confirm' ? '핀번호 확인' : '핀번호'}
            value={step === 'confirm' ? confirm : pin}
            onChange={e => {
              const val = e.target.value.replace(/\D/g, '').slice(0, 12);
              if (step === 'confirm') setConfirm(val);
              else setPin(val);
              setError('');
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') isUnlockMode ? handleUnlock() : handleSetup();
            }}
            style={{
              width: '100%', padding: '13px 44px 13px 38px', borderRadius: 12,
              border: `1.5px solid ${error ? '#FCA5A5' : '#EDE9FE'}`,
              fontSize: 20, letterSpacing: 8, textAlign: 'center',
              color: '#1E1B4B', background: '#F8F6FF', outline: 'none',
              fontFamily: 'inherit', boxSizing: 'border-box',
            }}
          />
          <button
            type="button"
            onClick={() => setShowPin(v => !v)}
            style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}
          >
            {showPin ? <EyeOff size={16} color="#C4B5FD" /> : <Eye size={16} color="#C4B5FD" />}
          </button>
        </div>

        {error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#EF4444', marginBottom: 10 }}>
            <AlertCircle size={13} /> {error}
          </div>
        )}

        <button
          onClick={isUnlockMode ? handleUnlock : handleSetup}
          disabled={step === 'enter' ? pin.length < 4 : confirm.length < 4}
          style={{
            width: '100%', padding: 14, borderRadius: 12, border: 'none',
            background: (step === 'enter' ? pin.length : confirm.length) >= 4 ? '#A78BFA' : '#E9E4FF',
            color: (step === 'enter' ? pin.length : confirm.length) >= 4 ? '#fff' : '#C4B5FD',
            fontWeight: 700, fontSize: 15, cursor: (step === 'enter' ? pin.length : confirm.length) >= 4 ? 'pointer' : 'not-allowed',
            fontFamily: 'inherit', marginBottom: 10,
          }}
        >
          {isUnlockMode ? '확인' : step === 'enter' ? '다음' : '설정 완료'}
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

// ─── 메인 ──────────────────────────────────────────────────────
interface Alias {
  id: number; email: string; enabled: boolean;
  nb_forward: number; nb_block: number; nb_reply: number;
  note: string | null; creation_date: string;
}
interface Activity {
  action: 'forward' | 'reply' | 'block';
  from: string; to: string; timestamp: number;
  reverse_alias: string; reverse_alias_address: string;
}

type AppState = 'locked' | 'unlocked' | 'no_pin';

export default function MailPage() {
  // ─ 핀 상태
  const [pinState, setPinState] = useState<AppState>(() => {
    const pin = getStoredPin();
    if (!pin) return 'no_pin';
    if (isUnlocked()) return 'unlocked';
    return 'locked';
  });
  const [showPinSetup, setShowPinSetup] = useState(false);
  const [showPinChange, setShowPinChange] = useState(false);

  // ─ 카테고리 필터
  const [selectedCat, setSelectedCat] = useState<CategoryKey>('all');

  // ─ 데이터
  const [aliases, setAliases] = useState<Alias[]>([]);
  const [loading, setLoading] = useState(false);
  const [openAlias, setOpenAlias] = useState<number | null>(null);
  const [activities, setActivities] = useState<Record<number, Activity[]>>({});
  const [actLoading, setActLoading] = useState<Record<number, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [isCached, setIsCached] = useState(false);
  const [isRateLimited, setIsRateLimited] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const fetchAliases = async (force = false) => {
    setLoading(true); setError(null); setIsRateLimited(false);
    try {
      const res = await fetch(apiPath(`/sl/aliases?page=0${force ? '&force=1' : ''}`));
      const data = await res.json() as any;
      if (res.status === 429 || data._rate_limited) {
        setIsRateLimited(true);
        if (data.aliases?.length) {
          // 만료 캐시라도 보여줌
          setAliases(sortByCategory(data.aliases));
          setIsCached(true);
        } else {
          setError('API 요청 한도 초과. 잠시 후 다시 시도해주세요. (약 1분 후 재시도)');
        }
        return;
      }
      if (data.error) throw new Error(data.error);
      setAliases(sortByCategory(data.aliases || []));
      setIsCached(!!data._cached);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const fetchActivities = async (id: number, force = false) => {
    if (!force && activities[id] !== undefined) {
      setOpenAlias(openAlias === id ? null : id);
      return;
    }
    setOpenAlias(id);
    setActLoading(v => ({ ...v, [id]: true }));
    try {
      const res = await fetch(apiPath(`/sl/aliases/${id}/activities?page=0${force ? '&force=1' : ''}`));
      const data = await res.json() as any;
      if (res.status === 429 || data._rate_limited) {
        // 기존 캐시가 있으면 유지, 없으면 빈 배열
        if (activities[id] === undefined) setActivities(v => ({ ...v, [id]: [] }));
        return;
      }
      setActivities(v => ({ ...v, [id]: data.activities || [] }));
    } catch { setActivities(v => ({ ...v, [id]: [] })); }
    finally { setActLoading(v => ({ ...v, [id]: false })); }
  };

  // 잠금 해제되면 데이터 로드
  useEffect(() => {
    if (pinState === 'unlocked' || pinState === 'no_pin') fetchAliases();
  }, [pinState]);

  // ─── 핀 설정 화면 ──────────────────────────────────────────
  if (showPinSetup) {
    return (
      <PinInput
        mode="setup"
        storedPin={null}
        onSuccess={() => { setShowPinSetup(false); setPinState('unlocked'); }}
        onCancel={() => setShowPinSetup(false)}
      />
    );
  }
  if (showPinChange) {
    return (
      <PinInput
        mode="change"
        storedPin={null}
        onSuccess={() => { setShowPinChange(false); }}
        onCancel={() => setShowPinChange(false)}
      />
    );
  }

  // ─── 잠금 화면 ─────────────────────────────────────────────
  if (pinState === 'locked') {
    return (
      <PinInput
        mode="unlock"
        storedPin={getStoredPin()}
        onSuccess={() => setPinState('unlocked')}
      />
    );
  }

  // ─── 본문 ───────────────────────────────────────────────────
  // 카테고리별 count 계산
  const catCounts = CATEGORIES.reduce((acc, cat) => {
    acc[cat.key] = cat.key === 'all'
      ? aliases.length
      : aliases.filter(a => getCategoryKey(a.email) === cat.key).length;
    return acc;
  }, {} as Record<string, number>);

  // 현재 선택된 카테고리 필터링
  const filteredAliases = selectedCat === 'all'
    ? aliases
    : aliases.filter(a => getCategoryKey(a.email) === selectedCat);

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', minHeight: '100vh', background: '#F8F6FF', paddingBottom: 24 }}>
      {/* 헤더 */}
      <div style={{ background: '#fff', borderBottom: '1px solid #E9E4FF', padding: '16px 16px 12px', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: '#1E1B4B', margin: 0 }}>메일함</h1>
            <p style={{ fontSize: 11, color: '#9CA3AF', margin: '3px 0 0' }}>SimpleLogin 별칭 · {aliases.length}개</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setShowSettings(v => !v)} style={{ background: showSettings ? '#EDE9FE' : '#F3F0FF', border: 'none', borderRadius: 10, padding: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
              <Settings size={17} color="#A78BFA" />
            </button>
            <button onClick={() => fetchAliases(true)} disabled={loading} style={{ background: isRateLimited ? '#FFF3E0' : '#EDE9FE', border: 'none', borderRadius: 10, padding: '8px 12px', cursor: loading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: isRateLimited ? '#E65100' : '#7C3AED', fontWeight: 600, fontFamily: 'inherit', opacity: loading ? 0.7 : 1 }}>
              <RefreshCw size={13} style={loading ? { animation: 'spin 1s linear infinite' } : {}} />
              {isRateLimited ? '재시도' : '새로고침'}
            </button>
          </div>
        </div>

        {showSettings && (
          <div style={{ marginTop: 12, background: '#F8F6FF', borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#9CA3AF', marginBottom: 2 }}>🔒 핀 보안</div>
            {getStoredPin() ? (
              <>
                <button onClick={() => { setShowPinChange(true); setShowSettings(false); }} style={settingBtn}><KeyRound size={14} color="#A78BFA" /> 핀번호 변경</button>
                <button onClick={() => { removePin(); setPinState('no_pin'); setShowSettings(false); }} style={{ ...settingBtn, color: '#EF4444' }}><Lock size={14} color="#EF4444" /> 핀번호 삭제</button>
                <button onClick={() => { localStorage.removeItem(PIN_UNLOCKED_KEY); setPinState('locked'); setShowSettings(false); }} style={settingBtn}><Lock size={14} color="#A78BFA" /> 지금 잠그기</button>
              </>
            ) : (
              <button onClick={() => { setShowPinSetup(true); setShowSettings(false); }} style={settingBtn}><Shield size={14} color="#A78BFA" /> 핀번호 설정하기</button>
            )}
          </div>
        )}
      </div>

      {/* ─── 카테고리 탭 바 ─── */}
      <div style={{ background: '#fff', borderBottom: '1px solid #EDE9FE', overflowX: 'auto', display: 'flex', padding: '0 12px', gap: 2, scrollbarWidth: 'none' }}>
        {CATEGORIES.map(cat => {
          const count = catCounts[cat.key] ?? 0;
          if (cat.key !== 'all' && cat.key !== 'other' && count === 0) return null;
          const isActive = selectedCat === cat.key;
          return (
            <button
              key={cat.key}
              onClick={() => { setSelectedCat(cat.key); setOpenAlias(null); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '10px 12px',
                background: 'transparent',
                border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                borderBottom: isActive ? `2px solid ${cat.color}` : '2px solid transparent',
                color: isActive ? cat.color : '#9CA3AF',
                fontWeight: isActive ? 700 : 500,
                fontSize: 13,
                whiteSpace: 'nowrap',
                transition: 'all 0.15s',
                flexShrink: 0,
              }}
            >
              <span style={{ fontSize: 15 }}>{cat.emoji}</span>
              <span>{cat.label}</span>
              {count > 0 && (
                <span style={{
                  fontSize: 10, fontWeight: 700, minWidth: 18, height: 18,
                  background: isActive ? cat.color : '#E5E7EB',
                  color: isActive ? '#fff' : '#6B7280',
                  borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: '0 4px',
                }}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ─── 본문 ─── */}
      <div style={{ padding: '12px 12px 0' }}>
          {/* Rate limit / 캐시 안내 */}
          {isRateLimited && (
            <div style={{ background: '#FFF3E0', borderRadius: 12, padding: '10px 14px', marginBottom: 10, display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: '#E65100' }}>
              <AlertCircle size={14} />
              <span>{isCached ? '이전 데이터 표시 중. 1분 후 재시도해주세요.' : 'API 한도 초과. 잠시 후 재시도해주세요.'}</span>
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

          {/* 카테고리 제목 */}
          {!loading && (() => {
            const cat = CATEGORIES.find(c => c.key === selectedCat)!;
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                <span style={{ fontSize: 14 }}>{cat.emoji}</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: cat.color }}>{cat.label}</span>
                <span style={{ fontSize: 11, color: '#9CA3AF' }}>({filteredAliases.length}개)</span>
              </div>
            );
          })()}

          {/* 로딩 */}
          {loading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[1,2,3,4].map(i => <div key={i} style={{ background: '#fff', borderRadius: 14, height: 68, animation: 'pulse 1.5s infinite', opacity: 0.5 }} />)}
            </div>
          )}

          {/* 별칭 목록 */}
          {!loading && filteredAliases.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#C4B5FD', fontSize: 13 }}>
              <Inbox size={32} color="#EDE9FE" style={{ display: 'block', margin: '0 auto 10px' }} />
              이 카테고리에 별칭이 없어요
            </div>
          )}

          {!loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filteredAliases.map(alias => {
              const label = emailToLabel(alias.email);
              const isOpen = openAlias === alias.id;
              const acts = activities[alias.id] || [];
              const isActLoading = actLoading[alias.id];

              return (
                <div key={alias.id} style={{
                  background: '#fff', borderRadius: 16, overflow: 'hidden',
                  boxShadow: '0 2px 10px rgba(167,139,250,0.08)',
                  border: `1.5px solid ${isOpen ? '#A78BFA' : alias.enabled ? '#EDE9FE' : '#F0F0F0'}`,
                  opacity: alias.enabled ? 1 : 0.65,
                }}>
                  <button onClick={() => fetchActivities(alias.id)} style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                    padding: '13px 14px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                    {/* 아이콘 */}
                    <div style={{ width: 42, height: 42, borderRadius: 12, background: alias.enabled ? '#EDE9FE' : '#F3F4F6', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Mail size={20} color={alias.enabled ? '#A78BFA' : '#9CA3AF'} strokeWidth={2} />
                    </div>

                    {/* 라벨 + 이메일 */}
                    <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#1E1B4B' }}>{label}</div>
                      <div style={{ fontSize: 11, color: '#9CA3AF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
                        {alias.email}
                      </div>
                    </div>

                    {/* 수신 수 + 상태 */}
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: alias.nb_forward > 0 ? '#A78BFA' : '#C4B5FD' }}>
                        {alias.nb_forward}건
                      </div>
                      <div style={{ fontSize: 10, color: alias.enabled ? '#059669' : '#9CA3AF', marginTop: 2 }}>
                        {alias.enabled ? '활성' : '비활성'}
                      </div>
                    </div>

                    {isOpen ? <ChevronDown size={15} color="#A78BFA" /> : <ChevronRight size={15} color="#C4B5FD" />}
                  </button>

                  {/* 활동 목록 */}
                  {isOpen && (
                    <div style={{ borderTop: '1px solid #F3F0FF' }}>
                      {isActLoading ? (
                        <div style={{ padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#A78BFA', fontSize: 13 }}>
                          <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> 불러오는 중...
                        </div>
                      ) : acts.length === 0 ? (
                        <div style={{ padding: '20px', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>
                          <Inbox size={26} color="#E9E4FF" style={{ margin: '0 auto 8px', display: 'block' }} />
                          수신된 메일이 없어요
                        </div>
                      ) : (
                        acts.slice(0, 30).map((act, idx) => {
                          const svc = detectService(act.from);
                          const sender = senderLabel(act.from);
                          return (
                            <div key={idx} style={{
                              display: 'flex', alignItems: 'center', gap: 10,
                              padding: '10px 14px',
                              borderBottom: idx < Math.min(acts.length, 30) - 1 ? '1px solid #F8F6FF' : 'none',
                              background: idx % 2 === 0 ? '#FDFCFF' : '#fff',
                            }}>
                              {/* 서비스 뱃지 */}
                              <div style={{
                                width: 34, height: 34, borderRadius: 9, flexShrink: 0,
                                background: svc ? svc.bg : '#F3F0FF',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 10, fontWeight: 700, color: svc ? svc.color : '#A78BFA',
                              }}>
                                {svc ? svc.label.slice(0, 3) : <Mail size={14} color="#A78BFA" />}
                              </div>

                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 12, fontWeight: 600, color: '#1E1B4B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {sender}
                                </div>
                                <div style={{ fontSize: 10, color: '#9CA3AF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
                                  {act.from}
                                </div>
                              </div>

                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
                                <span style={{
                                  fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 5,
                                  background: act.action === 'forward' ? '#EEF5FF' : act.action === 'reply' ? '#ECFDF5' : '#FFF0F0',
                                  color: act.action === 'forward' ? '#2563EB' : act.action === 'reply' ? '#059669' : '#EF4444',
                                }}>
                                  {act.action === 'forward' ? '수신' : act.action === 'reply' ? '발신' : '차단'}
                                </span>
                                <span style={{ fontSize: 10, color: '#C4B5FD', display: 'flex', alignItems: 'center', gap: 2 }}>
                                  <Clock size={9} /> {timeAgo(act.timestamp)}
                                </span>
                              </div>
                            </div>
                          );
                        })
                      )}
                      {acts.length > 30 && (
                        <div style={{ padding: '10px', textAlign: 'center', fontSize: 11, color: '#9CA3AF' }}>
                          + {acts.length - 30}건 더 있어요
                        </div>
                      )}
                    </div>
                  )}
                </div>
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

const settingBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px',
  borderRadius: 10, border: '1px solid #EDE9FE', background: '#fff',
  fontSize: 13, fontWeight: 600, color: '#7C3AED', cursor: 'pointer', fontFamily: 'inherit',
};
