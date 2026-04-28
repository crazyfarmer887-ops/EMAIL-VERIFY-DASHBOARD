import { apiPath } from '../lib/path';
import { useState, useEffect } from "react";
import { useCooldown } from "../hooks/use-cooldown";
import { useLocation, useParams } from "wouter";
import {
  ArrowLeft, Mail, Clock, Forward,
  Copy, Check, AtSign,
  Code, Eye, AlertCircle, RefreshCw,
} from "lucide-react";
import { getEmailAccessHeaders, getUnlockToken } from "../lib/pin-store";
import { getAdminSession } from "../lib/pin-api";

const SERVICE_MAP: Record<string, string> = {
  disney: "디즈니", netflix: "넷플릭스", watcha: "왓챠", wavve: "웨이브",
  tving: "티빙", coupang: "쿠팡플레이", laftel: "라프텔",
  youtube: "유튜브", apple: "Apple", prime: "프라임",
};

function emailToLabel(email: string): string {
  const local = email.split("@")[0];
  const firstPart = local.split(".")[0];
  for (const [key, label] of Object.entries(SERVICE_MAP)) {
    if (firstPart.toLowerCase().startsWith(key)) {
      const num = firstPart.slice(key.length).match(/^\d+/)?.[0] || "";
      return `${label}${num}`;
    }
  }
  return local.length > 20 ? local.slice(0, 18) + ".." : local;
}

function detectService(from: string): { label: string; color: string; bg: string; logo: string } | null {
  const f = from.toLowerCase();
  if (f.includes("disney"))  return { label: "디즈니+",  color: "#1A3E8C", bg: "#EEF3FF", logo: "/email/logos/disney.png" };
  if (f.includes("netflix")) return { label: "넷플릭스", color: "#E50914", bg: "#FFF0F0", logo: "/email/logos/netflix.png" };
  if (f.includes("watcha"))  return { label: "왓챠",     color: "#FF153C", bg: "#FFF0F3", logo: "/email/logos/watcha.png" };
  if (f.includes("wavve"))   return { label: "웨이브",   color: "#006BE9", bg: "#EEF5FF", logo: "/email/logos/wavve.png" };
  if (f.includes("tving"))   return { label: "티빙",     color: "#FF153C", bg: "#FFF0F3", logo: "/email/logos/tving.png" };
  if (f.includes("coupang")) return { label: "쿠팡",     color: "#E8343B", bg: "#FFF0F0", logo: "/email/logos/coupang.png" };
  if (f.includes("laftel"))  return { label: "라프텔",   color: "#6B4FBB", bg: "#F3EEFF", logo: "/email/logos/laftel.png" };
  if (f.includes("youtube") || f.includes("google")) return { label: "유튜브", color: "#FF0000", bg: "#FFF0F0", logo: "/email/logos/youtube.png" };
  if (f.includes("apple"))   return { label: "Apple",   color: "#555",    bg: "#F5F5F5", logo: "/email/logos/apple.png" };
  if (f.includes("amazon") || f.includes("prime")) return { label: "Prime", color: "#00A8E0", bg: "#EEF9FF", logo: "/email/logos/prime.png" };
  return null;
}

function senderLabel(from: string) {
  const m = from.match(/^"?([^"<]+)"?\s*</);
  return m ? m[1].trim() : from.replace(/<.*>/, "").trim() || from;
}

function senderEmail(from: string) {
  return from.match(/<([^>]+)>/)?.[1] || from;
}

function formatDateFull(ts: number) {
  return new Date(ts * 1000).toLocaleString("ko-KR", {
    year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit", weekday: "long",
  });
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      style={{ background: copied ? "#ECFDF5" : "#F3F0FF", border: "none", borderRadius: 6, padding: "3px 8px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: copied ? "#059669" : "#7C3AED", fontWeight: 600, fontFamily: "inherit" }}
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? "복사됨" : "복사"}
    </button>
  );
}

interface RawEmail {
  subject: string; from: string; originalFrom: string;
  date: string; html: string | null; text: string | null; aliasTo: string;
  timestamp_sec: number;
  extractedAuth?: {
    codes: string[];
    links: string[];
    confidence: 'high' | 'medium' | 'low' | 'none';
    source: 'subject' | 'text' | 'html' | 'mixed' | 'none';
    matchedPattern?: string;
  };
}

function HtmlViewer({ html }: { html: string }) {
  const srcDoc = `<!DOCTYPE html><html><head>
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <base target="_blank"><style>body{margin:0;padding:12px;font-family:-apple-system,sans-serif;font-size:14px;color:#111;}img{max-width:100%!important;height:auto!important;}a{color:#7C3AED;}*{box-sizing:border-box;}</style>
      </head><body>${html}</body></html>`;

  return (
    <iframe
      srcDoc={srcDoc}
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      style={{ width: "100%", height: 600, border: "none", borderRadius: 12, display: "block" }}
      title="email-content"
    />
  );
}

