import { useLocation } from "wouter";

const tabs = [
  { path: "/",       label: "홈",    icon: HomeIcon },
  { path: "/price",  label: "가격",  icon: ChartIcon },
  { path: "/write",  label: "작성",  icon: WriteIcon },
  { path: "/manage", label: "관리",  icon: ManageIcon },
  { path: "/my",     label: "내계정", icon: PersonIcon },
];

function HomeIcon({ active }: { active: boolean }) {
  const c = active ? "#A78BFA" : "#9CA3AF";
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
  </svg>;
}
function ChartIcon({ active }: { active: boolean }) {
  const c = active ? "#A78BFA" : "#9CA3AF";
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
  </svg>;
}
function WriteIcon({ active }: { active: boolean }) {
  const c = active ? "#A78BFA" : "#9CA3AF";
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>;
}
function ManageIcon({ active }: { active: boolean }) {
  const c = active ? "#A78BFA" : "#9CA3AF";
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
    <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
  </svg>;
}
function PersonIcon({ active }: { active: boolean }) {
  const c = active ? "#A78BFA" : "#9CA3AF";
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
  </svg>;
}

export default function BottomNav() {
  const [location, navigate] = useLocation();
  return (
    <nav style={{
      position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
      width: '100%', maxWidth: 480, background: '#FFFFFF',
      borderTop: '1px solid #E9E4FF', display: 'flex', zIndex: 100,
      paddingBottom: 'env(safe-area-inset-bottom)',
    }}>
      {tabs.map(tab => {
        const active = location === tab.path || (tab.path !== "/" && location.startsWith(tab.path));
        const Icon = tab.icon;
        return (
          <button key={tab.path} onClick={() => navigate(tab.path)} style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: 3, padding: '9px 0', background: 'none', border: 'none', cursor: 'pointer',
            color: active ? '#A78BFA' : '#9CA3AF', fontSize: 9.5,
            fontWeight: active ? 700 : 400, fontFamily: 'inherit',
            position: 'relative',
          }}>
            {/* 작성 탭은 강조 */}
            {tab.path === '/write' ? (
              <div style={{
                width: 40, height: 40, borderRadius: 14,
                background: active ? '#A78BFA' : 'linear-gradient(135deg, #A78BFA, #818CF8)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 4px 12px rgba(167,139,250,0.4)',
                marginTop: -16, marginBottom: 2,
              }}>
                <Icon active={true} />
              </div>
            ) : (
              <Icon active={active} />
            )}
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
