import { C } from "./ui";
import { useEffect } from "react";
import { useVault } from "../store";
import Welcome        from "./views/Welcome";
import CreateWallet   from "./views/CreateWallet";
import ImportWallet   from "./views/ImportWallet";
import RevealMnemonic from "./views/RevealMnemonic";
import Dashboard      from "./views/Dashboard";
import LockScreen     from "./views/LockScreen";

export function ShieldLogo({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 72" fill="none">
      <defs>
        <filter id="lg" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="2.5" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#00C8FF" stopOpacity="0.18"/>
          <stop offset="100%" stopColor="#00C8FF" stopOpacity="0.04"/>
        </linearGradient>
      </defs>
      {/* Shield outer */}
      <path d="M32 2L6 13V37C6 52 19 64 32 70C45 64 58 52 58 37V13L32 2Z"
        fill="url(#sg)" stroke="#00C8FF" strokeWidth="1.2" strokeOpacity="0.6" filter="url(#lg)" />
      {/* Shield inner line */}
      <path d="M32 9L13 18V37C13 48 22 58 32 63C42 58 51 48 51 37V18L32 9Z"
        fill="none" stroke="#00C8FF" strokeWidth="0.7" strokeOpacity="0.3" />
      {/* LV monogram */}
      <text x="32" y="43" textAnchor="middle" fontFamily="'JetBrains Mono', monospace"
        fontSize="18" fontWeight="700" fill="#00C8FF" filter="url(#lg)" letterSpacing="-1">LV</text>
    </svg>
  );
}

export default function App() {
  const { view, init } = useVault();
  useEffect(() => { init(); }, []);

  return (
    <div style={{ width: 380, minHeight: 580, background: C.bg, display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" }}>
      {/* Hex grid */}
      <div style={{
        position: "absolute", inset: 0, opacity: 0.03, pointerEvents: "none",
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='100'%3E%3Cpath d='M28 66L0 50V18L28 2l28 16v32z' fill='none' stroke='%2300C8FF' stroke-width='0.8'/%3E%3Cpath d='M28 100L0 84V52l28-16 28 16v32z' fill='none' stroke='%2300C8FF' stroke-width='0.8'/%3E%3C/svg%3E")`,
      }} />
      {/* Top glow line */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: "linear-gradient(90deg, transparent, #00C8FF66, transparent)", zIndex: 10 }} />
      {/* Scanlines */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none", zIndex: 20,
        backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.06) 3px, rgba(0,0,0,0.06) 4px)",
      }} />

      <div style={{ position: "relative", zIndex: 5, display: "flex", flexDirection: "column", flex: 1 }}>
        {view === "loading"         && <Loader />}
        {view === "welcome"         && <Welcome />}
        {view === "create"          && <CreateWallet />}
        {view === "import"          && <ImportWallet />}
        {view === "reveal-mnemonic" && <RevealMnemonic />}
        {view === "dashboard"       && <Dashboard />}
        {view === "lock"            && <LockScreen />}
      </div>
    </div>
  );
}

function Loader() {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20 }}>
      <ShieldLogo size={56} />
      <div style={{ width: 24, height: 24, border: "2px solid #0F1E2E", borderTopColor: "#00C8FF", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
    </div>
  );
}
