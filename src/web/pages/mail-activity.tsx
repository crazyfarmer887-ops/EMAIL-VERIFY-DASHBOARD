import { useState, useEffect, useRef, useCallback } from "react";
import { useCooldown } from "../hooks/use-cooldown";
import { useLocation, useParams } from "wouter";
import {
  ArrowLeft, Mail, Clock, Forward, Reply, ShieldOff,
  Copy, Check, CornerDownRight, AtSign, User,
  Code, Eye, Loader2, AlertCircle, RefreshCw,
} from "lucide-react";

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
      const num = firstPart.slice(key.length).match(/^\d+/)?.[0] || '';
      return `${label}${num}`;
    }
  }
  return local.length > 20 ? local.slice(0, 18) + '..' : local;
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

function senderLabel(from: string) {
  const m = from.match(/^"?([^"<]+)"?\s*</);
  return m ? m[1].trim() : from.replace(/<.*>/, '').trim() || from;
}

function senderEmail(from: string) {
  return from.match(/<([^>]+)>/)?.[1] || from;
}

function formatDateFull(ts: number) {
  return new Date(ts * 1000).toLocaleString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', weekday: 'long',
  });
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      style={{ background: copied ? '#ECFDF5' : '#F3F0FF', border: 'none', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: copied ? '#059669' : '#7C3AED', fontWeight: 600, fontFamily: 'inherit' }}>
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? '복사됨' : '복사'}
    </button>
  );
}

interface Activity {
  action: 'forward' | 'reply' | 'block';
  from: string; to: string; timestamp: number;
  reverse_alias: string; reverse_alias_address: string;
}

interface RawEmail {
  subject: string; from: string; originalFrom: string;
  date: string; html: string | null; text: string | null; aliasTo: string;
}

// ─── HTML 뷰어 (sandboxed iframe) ──────────────────────────────
function HtmlViewer({ html }: { html: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(400);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) return;
    doc.open();
    doc.write(`
      <!DOCTYPE html><html><head>
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <style>
        body { margin: 0; padding: 12px; font-family: -apple-system,sans-serif; font-size: 14px; color: #111; }
        img { max-width: 100% !important; height: auto !important; }
        a { color: #7C3AED; }
        * { box-sizing: border-box; }
      </style>
      </head><body>${html}</body></html>
    `);
    doc.close();
    // 높이 자동 조정
    const adjust = () => {
      try {
        const h = iframe.contentDocument?.documentElement?.scrollHeight;
        if (h && h > 0) setHeight(Math.min(h + 20, 2000));
      } catch { /**/ }
    };
    iframe.onload = adjust;
    setTimeout(adjust, 300);
  }, [html]);

  return (
    <iframe
      ref={iframeRef}
      sandbox="allow-same-origin"
      style={{ width: '100%', height, border: 'none', borderRadius: 12, display: 'block' }}
      title="email-content"
    />
  );
}

