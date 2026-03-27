import { useState } from "react";
import { useVault } from "../../store";
import Header from "../components/Header";
import { C, F, S } from "../ui";

export default function RevealMnemonic() {
  const { mnemonic, clearMnemonic, setView } = useVault();
  const [revealed,  setRevealed]  = useState(false);
  const [copied,    setCopied]    = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const words = mnemonic?.trim().split(/\s+/) ?? [];

  async function copy() {
    if (!mnemonic) return;
    await navigator.clipboard.writeText(mnemonic);
    setCopied(true); setTimeout(()=>setCopied(false), 2000);
  }

  return (
    <div className="animate-in" style={S.screen}>
      <Header right={
        <span style={{ ...S.tag, color:C.amber, borderColor:C.amber+"44", background:C.amber+"0D" }}>
          <span style={{ width:4, height:4, borderRadius:"50%", background:C.amber }} />WRITE THIS DOWN
        </span>
      } />
      <div style={S.scrollBody}>
        <div>
          <div style={{ fontSize:14, fontWeight:700, color:"#fff", letterSpacing:"0.08em", fontFamily:F }}>RECOVERY_PHRASE</div>
          <div style={{ fontSize:10, color:C.dim, marginTop:2 }}>// 12-word BIP-39 mnemonic · never share this</div>
        </div>

        <div style={{ background:C.amber+"08", border:`1px solid ${C.amber}33`, borderRadius:8, padding:"8px 12px", fontSize:10, color:C.amber, lineHeight:1.7 }}>
          ⚠ CRITICAL: Anyone with these words controls your funds. Store offline only.
        </div>

        {/* Word grid */}
        <div style={{ position:"relative" }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:5, filter:revealed?"none":"blur(5px)", userSelect:revealed?"auto":"none", transition:"filter 0.3s" }}>
            {words.map((word, i) => (
              <div key={i} style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:6, padding:"7px 10px", display:"flex", alignItems:"center", gap:8 }}>
                <span style={{ fontSize:9, color:C.dim, minWidth:14, textAlign:"right", fontFamily:F }}>{(i+1).toString().padStart(2,"0")}</span>
                <span style={{ fontSize:11, color:C.text, fontWeight:500, fontFamily:F }}>{word}</span>
              </div>
            ))}
          </div>
          {!revealed && (
            <button onClick={()=>setRevealed(true)} style={{ position:"absolute", inset:0, background:"rgba(6,10,15,0.75)", backdropFilter:"blur(2px)", border:`1px solid ${C.borderLit}`, borderRadius:8, cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:8, color:C.blue, fontFamily:F }}>
              <span style={{ fontSize:22 }}>👁</span>
              <span style={{ fontSize:11, fontWeight:700, letterSpacing:"0.1em" }}>REVEAL PHRASE</span>
            </button>
          )}
        </div>

        {revealed && (
          <div style={{ display:"flex", gap:6 }}>
            <button style={{ ...S.btnGhost, flex:1, padding:"8px", fontSize:10 }} onClick={copy}>{copied?"✓ COPIED":"⎘ COPY"}</button>
            <button style={{ ...S.btnGhost, flex:1, padding:"8px", fontSize:10 }} onClick={()=>setRevealed(false)}>◉ HIDE</button>
          </div>
        )}

        <div onClick={()=>setConfirmed(!confirmed)} style={{ display:"flex", alignItems:"flex-start", gap:10, cursor:"pointer", padding:"4px 0" }}>
          <div style={{ width:18, height:18, borderRadius:4, flexShrink:0, marginTop:1, border:`1.5px solid ${confirmed?C.blue:C.borderLit}`, background:confirmed?C.blue+"22":"transparent", display:"flex", alignItems:"center", justifyContent:"center", color:C.blue, fontSize:12, fontWeight:700, transition:"all 0.15s" }}>
            {confirmed?"✓":""}
          </div>
          <div style={{ fontSize:10, color:C.dim, lineHeight:1.7 }}>I have written down my seed phrase and stored it securely offline.</div>
        </div>

        <button style={S.btnPrimary} disabled={!confirmed||!revealed} onClick={()=>{ clearMnemonic(); setView("dashboard"); }}>
          [ SECURE &amp; CONTINUE ]
        </button>
      </div>
    </div>
  );
}
