import { useState, useEffect, useRef } from "react";
import { useLocation, useParams } from "wouter";
import { useCooldown } from "../hooks/use-cooldown";
import {
  ArrowLeft, Mail, RefreshCw, Clock, Lock, KeyRound,
  Eye, EyeOff, AlertCircle, Loader2, Inbox, Settings,
  Shield, Trash2, CheckCircle, Forward,
} from "lucide-react";
import {
  getAliasPin, setAliasPin, removeAliasPin,
  isAliasUnlocked, setAliasUnlocked, lockAlias,
} from "../lib/pin-store";

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
  if (f.includes('disney'))  return { label: '디즈니+',  color: '#1A3E8C', bg: '#EEF3FF', logo: '/logos/disney.png' };
  if (f.includes('netflix')) return { label: '넷플릭스', color: '#E50914', bg: '#FFF0F0', logo: '/logos/netflix.png' };
  if (f.includes('watcha'))  return { label: '왓챠',     color: '#FF153C', bg: '#FFF0F3', logo: '/logos/watcha.png' };
  if (f.includes('wavve'))   return { label: '웨이브',   color: '#006BE9', bg: '#EEF5FF', logo: '/logos/wavve.png' };
  if (f.includes('tving'))   return { label: '티빙',     color: '#FF153C', bg: '#FFF0F3', logo: '/logos/tving.png' };
  if (f.includes('coupang')) return { label: '쿠팡',     color: '#E8343B', bg: '#FFF0F0', logo: '/logos/coupang.png' };
  if (f.includes('laftel'))  return { label: '라프텔',   color: '#6B4FBB', bg: '#F3EEFF', logo: '/logos/laftel.png' };
  if (f.includes('youtube') || f.includes('google')) return { label: '유튜브', color: '#FF0000', bg: '#FFF0F0', logo: '/logos/youtube.png' };
  if (f.includes('apple'))   return { label: 'Apple',   color: '#555',    bg: '#F5F5F5', logo: '/logos/apple.png' };
  if (f.includes('amazon') || f.includes('prime')) return { label: 'Prime', color: '#00A8E0', bg: '#EEF9FF', logo: '/logos/prime.png' };
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

