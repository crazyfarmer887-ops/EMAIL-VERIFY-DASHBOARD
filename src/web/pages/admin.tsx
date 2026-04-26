import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { AlertCircle, Lock, LogOut, Mail, RefreshCw, Search, Shield, Save, Trash2 } from "lucide-react";
import { apiPath } from "../lib/path";
import { deleteAliasPin, getAdminSession, getSellerStatus, loginAdmin, logoutAdmin, saveAliasPin } from "../lib/pin-api";

interface Alias {
  id: number;
  email: string;
  enabled: boolean;
  nb_forward: number;
  hasPin?: boolean;
}

interface SellerStatus {
  ok: boolean;
  generatedAt: string;
  gmail: { ok: boolean; lastSync: string | null; historyId: string | null; lastError: string | null };
  pins: { protectedAliases: number };
  email: { lastReceivedAt: string | null };
  warnings: string[];
}

function formatStatusTime(value: string | null) {
  if (!value) return "없음";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "알 수 없음";
  return date.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function AdminPage() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const highlightId = Number(new URLSearchParams(search).get("aliasId") || "0");

  const [configured, setConfigured] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);

  const [aliases, setAliases] = useState<Alias[]>([]);
  const [loadingAliases, setLoadingAliases] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [pinDrafts, setPinDrafts] = useState<Record<number, string>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [sellerStatus, setSellerStatus] = useState<SellerStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const loadStatus = async () => {
    try {
      setStatusError(null);
      setSellerStatus(await getSellerStatus());
    } catch (e: unknown) {
      setStatusError(e instanceof Error ? e.message : "상태를 불러오지 못했어요");
    }
  };

  const loadAliases = async () => {
    setLoadingAliases(true);
    setError(null);
    try {
      const res = await fetch(apiPath("/sl/aliases?page=0"));
      const data = await res.json() as any;
      if (data?.error) throw new Error(data.error);
      const list = (data.aliases || []).sort((a: Alias, b: Alias) => Number(!!b.hasPin) - Number(!!a.hasPin) || b.nb_forward - a.nb_forward);
      setAliases(list);
      setPinDrafts(prev => {
        const next = { ...prev };
        for (const alias of list) {
          if (next[alias.id] === undefined) next[alias.id] = "";
        }
        return next;
      });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoadingAliases(false);
    }
  };

  useEffect(() => {
    (async () => {
      setLoadingSession(true);
      try {
        const session = await getAdminSession();
        setConfigured(session.configured !== false);
        setAuthenticated(!!session.authenticated);
        if (session.authenticated) {
          await Promise.all([loadAliases(), loadStatus()]);
        }
      } catch {
        setConfigured(false);
      } finally {
        setLoadingSession(false);
      }
    })();
  }, []);

  const filteredAliases = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return aliases;
    return aliases.filter(a => a.email.toLowerCase().includes(q) || String(a.id).includes(q));
  }, [aliases, searchText]);

  const handleLogin = async () => {
    setLoginError(null);
    const { res, data } = await loginAdmin(password);
    if (!res.ok) {
      setLoginError(data?.error || "로그인에 실패했어요");
      return;
    }
    setAuthenticated(true);
    setPassword("");
    await Promise.all([loadAliases(), loadStatus()]);
  };

  const handleLogout = async () => {
    await logoutAdmin();
    setAuthenticated(false);
    setAliases([]);
  };

  const handleSave = async (aliasId: number) => {
    const pin = (pinDrafts[aliasId] || "").trim();
    if (!/^\d{4,12}$/.test(pin)) {
      setError("PIN은 숫자 4~12자리로 입력해주세요");
      return;
    }
    setSavingId(aliasId);
    setError(null);
    try {
      const { res, data } = await saveAliasPin(aliasId, pin);
      if (!res.ok) throw new Error(data?.error || "PIN 저장 실패");
      setAliases(prev => prev.map(a => a.id === aliasId ? { ...a, hasPin: true } : a));
      setPinDrafts(prev => ({ ...prev, [aliasId]: "" }));
      void loadStatus();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSavingId(null);
    }
  };

  const handleRemove = async (aliasId: number) => {
    setSavingId(aliasId);
    setError(null);
    try {
      const { res, data } = await deleteAliasPin(aliasId);
      if (!res.ok) throw new Error(data?.error || "PIN 삭제 실패");
      setAliases(prev => prev.map(a => a.id === aliasId ? { ...a, hasPin: false } : a));
      void loadStatus();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSavingId(null);
    }
  };

  if (loadingSession) {
    return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#9CA3AF", fontSize: 14 }}>로딩 중...</div>;
  }

  if (!configured) {
    return (
      <div style={{ maxWidth: 520, margin: "0 auto", minHeight: "100vh", padding: 16, background: "#F8F6FF" }}>
        <div style={{ background: "#fff", borderRadius: 16, padding: 18, boxShadow: "0 2px 12px rgba(167,139,250,0.08)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <Shield size={22} color="#A78BFA" />
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#1E1B4B" }}>관리자 설정 필요</div>
              <div style={{ fontSize: 12, color: "#9CA3AF" }}>ADMIN_PASSWORD 환경변수를 먼저 설정해주세요</div>
            </div>
          </div>
          <button onClick={() => navigate("/")} style={{ border: "none", background: "#A78BFA", color: "#fff", borderRadius: 10, padding: "10px 14px", fontWeight: 700, cursor: "pointer" }}>메일함으로</button>
        </div>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div style={{ maxWidth: 520, margin: "0 auto", minHeight: "100vh", padding: 16, background: "#F8F6FF", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: "100%", background: "#fff", borderRadius: 20, padding: 22, boxShadow: "0 2px 12px rgba(167,139,250,0.08)" }}>
          <div style={{ textAlign: "center", marginBottom: 20 }}>
            <div style={{ width: 64, height: 64, borderRadius: 20, background: "#EDE9FE", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
              <Lock size={28} color="#A78BFA" />
            </div>
            <h1 style={{ fontSize: 20, margin: 0, color: "#1E1B4B" }}>관리자 로그인</h1>
            <p style={{ fontSize: 12, color: "#9CA3AF", margin: "6px 0 0" }}>핀번호를 관리하려면 비밀번호가 필요해요</p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleLogin(); }}
              placeholder="관리자 비밀번호"
              style={{ width: "100%", boxSizing: "border-box", borderRadius: 12, border: "1px solid #EDE9FE", padding: "12px 14px", fontSize: 14, fontFamily: "inherit", outline: "none" }}
            />
            {loginError && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#EF4444", fontSize: 12 }}>
                <AlertCircle size={14} /> {loginError}
              </div>
            )}
            <button
              onClick={handleLogin}
              disabled={!password.trim()}
              style={{
                border: "none",
                borderRadius: 12,
                padding: "12px 14px",
                background: password.trim() ? "#A78BFA" : "#E9E4FF",
                color: password.trim() ? "#fff" : "#C4B5FD",
                fontWeight: 700,
                cursor: password.trim() ? "pointer" : "not-allowed",
                fontFamily: "inherit",
              }}
            >
              로그인
            </button>
            <button onClick={() => navigate("/")} style={{ border: "none", background: "#F3F0FF", color: "#7C3AED", borderRadius: 12, padding: "10px 14px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>메일함으로</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", minHeight: "100vh", padding: 16, background: "#F8F6FF" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 14 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#1E1B4B", margin: 0 }}>관리자 PIN 관리</h1>
          <p style={{ fontSize: 12, color: "#9CA3AF", margin: "4px 0 0" }}>외부 사용자는 이메일 상세 화면에서 기존처럼 PIN을 입력해 접근해요</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={loadAliases} disabled={loadingAliases} style={{ border: "none", background: "#EDE9FE", color: "#7C3AED", borderRadius: 10, padding: "9px 12px", fontWeight: 600, cursor: loadingAliases ? "not-allowed" : "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6 }}>
            <RefreshCw size={14} style={loadingAliases ? { animation: "spin 1s linear infinite" } : {}} /> 새로고침
          </button>
          <button onClick={handleLogout} style={{ border: "none", background: "#fff", color: "#EF4444", borderRadius: 10, padding: "9px 12px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6 }}>
            <LogOut size={14} /> 로그아웃
          </button>
        </div>
      </div>

      <div style={{ background: "#fff", borderRadius: 18, padding: 14, marginBottom: 12, boxShadow: "0 2px 12px rgba(167,139,250,0.08)", border: sellerStatus?.warnings?.length ? "1px solid #FDE68A" : "1px solid #EDE9FE" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#1E1B4B" }}>통합 상태판</div>
          <button onClick={loadStatus} style={{ border: "none", background: "#F3F0FF", color: "#7C3AED", borderRadius: 9, padding: "7px 10px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: 12 }}>상태 새로고침</button>
        </div>
        {statusError ? (
          <div style={{ color: "#EF4444", fontSize: 12 }}>{statusError}</div>
        ) : sellerStatus ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
              <div style={{ background: sellerStatus.gmail.ok ? "#ECFDF5" : "#FFF7ED", borderRadius: 12, padding: 10 }}>
                <div style={{ color: "#9CA3AF", fontSize: 11, fontWeight: 700 }}>Gmail sync</div>
                <div style={{ color: sellerStatus.gmail.ok ? "#059669" : "#EA580C", fontSize: 13, fontWeight: 800 }}>{sellerStatus.gmail.ok ? "정상" : "확인 필요"}</div>
                <div style={{ color: "#9CA3AF", fontSize: 10 }}>{formatStatusTime(sellerStatus.gmail.lastSync)}</div>
              </div>
              <div style={{ background: "#F8F6FF", borderRadius: 12, padding: 10 }}>
                <div style={{ color: "#9CA3AF", fontSize: 11, fontWeight: 700 }}>마지막 메일</div>
                <div style={{ color: "#1E1B4B", fontSize: 13, fontWeight: 800 }}>{formatStatusTime(sellerStatus.email.lastReceivedAt)}</div>
              </div>
              <div style={{ background: "#F8F6FF", borderRadius: 12, padding: 10 }}>
                <div style={{ color: "#9CA3AF", fontSize: 11, fontWeight: 700 }}>PIN 보호 alias</div>
                <div style={{ color: "#1E1B4B", fontSize: 13, fontWeight: 800 }}>{sellerStatus.pins.protectedAliases}개</div>
              </div>
              <div style={{ background: sellerStatus.warnings.length ? "#FEF3C7" : "#ECFDF5", borderRadius: 12, padding: 10 }}>
                <div style={{ color: "#9CA3AF", fontSize: 11, fontWeight: 700 }}>경고</div>
                <div style={{ color: sellerStatus.warnings.length ? "#B45309" : "#059669", fontSize: 13, fontWeight: 800 }}>{sellerStatus.warnings.length}건</div>
              </div>
            </div>
            {sellerStatus.warnings.length > 0 && (
              <div style={{ marginTop: 8, color: "#B45309", fontSize: 11, lineHeight: 1.5 }}>
                {sellerStatus.warnings.slice(0, 3).join(" · ")}
              </div>
            )}
          </>
        ) : (
          <div style={{ color: "#9CA3AF", fontSize: 12 }}>상태를 불러오는 중...</div>
        )}
      </div>

      <div style={{ background: "#fff", borderRadius: 18, padding: 14, marginBottom: 12, boxShadow: "0 2px 12px rgba(167,139,250,0.08)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Search size={14} color="#9CA3AF" />
          <input
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            placeholder="이메일 또는 번호 검색"
            style={{ flex: 1, border: "none", outline: "none", fontFamily: "inherit", fontSize: 14 }}
          />
        </div>
      </div>

      {error && (
        <div style={{ background: "#FFF0F0", borderRadius: 14, padding: "10px 12px", marginBottom: 12, color: "#EF4444", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {loadingAliases ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[1,2,3,4].map(i => <div key={i} style={{ background: "#fff", borderRadius: 14, height: 78, opacity: 0.55, animation: "pulse 1.5s infinite" }} />)}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filteredAliases.length === 0 ? (
            <div style={{ background: "#fff", borderRadius: 16, padding: 20, textAlign: "center", color: "#9CA3AF" }}>
              <Mail size={28} color="#E9E4FF" style={{ margin: "0 auto 8px", display: "block" }} />
              표시할 별칭이 없어요
            </div>
          ) : filteredAliases.map(alias => {
            const focused = alias.id === highlightId;
            const currentDraft = pinDrafts[alias.id] || "";
            return (
              <div
                key={alias.id}
                style={{
                  background: focused ? "#F5F3FF" : "#fff",
                  borderRadius: 16,
                  padding: 14,
                  boxShadow: "0 2px 10px rgba(167,139,250,0.08)",
                  border: focused ? "1.5px solid #A78BFA" : "1.5px solid #EDE9FE",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#1E1B4B" }}>{alias.email}</div>
                      {alias.hasPin ? (
                        <span style={{ background: "#EDE9FE", color: "#7C3AED", borderRadius: 6, padding: "2px 6px", fontSize: 10, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 4 }}><Lock size={9} /> PIN</span>
                      ) : (
                        <span style={{ background: "#F3F4F6", color: "#9CA3AF", borderRadius: 6, padding: "2px 6px", fontSize: 10, fontWeight: 700 }}>PIN 없음</span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 2 }}>ID {alias.id} · 수신 {alias.nb_forward}건 · {alias.enabled ? "활성" : "비활성"}</div>
                  </div>
                  <button
                    onClick={() => navigate(`/mail/${alias.id}`)}
                    style={{ border: "none", background: "#F3F0FF", color: "#7C3AED", borderRadius: 10, padding: "8px 10px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
                  >
                    보기
                  </button>
                </div>

                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                  <input
                    value={currentDraft}
                    onChange={e => setPinDrafts(prev => ({ ...prev, [alias.id]: e.target.value.replace(/\D/g, '').slice(0, 12) }))}
                    placeholder={alias.hasPin ? "새 PIN 입력" : "PIN 설정"}
                    style={{ flex: 1, boxSizing: "border-box", borderRadius: 12, border: "1px solid #EDE9FE", padding: "10px 12px", fontSize: 14, fontFamily: "inherit", outline: "none" }}
                  />
                  <button
                    onClick={() => handleSave(alias.id)}
                    disabled={savingId === alias.id || currentDraft.trim().length < 4}
                    style={{ border: "none", borderRadius: 12, padding: "10px 12px", background: currentDraft.trim().length >= 4 ? "#A78BFA" : "#E9E4FF", color: currentDraft.trim().length >= 4 ? "#fff" : "#C4B5FD", fontWeight: 700, cursor: savingId === alias.id || currentDraft.trim().length < 4 ? "not-allowed" : "pointer", fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 6 }}
                  >
                    <Save size={14} /> {savingId === alias.id ? "저장 중" : "저장"}
                  </button>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <div style={{ fontSize: 11, color: "#9CA3AF" }}>
                    공개 사용자는 이 PIN을 입력하면 메일을 볼 수 있어요
                  </div>
                  <button
                    onClick={() => handleRemove(alias.id)}
                    disabled={!alias.hasPin || savingId === alias.id}
                    style={{ border: "none", background: alias.hasPin ? "#FFF0F0" : "#F3F4F6", color: alias.hasPin ? "#EF4444" : "#9CA3AF", borderRadius: 10, padding: "8px 10px", fontWeight: 600, cursor: !alias.hasPin || savingId === alias.id ? "not-allowed" : "pointer", fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 6 }}
                  >
                    <Trash2 size={14} /> 삭제
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes pulse{0%,100%{opacity:.45} 50%{opacity:.75}}`}</style>
    </div>
  );
}