// ─── 메인 ──────────────────────────────────────────────────────
export default function MailActivityPage() {
  const params = useParams<{ aliasId: string; actIdx: string }>();
  const aliasId = Number(params.aliasId);
  const actIdx  = Number(params.actIdx);
  const [, navigate] = useLocation();

  const [activity, setActivity]   = useState<Activity | null>(null);
  const [aliasEmail, setAliasEmail] = useState('');
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);

  // 원본 이메일
  const [rawEmail, setRawEmail]   = useState<RawEmail | null>(null);
  const [rawLoading, setRawLoading] = useState(false);
  const [rawError, setRawError]   = useState<string | null>(null);
  const retryCooldown = useCooldown(20_000); // 재시도 20초
  const [viewMode, setViewMode]   = useState<'html' | 'text' | 'meta'>('html');

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [aliasRes, actRes] = await Promise.all([
          fetch(`/api/sl/aliases/${aliasId}`),
          fetch(`/api/sl/aliases/${aliasId}/activities?page=0`),
        ]);
        const aliasData = await aliasRes.json() as any;
        const actData   = await actRes.json()   as any;
        if (aliasData?.email) setAliasEmail(aliasData.email);
        const acts: Activity[] = actData.activities || [];
        if (acts[actIdx]) setActivity(acts[actIdx]);
        else setError('메일을 찾을 수 없어요');
      } catch (e: any) { setError(e.message); }
      finally { setLoading(false); }
    })();
  }, [aliasId, actIdx]);

  // activity 로드 후 원본 이메일 자동 로드
  useEffect(() => {
    if (!activity || activity.action !== 'forward') return;
    loadRawEmail(activity);
  }, [activity, aliasEmail]);

  const loadRawEmail = async (act: Activity) => {
    setRawLoading(true); setRawError(null);
    try {
      const url = `/api/email/raw?alias=${encodeURIComponent(aliasEmail)}&from=${encodeURIComponent(act.from)}&ts=${act.timestamp}`;
      const res = await fetch(url);
      const data = await res.json() as any;
      if (data.error) { setRawError(data.error); return; }
      setRawEmail(data);
    } catch (e: any) { setRawError(e.message); }
    finally { setRawLoading(false); }
  };

  const actionCfg = {
    forward: { label: '수신', color: '#2563EB', bg: '#EEF5FF', Icon: Forward },
    reply:   { label: '발신', color: '#059669', bg: '#ECFDF5', Icon: Reply },
    block:   { label: '차단', color: '#EF4444', bg: '#FFF0F0', Icon: ShieldOff },
  };

  const cfg = activity ? actionCfg[activity.action] : null;
  const svc = activity ? detectService(activity.from) : null;
  const label = aliasEmail ? emailToLabel(aliasEmail) : `#${aliasId}`;

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', minHeight: '100vh', background: '#F8F6FF', paddingBottom: 80 }}>
      {/* 헤더 */}
      <div style={{ background: '#fff', borderBottom: '1px solid #E9E4FF', padding: '14px 16px 12px', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => navigate(`/mail/${aliasId}`)} style={{ background: '#F3F0FF', border: 'none', borderRadius: 10, padding: 8, cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
            <ArrowLeft size={17} color="#7C3AED" />
          </button>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: 16, fontWeight: 700, color: '#1E1B4B', margin: 0 }}>이메일 원본</h1>
            <p style={{ fontSize: 10, color: '#9CA3AF', margin: '2px 0 0' }}>{label}</p>
          </div>
          {cfg && (
            <span style={{ background: cfg.bg, color: cfg.color, borderRadius: 8, padding: '4px 10px', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <cfg.Icon size={12} /> {cfg.label}
            </span>
          )}
        </div>
      </div>

      <div style={{ padding: '14px 14px 0' }}>
        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[80, 60, 120].map((h, i) => <div key={i} style={{ background: '#fff', borderRadius: 14, height: h, animation: 'pulse 1.5s infinite', opacity: 0.5 }} />)}
          </div>
        )}

        {error && <div style={{ background: '#FFF0F0', borderRadius: 12, padding: 16, color: '#EF4444', fontSize: 14, textAlign: 'center' }}>{error}</div>}

        {!loading && activity && cfg && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* 발신자 카드 */}
            <div style={{ background: '#fff', borderRadius: 18, padding: '16px 18px', boxShadow: '0 2px 12px rgba(167,139,250,0.10)', border: `1.5px solid ${svc?.bg || '#EDE9FE'}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <div style={{ width: 48, height: 48, borderRadius: 13, background: svc?.bg || '#F3F0FF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
                  {svc
                    ? <img src={svc.logo} alt={svc.label} style={{ width: 32, height: 32, objectFit: 'contain' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    : <Mail size={20} color="#A78BFA" />
                  }
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#1E1B4B' }}>{senderLabel(activity.from)}</div>
                  <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{senderEmail(activity.from)}</div>
                </div>
              </div>
              {rawEmail?.subject && (
                <div style={{ fontSize: 14, fontWeight: 600, color: '#1E1B4B', marginBottom: 8, lineHeight: 1.4 }}>{rawEmail.subject}</div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#9CA3AF', background: '#F8F6FF', borderRadius: 9, padding: '7px 12px' }}>
                <Clock size={12} color="#C4B5FD" /> {formatDateFull(activity.timestamp)}
              </div>
            </div>

            {/* 원본 이메일 본문 */}
            {activity.action === 'forward' && (
              <div style={{ background: '#fff', borderRadius: 16, overflow: 'hidden', boxShadow: '0 2px 10px rgba(167,139,250,0.08)', border: '1.5px solid #EDE9FE' }}>
                {/* 탭 바 */}
                <div style={{ display: 'flex', borderBottom: '1px solid #F3F0FF', background: '#F8F6FF' }}>
                  {[
                    { id: 'html' as const, label: '원본 HTML', Icon: Eye },
                    { id: 'text' as const, label: '텍스트', Icon: Code },
                    { id: 'meta' as const, label: '메타', Icon: AtSign },
                  ].map(tab => (
                    <button key={tab.id} onClick={() => setViewMode(tab.id)} style={{
                      flex: 1, padding: '10px 0', background: 'none', border: 'none',
                      cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
                      color: viewMode === tab.id ? '#7C3AED' : '#9CA3AF',
                      borderBottom: viewMode === tab.id ? '2px solid #A78BFA' : '2px solid transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                    }}>
                      <tab.Icon size={13} /> {tab.label}
                    </button>
                  ))}
                </div>

                <div style={{ padding: 14 }}>
                  {rawLoading && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '30px 0', color: '#A78BFA', fontSize: 13 }}>
                      <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> 이메일 불러오는 중...
                    </div>
                  )}

                  {rawError && !rawLoading && (
                    <div style={{ background: '#FFF0F0', borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#EF4444', fontSize: 12 }}>
                        <AlertCircle size={14} /> {rawError}
                      </div>
                      <button
                        onClick={() => retryCooldown.trigger(() => loadRawEmail(activity))}
                        disabled={!retryCooldown.ready}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#FFF', border: '1px solid #EDE9FE', borderRadius: 8, padding: '7px 12px', cursor: retryCooldown.ready ? 'pointer' : 'not-allowed', fontSize: 12, color: retryCooldown.ready ? '#7C3AED' : '#9CA3AF', fontWeight: 600, fontFamily: 'inherit', opacity: retryCooldown.ready ? 1 : 0.6 }}
                      >
                        <RefreshCw size={12} />
                        {retryCooldown.ready ? '다시 시도' : `${retryCooldown.remaining}초 후 재시도`}
                      </button>
                    </div>
                  )}

                  {!rawLoading && !rawError && rawEmail && (
                    <>
                      {viewMode === 'html' && (
                        rawEmail.html
                          ? <HtmlViewer html={rawEmail.html} />
                          : <div style={{ textAlign: 'center', color: '#9CA3AF', padding: '30px 0', fontSize: 13 }}>HTML 본문 없음 (텍스트 탭 확인)</div>
                      )}
                      {viewMode === 'text' && (
                        rawEmail.text
                          ? <pre style={{ fontSize: 12, color: '#374151', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, lineHeight: 1.6, maxHeight: 400, overflow: 'auto' }}>{rawEmail.text}</pre>
                          : <div style={{ textAlign: 'center', color: '#9CA3AF', padding: '30px 0', fontSize: 13 }}>텍스트 본문 없음</div>
                      )}
                      {viewMode === 'meta' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {[
                            { label: '제목', value: rawEmail.subject },
                            { label: '발신자 (원본)', value: rawEmail.originalFrom },
                            { label: '수신 별칭', value: rawEmail.aliasTo },
                            { label: '날짜', value: rawEmail.date },
                          ].map(item => item.value ? (
                            <div key={item.label} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                              <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', minWidth: 80, paddingTop: 2 }}>{item.label}</div>
                              <div style={{ flex: 1, fontSize: 12, color: '#1E1B4B', wordBreak: 'break-all' }}>{item.value}</div>
                              <CopyBtn text={item.value} />
                            </div>
                          ) : null)}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            {/* 메타 정보 (차단/발신 시) */}
            {activity.action !== 'forward' && (
              <div style={{ background: '#fff', borderRadius: 16, overflow: 'hidden', boxShadow: '0 2px 10px rgba(167,139,250,0.08)', border: '1.5px solid #EDE9FE' }}>
                {[
                  { Icon: User,           label: '보낸 사람',     value: activity.from },
                  { Icon: AtSign,         label: '받은 주소',     value: activity.to },
                  { Icon: CornerDownRight, label: '리버스 별칭',  value: activity.reverse_alias_address || activity.reverse_alias },
                ].filter(r => r.value).map((row, i, arr) => (
                  <div key={row.label} style={{ padding: '12px 16px', borderBottom: i < arr.length - 1 ? '1px solid #F3F0FF' : 'none', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <div style={{ width: 28, height: 28, borderRadius: 8, background: '#F3F0FF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                      <row.Icon size={13} color="#A78BFA" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', marginBottom: 3 }}>{row.label}</div>
                      <div style={{ fontSize: 12, color: '#1E1B4B', wordBreak: 'break-all' }}>{row.value}</div>
                    </div>
                    <CopyBtn text={row.value} />
                  </div>
                ))}
              </div>
            )}

            {/* 답장 안내 */}
            {activity.action === 'forward' && activity.reverse_alias_address && (
              <div style={{ background: '#fff', borderRadius: 14, padding: '14px 16px', border: '1.5px dashed #C4B5FD' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#7C3AED', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Reply size={13} /> 답장하려면
                </div>
                <div style={{ background: '#F3F0FF', borderRadius: 9, padding: '9px 12px', fontSize: 12, color: '#7C3AED', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, wordBreak: 'break-all' }}>
                  <span style={{ flex: 1 }}>{activity.reverse_alias_address}</span>
                  <CopyBtn text={activity.reverse_alias_address} />
                </div>
              </div>
            )}

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