// ─── PIN 입력 컴포넌트 ──────────────────────────────────────────
function PinInput({
  mode, storedPin, onSuccess, onCancel,
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
    if (pin === storedPin) { onSuccess(); }
    else { setError('핀번호가 틀렸어요'); setPin(''); }
  };

  const handleSetup = () => {
    if (pin.length < 4) { setError('4자리 이상 입력해주세요'); return; }
    if (step === 'enter') { setStep('confirm'); setError(''); return; }
    if (pin !== confirm) { setError('핀번호가 일치하지 않아요'); setConfirm(''); return; }
    onSuccess(pin);
  };

  const isUnlockMode = mode === 'unlock';
  const currentVal = step === 'confirm' ? confirm : pin;

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #F8F6FF 0%, #EDE9FE 100%)', padding: 24,
    }}>
      <div style={{ background: '#fff', borderRadius: 24, padding: '32px 28px', width: '100%', maxWidth: 360, boxShadow: '0 8px 32px rgba(167,139,250,0.18)' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ width: 64, height: 64, borderRadius: 20, background: '#EDE9FE', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
            <Lock size={28} color="#A78BFA" strokeWidth={2} />
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#1E1B4B', margin: 0 }}>
            {isUnlockMode ? '핀번호 입력' : mode === 'setup' ? '핀번호 설정' : '핀번호 변경'}
          </h2>
          <p style={{ fontSize: 13, color: '#9CA3AF', margin: '6px 0 0' }}>
            {isUnlockMode ? '메일을 보려면 핀번호를 입력해주세요'
              : step === 'enter' ? '사용할 핀번호를 입력해주세요' : '핀번호를 한 번 더 입력해주세요'}
          </p>
        </div>

        <div style={{ position: 'relative', marginBottom: 8 }}>
          <KeyRound size={15} color="#C4B5FD" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)' }} />
          <input
            ref={inputRef}
            type={showPin ? 'text' : 'password'}
            inputMode="numeric"
            placeholder={step === 'confirm' ? '핀번호 확인' : '핀번호'}
            value={currentVal}
            onChange={e => {
              const val = e.target.value.replace(/\D/g, '').slice(0, 12);
              if (step === 'confirm') setConfirm(val); else setPin(val);
              setError('');
            }}
            onKeyDown={e => { if (e.key === 'Enter') isUnlockMode ? handleUnlock() : handleSetup(); }}
            style={{
              width: '100%', padding: '13px 44px 13px 38px', borderRadius: 12,
              border: `1.5px solid ${error ? '#FCA5A5' : '#EDE9FE'}`,
              fontSize: 20, letterSpacing: 8, textAlign: 'center',
              color: '#1E1B4B', background: '#F8F6FF', outline: 'none',
              fontFamily: 'inherit', boxSizing: 'border-box',
            }}
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
          onClick={isUnlockMode ? handleUnlock : handleSetup}
          disabled={currentVal.length < 4}
          style={{
            width: '100%', padding: 14, borderRadius: 12, border: 'none',
            background: currentVal.length >= 4 ? '#A78BFA' : '#E9E4FF',
            color: currentVal.length >= 4 ? '#fff' : '#C4B5FD',
            fontWeight: 700, fontSize: 15, cursor: currentVal.length >= 4 ? 'pointer' : 'not-allowed',
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

// ─── 인터페이스 ────────────────────────────────────────────────
interface Activity {
  action: 'forward' | 'reply' | 'block';
  from: string; to: string; timestamp: number;
  reverse_alias: string; reverse_alias_address: string;
}

interface Alias {
  id: number; email: string; enabled: boolean;
  nb_forward: number; nb_block: number; nb_reply: number;
  note: string | null;
}

// ─── 메인 페이지 ───────────────────────────────────────────────
export default function MailDetailPage() {
  const params = useParams<{ aliasId: string }>();
  const aliasId = Number(params.aliasId);
  const [, navigate] = useLocation();

  // PIN 상태
  const [pinMode, setPinMode] = useState<'locked' | 'unlocked' | 'setup' | 'change' | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [pinSuccess, setPinSuccess] = useState(false);

  // 데이터
  const [alias, setAlias] = useState<Alias | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCached, setIsCached] = useState(false);
  // activity별 subject 캐시 { idx: subject }
  const [subjects, setSubjects] = useState<Record<number, string>>({});

  const cooldown = useCooldown(15_000);

  // PIN 초기 상태 결정
  useEffect(() => {
    const pin = getAliasPin(aliasId);
    if (!pin) {
      setPinMode('unlocked');
    } else if (isAliasUnlocked(aliasId)) {
      setPinMode('unlocked');
    } else {
      setPinMode('locked');
    }
  }, [aliasId]);

  // 데이터 로드
  const fetchData = async (force = false) => {
    setLoading(true); setError(null);
    try {
      const [aliasRes, actRes] = await Promise.all([
        fetch(`/api/sl/aliases/${aliasId}`),
        fetch(`/api/sl/aliases/${aliasId}/activities?page=0${force ? '&force=1' : ''}`),
      ]);
      const aliasData = await aliasRes.json() as any;
      const actData = await actRes.json() as any;
      if (aliasData && !aliasData.error) setAlias(aliasData);
      setActivities(actData.activities || []);
      setIsCached(!!actData._cached);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (pinMode === 'unlocked') fetchData();
  }, [pinMode, aliasId]);

  // 서비스 이메일인 activity에 대해 subject 비동기 로드
  useEffect(() => {
    if (!alias || !activities.length) return;
    activities.forEach((act, idx) => {
      if (act.action !== 'forward') return;
      if (!detectService(act.from)) return;
      if (subjects[idx] !== undefined) return;
      // 백그라운드로 subject만 가져오기
      fetch(`/api/email/raw?alias=${encodeURIComponent(alias.email)}&from=${encodeURIComponent(act.from)}&ts=${act.timestamp}`)
        .then(r => r.json())
        .then((d: any) => {
          if (d.subject) setSubjects(prev => ({ ...prev, [idx]: d.subject }));
        })
        .catch(() => {});
    });
  }, [activities, alias]);

  // ─── PIN 화면 ────────────────────────────────────────────────
  if (pinMode === 'locked') {
    return (
      <PinInput
        mode="unlock"
        storedPin={getAliasPin(aliasId)}
        onSuccess={() => { setAliasUnlocked(aliasId); setPinMode('unlocked'); }}
        onCancel={() => navigate('/')}
      />
    );
  }

  if (pinMode === 'setup') {
    return (
      <PinInput
        mode="setup"
        storedPin={null}
        onSuccess={(pin) => {
          if (pin) { setAliasPin(aliasId, pin); setAliasUnlocked(aliasId); }
          setPinMode('unlocked');
        }}
        onCancel={() => setPinMode('unlocked')}
      />
    );
  }

  if (pinMode === 'change') {
    return (
      <PinInput
        mode="change"
        storedPin={null}
        onSuccess={(pin) => {
          if (pin) { setAliasPin(aliasId, pin); setAliasUnlocked(aliasId); }
          setPinMode('unlocked');
        }}
        onCancel={() => setPinMode('unlocked')}
      />
    );
  }

  const hasPin = !!getAliasPin(aliasId);
  const label = alias ? emailToLabel(alias.email) : `#${aliasId}`;

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', minHeight: '100vh', background: '#F8F6FF', paddingBottom: 80 }}>
      {/* 헤더 */}
      <div style={{
        background: '#fff', borderBottom: '1px solid #E9E4FF',
        padding: '14px 16px 12px', position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => navigate('/')} style={{ background: '#F3F0FF', border: 'none', borderRadius: 10, padding: 8, cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
            <ArrowLeft size={17} color="#7C3AED" />
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <h1 style={{ fontSize: 17, fontWeight: 700, color: '#1E1B4B', margin: 0 }}>{label}</h1>
              {hasPin && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: '#EDE9FE', borderRadius: 6, padding: '2px 6px', fontSize: 10, color: '#7C3AED', fontWeight: 600 }}>
                  <Lock size={9} /> PIN
                </span>
              )}
            </div>
            {alias && (
              <p style={{ fontSize: 10, color: '#9CA3AF', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {alias.email}
              </p>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setShowSettings(v => !v)} style={{ background: showSettings ? '#EDE9FE' : '#F3F0FF', border: 'none', borderRadius: 10, padding: 8, cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
              <Settings size={16} color="#A78BFA" />
            </button>
            <button
              onClick={() => cooldown.trigger(() => fetchData(true))}
              disabled={loading || !cooldown.ready}
              style={{
                background: !cooldown.ready ? '#F3F4F6' : '#EDE9FE', border: 'none', borderRadius: 10,
                padding: '8px 10px', cursor: (loading || !cooldown.ready) ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 4, minWidth: 52, justifyContent: 'center',
                fontSize: 11, color: !cooldown.ready ? '#9CA3AF' : '#7C3AED',
                fontWeight: 600, fontFamily: 'inherit', opacity: (loading || !cooldown.ready) ? 0.7 : 1,
              }}
            >
              <RefreshCw size={13} style={loading ? { animation: 'spin 1s linear infinite' } : {}} />
              {!loading && !cooldown.ready && <span>{cooldown.remaining}s</span>}
            </button>
          </div>
        </div>

        {/* 설정 패널 */}
        {showSettings && (
          <div style={{ marginTop: 10, background: '#F8F6FF', borderRadius: 12, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', marginBottom: 2 }}>🔒 이 이메일 PIN 보안</div>
            {hasPin ? (
              <>
                <button onClick={() => { setShowSettings(false); setPinMode('change'); }} style={settingBtn}>
                  <KeyRound size={13} color="#A78BFA" /> 핀번호 변경
                </button>
                <button onClick={() => { removeAliasPin(aliasId); setShowSettings(false); }} style={{ ...settingBtn, color: '#EF4444' }}>
                  <Trash2 size={13} color="#EF4444" /> 핀번호 삭제
                </button>
                <button onClick={() => { lockAlias(aliasId); setPinMode('locked'); setShowSettings(false); }} style={settingBtn}>
                  <Lock size={13} color="#A78BFA" /> 지금 잠그기
                </button>
              </>
            ) : (
              <button onClick={() => { setShowSettings(false); setPinMode('setup'); }} style={settingBtn}>
                <Shield size={13} color="#A78BFA" /> 핀번호 설정하기
              </button>
            )}
          </div>
        )}
      </div>

      <div style={{ padding: '14px 14px 0' }}>
        {/* 요약 배너 */}
        {alias && (
          <div style={{
            background: '#fff', borderRadius: 16, padding: '14px 16px', marginBottom: 14,
            boxShadow: '0 2px 10px rgba(167,139,250,0.08)', border: '1.5px solid #EDE9FE',
            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, textAlign: 'center',
          }}>
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

        {isCached && (
          <div style={{ background: '#F3F0FF', borderRadius: 10, padding: '8px 12px', marginBottom: 10, fontSize: 11, color: '#9CA3AF', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Clock size={11} /> 캐시된 데이터 (최대 3분)
          </div>
        )}
        {error && (
          <div style={{ background: '#FFF0F0', borderRadius: 12, padding: '10px 14px', marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: '#EF4444' }}>
            <AlertCircle size={14} /> {error}
          </div>
        )}

        {/* 이메일 목록 */}
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[1, 2, 3].map(i => (
              <div key={i} style={{ background: '#fff', borderRadius: 14, height: 72, animation: 'pulse 1.5s infinite', opacity: 0.5 }} />
            ))}
          </div>
        ) : activities.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#9CA3AF' }}>
            <Inbox size={32} color="#E9E4FF" style={{ margin: '0 auto 10px', display: 'block' }} />
            수신된 메일이 없어요
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#9CA3AF', marginBottom: 4 }}>
              수신 메일 {activities.length}건
            </div>
            {activities.map((act, idx) => {
              const svc = detectService(act.from);
              const sender = senderLabel(act.from);
              const subject = subjects[idx]; // undefined = 로딩 중, string = 완료
              const hasLogo = !!svc;

              // 제목 라인: 서비스 이메일이면 subject(로딩 중엔 sender), 아니면 sender
              const titleText = hasLogo ? (subject ?? sender) : sender;
              // 부제목 라인: 서비스 이메일이면 sender name, 아니면 from 주소
              const subText = hasLogo ? sender : act.from;

              return (
                <button
                  key={idx}
                  onClick={() => navigate(`/mail/${aliasId}/activity/${idx}`)}
                  style={{
                    background: '#fff', borderRadius: 14, padding: '12px 14px',
                    boxShadow: '0 2px 8px rgba(167,139,250,0.07)',
                    border: '1.5px solid #EDE9FE',
                    display: 'flex', alignItems: 'center', gap: 10,
                    cursor: 'pointer', width: '100%', textAlign: 'left', fontFamily: 'inherit',
                    transition: 'border-color 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = '#A78BFA')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = '#EDE9FE')}
                >
                  {/* 아이콘: 서비스면 로고, 아니면 Mail */}
                  <div style={{
                    width: 40, height: 40, borderRadius: 11, flexShrink: 0,
                    background: svc ? svc.bg : '#F3F0FF',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                  }}>
                    {svc
                      ? <img src={svc.logo} alt={svc.label} style={{ width: 26, height: 26, objectFit: 'contain' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      : <Mail size={16} color="#A78BFA" />
                    }
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 13, fontWeight: 600, color: '#1E1B4B',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      opacity: hasLogo && !subject ? 0.5 : 1,
                    }}>
                      {titleText}
                    </div>
                    <div style={{ fontSize: 11, color: '#9CA3AF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
                      {subText}
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 5,
                      background: act.action === 'forward' ? '#EEF5FF' : act.action === 'reply' ? '#ECFDF5' : '#FFF0F0',
                      color: act.action === 'forward' ? '#2563EB' : act.action === 'reply' ? '#059669' : '#EF4444',
                    }}>
                      {act.action === 'forward' ? '수신' : act.action === 'reply' ? '발신' : '차단'}
                    </span>
                    <span style={{ fontSize: 10, color: '#C4B5FD', display: 'flex', alignItems: 'center', gap: 3 }}>
                      <Clock size={9} /> {timeAgo(act.timestamp)}
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
      `}</style>
    </div>
  );
}

const settingBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
  borderRadius: 10, border: '1px solid #EDE9FE', background: '#fff',
  fontSize: 13, fontWeight: 600, color: '#7C3AED', cursor: 'pointer', fontFamily: 'inherit',
};