export default function MailActivityPage() {
  const params = useParams<{ aliasId: string; uid: string }>();
  const aliasId = Number(params.aliasId);
  const uid     = Number(params.uid);
  const [, navigate] = useLocation();

  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [pinChecked, setPinChecked] = useState(false);
  const [pinBlocked, setPinBlocked] = useState(false);
  const [rawEmail, setRawEmail]     = useState<RawEmail | null>(null);
  const retryCooldown = useCooldown(20_000);
  const [viewMode, setViewMode]     = useState<"html" | "text" | "meta">("html");
  const [aliasEmail, setAliasEmail] = useState("");

  // PIN 확인: 로컬 토큰 존재 여부만 (서버 검증 X → race-condition 없음)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const adminSession = await getAdminSession();
        if (cancelled) return;
        if (adminSession.authenticated) {
          setPinBlocked(false);
          setPinChecked(true);
          return;
        }
        const res = await fetch(apiPath(`/sl/aliases/${aliasId}/pin/status`));
        const data = await res.json() as any;
        if (cancelled) return;
        if (!data.hasPin) {
          setPinChecked(true);
          return;
        }
        // PIN 있는 alias → 로컬 토큰만 확인
        const token = getUnlockToken(aliasId);
        if (!token) setPinBlocked(true);
        setPinChecked(true);
      } catch {
        // 네트워크 오류 → 낙관적 허용
        if (!cancelled) setPinChecked(true);
      }
    })();
    return () => { cancelled = true; };
  }, [aliasId]);

  const loadEmail = async () => {
    setLoading(true); setError(null);
    try {
      const [emailRes, aliasRes] = await Promise.all([
        fetch(apiPath(`/email/uid/${uid}`), { headers: getEmailAccessHeaders(aliasId) }),
        fetch(apiPath(`/sl/aliases/${aliasId}`)),
      ]);
      const emailData = await emailRes.json() as any;
      const aliasData = await aliasRes.json() as any;
      setAliasEmail(aliasData?.email || "");
      if (emailData.error) setError(emailData.error);
      else setRawEmail(emailData);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (!pinChecked || pinBlocked) return;
    loadEmail();
  }, [uid, pinChecked, pinBlocked]);

  const svc = rawEmail ? detectService(rawEmail.from) : null;
  const label = aliasEmail ? emailToLabel(aliasEmail) : `#${aliasId}`;

  if (!pinChecked) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#9CA3AF", fontSize: 14 }}>
        로딩 중...
      </div>
    );
  }

  if (pinBlocked) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg,#F8F6FF 0%,#EDE9FE 100%)", padding: 24 }}>
        <div style={{ background: "#fff", borderRadius: 24, padding: "32px 28px", width: "100%", maxWidth: 360, boxShadow: "0 8px 32px rgba(167,139,250,.18)", textAlign: "center" }}>
          <div style={{ width: 64, height: 64, borderRadius: 20, background: "#EDE9FE", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
            <Mail size={28} color="#A78BFA" />
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "#1E1B4B", margin: "0 0 8px" }}>PIN 인증 필요</h2>
          <p style={{ fontSize: 13, color: "#9CA3AF", margin: "0 0 20px" }}>메일 목록에서 PIN을 먼저 입력해주세요</p>
          <button
            onClick={() => navigate(`/mail/${aliasId}`)}
            style={{ width: "100%", padding: 14, borderRadius: 12, border: "none", background: "#A78BFA", color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer", fontFamily: "inherit" }}
          >
            메일 목록으로
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", minHeight: "100vh", background: "#F8F6FF", paddingBottom: 80 }}>
      <div style={{ background: "#fff", borderBottom: "1px solid #E9E4FF", padding: "14px 16px 12px", position: "sticky", top: 0, zIndex: 50 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => navigate(`/mail/${aliasId}`)} style={{ background: "#F3F0FF", border: "none", borderRadius: 10, padding: 8, cursor: "pointer", display: "flex", alignItems: "center" }}>
            <ArrowLeft size={17} color="#7C3AED" />
          </button>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: 16, fontWeight: 700, color: "#1E1B4B", margin: 0 }}>이메일 원본</h1>
            <p style={{ fontSize: 10, color: "#9CA3AF", margin: "2px 0 0" }}>{label}</p>
          </div>
          <span style={{ background: "#EEF5FF", color: "#2563EB", borderRadius: 8, padding: "4px 10px", fontSize: 11, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Forward size={12} /> 수신
          </span>
        </div>
      </div>

      <div style={{ padding: "14px 14px 0" }}>
        {loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[80, 60, 120].map((h, i) => <div key={i} style={{ background: "#fff", borderRadius: 14, height: h, animation: "pulse 1.5s infinite", opacity: 0.5 }} />)}
          </div>
        )}
        {error && (
          <div style={{ background: "#FFF0F0", borderRadius: 12, padding: 16, color: "#EF4444", fontSize: 14, textAlign: "center", display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
            <AlertCircle size={24} />
            {error}
            <button onClick={() => { if (retryCooldown.ready) retryCooldown.trigger(() => loadEmail()); }} disabled={!retryCooldown.ready} style={{ background: "#A78BFA", border: "none", borderRadius: 10, padding: "10px 20px", color: "#fff", fontWeight: 600, cursor: retryCooldown.ready ? "pointer" : "not-allowed", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6 }}>
              <RefreshCw size={14} /> {retryCooldown.ready ? "다시 시도" : `${retryCooldown.remaining}초`}
            </button>
          </div>
        )}

        {!loading && rawEmail && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ background: "#fff", borderRadius: 18, padding: "16px 18px", boxShadow: "0 2px 12px rgba(167,139,250,.10)", border: `1.5px solid ${svc?.bg || "#EDE9FE"}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <div style={{ width: 48, height: 48, borderRadius: 13, background: svc?.bg || "#F3F0FF", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, overflow: "hidden" }}>
                  {svc
                    ? <img src={svc.logo} alt={svc.label} style={{ width: 32, height: 32, objectFit: "contain" }} onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    : <Mail size={20} color="#A78BFA" />
                  }
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#1E1B4B" }}>{senderLabel(rawEmail.from)}</div>
                  <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{senderEmail(rawEmail.from)}</div>
                </div>
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#1E1B4B", marginBottom: 8, lineHeight: 1.4 }}>{rawEmail.subject || "(제목 없음)"}</div>
              {rawEmail.extractedAuth && rawEmail.extractedAuth.confidence !== 'none' && (
                <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, padding: '9px 10px', marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: '#B45309', marginBottom: 6 }}>자동 추출된 인증 정보</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {rawEmail.extractedAuth.codes.slice(0, 3).map(code => (
                      <div key={code} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 800, color: '#92400E' }}>
                        <span style={{ letterSpacing: 1 }}>{code}</span>
                        <CopyBtn text={code} />
                      </div>
                    ))}
                    {rawEmail.extractedAuth.links.slice(0, 2).map(link => (
                      <div key={link} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#7C3AED', minWidth: 0 }}>
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{link}</span>
                        <CopyBtn text={link} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#9CA3AF", background: "#F8F6FF", borderRadius: 9, padding: "7px 12px" }}>
                <Clock size={12} color="#C4B5FD" /> {formatDateFull(rawEmail.timestamp_sec)}
              </div>
            </div>

            <div style={{ background: "#fff", borderRadius: 16, overflow: "hidden", boxShadow: "0 2px 10px rgba(167,139,250,.08)", border: "1.5px solid #EDE9FE" }}>
              <div style={{ display: "flex", borderBottom: "1px solid #F3F0FF", background: "#F8F6FF" }}>
                {([
                  { id: "html" as const, label: "원본 HTML", Icon: Eye },
                  { id: "text" as const, label: "텍스트", Icon: Code },
                  { id: "meta" as const, label: "메타", Icon: AtSign },
                ] as const).map(tab => (
                  <button key={tab.id} onClick={() => setViewMode(tab.id)} style={{ flex: 1, padding: "10px 0", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 600, color: viewMode === tab.id ? "#7C3AED" : "#9CA3AF", borderBottom: viewMode === tab.id ? "2px solid #A78BFA" : "2px solid transparent", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                    <tab.Icon size={13} /> {tab.label}
                  </button>
                ))}
              </div>
              <div style={{ padding: 14 }}>
                {viewMode === "html" && (rawEmail.html ? <HtmlViewer html={rawEmail.html} /> : <div style={{ textAlign: "center", color: "#9CA3AF", padding: "30px 0", fontSize: 13 }}>HTML 본문 없음 (텍스트 탭 확인)</div>)}
                {viewMode === "text" && (rawEmail.text ? <pre style={{ fontSize: 12, color: "#374151", whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0, lineHeight: 1.6, maxHeight: 400, overflow: "auto" }}>{rawEmail.text}</pre> : <div style={{ textAlign: "center", color: "#9CA3AF", padding: "30px 0", fontSize: 13 }}>텍스트 본문 없음</div>)}
                {viewMode === "meta" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {[
                      { label: "제목", value: rawEmail.subject },
                      { label: "발신자 (원본)", value: rawEmail.originalFrom },
                      { label: "수신 별칭", value: rawEmail.aliasTo },
                      { label: "날짜", value: rawEmail.date },
                    ].map(item => item.value ? (
                      <div key={item.label} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#9CA3AF", minWidth: 80, paddingTop: 2 }}>{item.label}</div>
                        <div style={{ flex: 1, fontSize: 12, color: "#1E1B4B", wordBreak: "break-all" }}>{item.value}</div>
                        <CopyBtn text={item.value} />
                      </div>
                    ) : null)}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}@keyframes pulse{0%,100%{opacity:.4}50%{opacity:.7}}`}</style>
    </div>
  );
}
