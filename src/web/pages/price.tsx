import { useEffect, useState } from "react";
import { useLocation, useParams } from "wouter";
import { CATEGORIES, RANK_COLORS } from "../lib/constants";

interface Product {
  rank: number;
  usid: string;
  name: string;
  lenderName: string;
  pricePerDay: string;
  pricePerDayNum: number;
  price: string;
  purePrice: number;
  endDate: string;
  remainderDays: number;
  seats: number;
  category: string;
}

interface PriceData {
  category: string;
  count: number;
  products: Product[];
  updatedAt: string;
}

export default function PricePage() {
  const params = useParams<{ category?: string }>();
  const [, navigate] = useLocation();
  const [activeKey, setActiveKey] = useState(params.category || 'netflix');
  const [data, setData] = useState<PriceData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchPrices = async (key: string) => {
    setLoading(true);
    setData(null);
    try {
      const res = await fetch(`/api/prices/${key}`);
      const json = await res.json();
      setData(json);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPrices(activeKey);
  }, [activeKey]);

  const activeCat = CATEGORIES.find(c => c.key === activeKey)!;

  const handleCategoryChange = (key: string) => {
    setActiveKey(key);
    navigate(`/price/${key}`, { replace: true });
  };

  return (
    <div style={{ paddingTop: 20 }}>
      {/* Header */}
      <div style={{ padding: '0 16px 16px' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1E1B4B', margin: 0 }}>
          📊 가격 추적
        </h1>
        <p style={{ fontSize: 12, color: '#9CA3AF', margin: '4px 0 0' }}>
          일당 최저가 TOP 10 · 실시간
        </p>
      </div>

      {/* Category Tabs - Horizontal Scroll */}
      <div className="no-scrollbar" style={{
        display: 'flex', gap: 8, padding: '0 16px 16px',
        overflowX: 'auto',
      }}>
        {CATEGORIES.map(cat => (
          <button
            key={cat.key}
            onClick={() => handleCategoryChange(cat.key)}
            style={{
              flexShrink: 0,
              padding: '7px 14px',
              borderRadius: 20,
              border: 'none',
              fontFamily: 'inherit',
              fontSize: 13,
              fontWeight: activeKey === cat.key ? 700 : 500,
              cursor: 'pointer',
              background: activeKey === cat.key ? '#A78BFA' : '#fff',
              color: activeKey === cat.key ? '#fff' : '#6B7280',
              boxShadow: activeKey === cat.key
                ? '0 4px 12px rgba(167,139,250,0.3)'
                : '0 1px 4px rgba(0,0,0,0.06)',
              transition: 'all 0.15s',
            }}
          >
            {cat.emoji} {cat.label}
          </button>
        ))}
      </div>

      {/* Active Category Info */}
      {!loading && data && (
        <div style={{ padding: '0 16px 12px' }}>
          <div style={{
            background: activeCat.bg,
            borderRadius: 14, padding: '12px 16px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div>
              <img src={activeCat.logo} alt={activeCat.label} style={{ width: 30, height: 30, objectFit: "contain", borderRadius: 6 }} onError={(e)=>{(e.target as HTMLImageElement).style.display="none"}} />
              <span style={{ fontSize: 14, fontWeight: 700, color: activeCat.color, marginLeft: 8 }}>
                {data.category}
              </span>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 12, color: '#9CA3AF' }}>판매 중</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: activeCat.color }}>{data.count}개</div>
            </div>
          </div>
        </div>
      )}

      {/* Price List */}
      <div style={{ padding: '0 16px' }}>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[...Array(5)].map((_, i) => (
              <div key={i} style={{
                height: 80, background: '#fff', borderRadius: 16,
                opacity: 0.5, animation: 'pulse 1.5s infinite',
              }} />
            ))}
          </div>
        ) : data?.products && data.products.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {data.products.map((p) => (
              <div
                key={p.usid}
                style={{
                  background: '#fff',
                  borderRadius: 16,
                  padding: '14px 16px',
                  boxShadow: '0 2px 12px rgba(167,139,250,0.08)',
                  border: '1px solid #F3F0FF',
                  display: 'flex',
                  gap: 12,
                  alignItems: 'center',
                }}
              >
                {/* Rank Badge */}
                <div style={{
                  width: 32, height: 32, borderRadius: 10, flexShrink: 0,
                  background: p.rank <= 5 ? RANK_COLORS[p.rank - 1] : '#E9E4FF',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 700, fontSize: 14, color: p.rank <= 3 ? '#fff' : '#6B7280',
                }}>
                  {p.rank}
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 13, fontWeight: 600, color: '#1E1B4B',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {p.name || p.category}
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
                    <span style={{ fontSize: 11, color: '#9CA3AF' }}>
                      👤 {p.lenderName}
                    </span>
                    <span style={{ fontSize: 11, color: '#9CA3AF' }}>
                      · {p.remainderDays}일 남음
                    </span>
                  </div>
                </div>

                {/* Price */}
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#A78BFA' }}>
                    {p.pricePerDayNum.toLocaleString()}원
                  </div>
                  <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2 }}>
                    /일 · 총 {p.purePrice.toLocaleString()}원
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{
            background: '#fff', borderRadius: 16, padding: '40px 20px',
            textAlign: 'center', color: '#9CA3AF',
          }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>😔</div>
            <div>현재 판매 중인 파티가 없어요</div>
          </div>
        )}
      </div>

      <div style={{ height: 20 }} />

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.7; }
        }
      `}</style>
    </div>
  );
}
