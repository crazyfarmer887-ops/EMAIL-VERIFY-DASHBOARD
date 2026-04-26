import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { CATEGORIES } from "../lib/constants";
import { apiPath } from "../lib/path";
import { RefreshCw, ChevronRight, User } from "lucide-react";

interface CategorySummary {
  key: string; label: string; count: number;
  lowestPricePerDay: string; lowestPricePerDayNum: number;
  lowestPrice: string; lenderName: string;
}
interface SummaryData { categories: CategorySummary[]; updatedAt: string; }

export default function HomePage() {
  const [data, setData] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [, navigate] = useLocation();

  const fetchData = async () => {
    setLoading(true);
    try { const res = await fetch(apiPath('/prices')); setData(await res.json()); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')} 기준`;
  };

  return (
    <div style={{ padding: '20px 16px 0' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1E1B4B', margin: 0 }}>파티 대시보드</h1>
          {data?.updatedAt && (
            <p style={{ fontSize: 12, color: '#9CA3AF', margin: '4px 0 0' }}>{formatTime(data.updatedAt)} 최신화</p>
          )}
        </div>
        <button onClick={fetchData} style={{
          background: '#EDE9FE', border: 'none', borderRadius: 12,
          padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 13, color: '#7C3AED', fontWeight: 600, fontFamily: 'inherit',
        }}>
          <RefreshCw size={14} strokeWidth={2.5} />
          새로고침
        </button>
      </div>

      {/* Summary Banner */}
      {!loading && data && (
        <div style={{
          background: 'linear-gradient(135deg, #A78BFA 0%, #818CF8 100%)',
          borderRadius: 20, padding: '18px 20px', marginBottom: 20, color: '#fff',
        }}>
          <p style={{ fontSize: 13, opacity: 0.85, margin: '0 0 6px' }}>전체 파티 수</p>
          <p style={{ fontSize: 32, fontWeight: 700, margin: 0 }}>
            {data.categories.reduce((s, c) => s + c.count, 0).toLocaleString()}개
          </p>
          <p style={{ fontSize: 12, opacity: 0.75, margin: '6px 0 0' }}>
            {CATEGORIES.length}개 서비스 · 실시간 추적 중
          </p>
        </div>
      )}

      {/* Category Grid */}
      <h2 style={{ fontSize: 15, fontWeight: 700, color: '#1E1B4B', margin: '0 0 12px' }}>서비스별 최저가</h2>

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {CATEGORIES.map(c => (
            <div key={c.key} style={{ background: '#fff', borderRadius: 16, height: 100, opacity: 0.4, animation: 'pulse 1.5s infinite', boxShadow: '0 2px 12px rgba(167,139,250,0.1)' }} />
          ))}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {CATEGORIES.map(cat => {
            const summary = data?.categories.find(c => c.key === cat.key);
            return (
              <button key={cat.key} onClick={() => navigate(`/price/${cat.key}`)} style={{
                background: '#fff', borderRadius: 16, padding: '14px',
                boxShadow: '0 2px 12px rgba(167,139,250,0.10)',
                border: `1.5px solid ${cat.bg}`, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <img src={cat.logo} alt={cat.label} style={{ width: 28, height: 28, objectFit: 'contain', borderRadius: 6, flexShrink: 0 }} onError={e => { (e.target as HTMLImageElement).style.display='none'; }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: cat.color, background: cat.bg, borderRadius: 6, padding: '2px 6px' }}>
                    {cat.label.length > 5 ? cat.label.slice(0,5)+'..' : cat.label}
                  </span>
                </div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#1E1B4B', lineHeight: 1 }}>
                  {summary?.lowestPricePerDayNum ? `${summary.lowestPricePerDayNum.toLocaleString()}원` : '-'}
                </div>
                <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 3 }}>/일 · {summary?.count || 0}개</div>
              </button>
            );
          })}
        </div>
      )}

      {/* Quick Nav */}
      <div style={{ marginTop: 24, marginBottom: 8 }}>
        <button onClick={() => navigate('/my')} style={{
          width: '100%', background: '#fff', border: '1.5px solid #EDE9FE',
          borderRadius: 16, padding: '16px 20px', display: 'flex', alignItems: 'center',
          gap: 12, cursor: 'pointer', fontFamily: 'inherit',
          boxShadow: '0 2px 8px rgba(167,139,250,0.08)',
        }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: '#EDE9FE', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <User size={20} color="#A78BFA" strokeWidth={2} />
          </div>
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#1E1B4B' }}>내 계정 파티원 조회</div>
            <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 2 }}>쿠키 기반 계정 연결</div>
          </div>
          <ChevronRight size={18} color="#A78BFA" style={{ marginLeft: 'auto' }} />
        </button>
      </div>

      <style>{`@keyframes pulse { 0%,100%{opacity:.4} 50%{opacity:.7} }`}</style>
    </div>
  );
}
