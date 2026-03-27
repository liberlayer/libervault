import { useState, useEffect } from "react";
import { useVault } from "../../store";
import { ShieldLogo } from "../App";
import { C, F, S, CHAIN_META } from "../ui";

const BOOT = [
  "INITIALIZING LIBERVAULT v0.1.0...",
  "SECP256K1 ............. OK",
  "ED25519 ............... OK",
  "SR25519 (SUBSTRATE) ... OK",
  "AES-256-GCM ........... OK",
  "PBKDF2 (600K ITER) .... OK",
  "SYSTEM READY",
];

export default function Welcome() {
  const { setView } = useVault();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(x => x+1), 70);
    return () => clearInterval(t);
  }, []);
  const vis = Math.min(Math.floor(tick/4), BOOT.length);

  return (
    <div className="animate-in" style={{ ...S.screen, padding:"16px 18px 20px", justifyContent:"space-between" }}>
      {/* Hero */}
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:10, paddingTop:10 }}>
        <ShieldLogo size={76} />
        <div style={{ textAlign:"center" }}>
          <div style={{ fontSize:22, fontWeight:700, color:"#fff", letterSpacing:"0.1em", fontFamily:F }}>
            LIBER<span style={{ color:C.blue }}>VAULT</span>
          </div>
          <div style={{ fontSize:9, color:C.dim, letterSpacing:"0.16em", marginTop:3 }}>
            SOVEREIGN · NON-CUSTODIAL · MULTI-CHAIN
          </div>
        </div>
      </div>

      {/* Boot log */}
      <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:"10px 14px", fontSize:9, lineHeight:1.9, fontFamily:F }}>
        {BOOT.slice(0, vis).map((line, i) => (
          <div key={i} style={{ color: line.includes("OK") ? C.green : line.includes("READY") ? C.blue : C.dim, display:"flex", gap:6 }}>
            <span style={{ color:C.blueDim }}>&gt;</span>{line}
          </div>
        ))}
        {vis < BOOT.length && <span style={{ display:"inline-block", width:6, height:12, background:C.blue, marginLeft:4, animation:"blink 1s step-end infinite", verticalAlign:"middle" }} />}
      </div>

      {/* Chain tags */}
      <div style={{ display:"flex", gap:5, justifyContent:"center", flexWrap:"wrap" }}>
        {CHAIN_META.map(c => (
          <span key={c.key} style={{ ...S.tag, color:c.color, borderColor:c.color+"44", background:c.color+"0D" }}>
            <span style={{ width:4, height:4, borderRadius:"50%", background:c.color }} />{c.sym}
          </span>
        ))}
        <span style={{ ...S.tag, color:C.dim, borderColor:C.border, background:C.surface }}>+EVM</span>
      </div>

      {/* Liberland callout */}
      <div style={{ background:C.lib+"0A", border:`1px solid ${C.lib}33`, borderRadius:8, padding:"8px 12px", display:"flex", gap:8, alignItems:"center" }}>
        <span style={{ fontSize:14 }}>🛡️</span>
        <div style={{ fontSize:9, color:C.lib, lineHeight:1.7, letterSpacing:"0.04em" }}>
          Native support for <strong>Liberland Blockchain</strong> — LLD &amp; LLM tokens via Substrate/sr25519
        </div>
      </div>

      {/* CTAs */}
      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        <button style={S.btnPrimary} onClick={() => setView("create")}>[ CREATE NEW WALLET ]</button>
        <button style={S.btnGhost}   onClick={() => setView("import")}>[ IMPORT SEED PHRASE ]</button>
      </div>
    </div>
  );
}
