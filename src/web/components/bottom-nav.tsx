import { useLocation } from "wouter";
import { Home, BarChart2, PenLine, LayoutGrid, Mail, User } from "lucide-react";

const tabs = [
  { path: "/",       label: "홈",    Icon: Home },
  { path: "/price",  label: "가격",  Icon: BarChart2 },
  { path: "/write",  label: "작성",  Icon: PenLine },
  { path: "/manage", label: "관리",  Icon: LayoutGrid },
  { path: "/mail",   label: "메일",  Icon: Mail },
  { path: "/my",     label: "내계정", Icon: User },
];

export default function BottomNav() {
  const [location, navigate] = useLocation();
  return (
    <nav style={{
      position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
      width: '100%', maxWidth: 480, background: '#FFFFFF',
      borderTop: '1px solid #E9E4FF', display: 'flex', zIndex: 100,
      paddingBottom: 'env(safe-area-inset-bottom)',
    }}>
      {tabs.map(({ path, label, Icon }) => {
        const active = location === path || (path !== "/" && location.startsWith(path));
        const isWrite = path === '/write';
        return (
          <button key={path} onClick={() => navigate(path)} style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: 3, padding: '9px 0', background: 'none', border: 'none', cursor: 'pointer',
            color: active ? '#A78BFA' : '#9CA3AF', fontSize: 9,
            fontWeight: active ? 700 : 400, fontFamily: 'inherit',
          }}>
            {isWrite ? (
              <div style={{
                width: 38, height: 38, borderRadius: 12,
                background: 'linear-gradient(135deg, #A78BFA, #818CF8)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 4px 12px rgba(167,139,250,0.4)',
                marginTop: -14, marginBottom: 2,
              }}>
                <Icon size={17} color="#fff" strokeWidth={2.5} />
              </div>
            ) : (
              <Icon size={19} color={active ? '#A78BFA' : '#9CA3AF'} strokeWidth={active ? 2.5 : 2} />
            )}
            {label}
          </button>
        );
      })}
    </nav>
  );
}
