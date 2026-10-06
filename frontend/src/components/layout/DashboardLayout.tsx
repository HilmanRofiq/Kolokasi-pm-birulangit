import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import analyzeActive from "../../assets/analyzing (1).svg";
import analyzeDefault from "../../assets/analyzing.svg";
import logo from "../../assets/BIRULANGIT LOGO 480x320.png";
import testActive from "../../assets/exam (1).svg";
import testDefault from "../../assets/exam.svg";
import homeDefault from "../../assets/home (1).svg";
import homeActive from "../../assets/home.svg";

function placeholderIcon(letter: string) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="36"
    height="36" viewBox="0 0 36 36">
    <rect x="2" y="2" width="32" height="32" rx="9" fill="#d1eaf1"/>
    <text x="18" y="24" text-anchor="middle" font-family="Arial"
      font-size="19" fill="#24458c">${letter}</text>
  </svg>`;

    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const navigation = [
    { label: "Home", icon: homeDefault, activeIcon: homeActive, path: "/", enabled: true },
    { label: "Analyze", icon: analyzeDefault, activeIcon: analyzeActive, path: "/analyze", enabled: true },
    { label: "Lab Test", icon: testDefault, activeIcon: testActive, path: "/labtest", enabled: true },
];

export default function DashboardLayout({ children }: { children: ReactNode }) {
    const navigate = useNavigate();
    const { pathname } = useLocation();
    return (
        <div className="app-shell">
            <aside className="sidebar">
                <div className="brand" title="Collocation">
                    <img src={logo} alt="Collocation" className="brand-logo" />
                </div>

                <nav aria-label="Main navigation">
                    {navigation.map(item => {
                        const path = item.path;
                        const enabled = item.enabled ?? true;
                        const active = enabled && pathname === path;

                        return (
                            <button
                                key={item.label}
                                className={`nav-button ${active ? "active" : ""}`}
                                title={enabled ? item.label : `${item.label} — coming next`}
                                aria-label={item.label}
                                aria-current={active ? "page" : undefined}
                                disabled={!enabled}
                                onClick={() => navigate(path)}
                            >
                                <img src={active ? item.activeIcon : item.icon} alt="" />
                            </button>
                        );
                    })}
                </nav>

                <button
                    className="nav-button settings-button"
                    title="Settings — coming next"
                    aria-label="Settings"
                    disabled
                >
                    <img src={placeholderIcon("S")} alt="" />
                </button>
            </aside>

            <main className="main-content">{children}</main>
        </div>
    );
}
