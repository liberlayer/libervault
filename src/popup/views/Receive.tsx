import { useEffect, useRef, useState } from "react";
import { useVault }     from "../../store";
import { C, F, S, CHAIN_META } from "../ui";
import QRCode from "qrcode";

export default function Receive() {
  const { activeTab, accounts, setModal } = useVault();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);

  const chain   = CHAIN_META.find(c => c.key === activeTab)!;
  const address = accounts?.[activeTab as keyof typeof accounts] ?? "";

  useEffect(() => {
    if (!canvasRef.current || !address) return;
    QRCode.toCanvas(canvasRef.current, address, {
      width:  188,
      margin: 2,
      color: { dark: "#00C8FF", light: "#060A0F" },
      errorCorrectionLevel: "M",
    });
  }, [address]);

  async function copy() {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="animate-in" style={S.screen}>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 16px 8px", borderBottom:`1px solid ${C.border}`, flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <div style={{ width:24,height:24,borderRadius:5,background:chain.color+"18",border:`1px solid ${chain.color}33`,color:chain.color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700,fontFamily:F }}>
            {chain.sym[0]}
          </div>
          <span style={{ fontSize:12, fontWeight:700, color:"#fff", fontFamily:F }}>RECEIVE {chain.sym}</span>
        </div>
        <button onClick={() => setModal(null)} style={{ background:"none",border:"none",cursor:"pointer",color:C.dim,fontSize:16,lineHeight:1 }}>✕</button>
      </div>

      <div style={{ ...S.scrollBody, alignItems:"center", gap:16 }}>

        {/* QR Code */}
        <div style={{ background:C.bg, border:`1px solid ${chain.color}44`, borderRadius:12, padding:8, boxShadow:`0 0 30px ${chain.color}18` }}>
          <canvas ref={canvasRef} style={{ display:"block", borderRadius:8 }} />
        </div>

        {/* Network label */}
        <div style={{ ...S.tag, color:chain.color, borderColor:chain.color+"44", background:chain.color+"0D" }}>
          <span style={{ width:5,height:5,borderRadius:"50%",background:chain.color }} />
          {chain.label.toUpperCase()} MAINNET
          {activeTab === "liberland" ? " · LLD + LLM" : ""}
        </div>

        {/* Address */}
        <div style={{ width:"100%" }}>
          <div style={S.label}><span style={{ color:C.blueDim }}>//</span>YOUR ADDRESS</div>
          <div style={{ background:C.surface, border:`1px solid ${C.borderLit}`, borderRadius:8, padding:"10px 14px" }}>
            <div style={{ fontSize:10, color:C.text, fontFamily:F, wordBreak:"break-all" as const, lineHeight:1.6 }}>
              {address}
            </div>
          </div>
        </div>

        {/* Monero note */}
        {activeTab === "monero" && (
          <div style={{ background:C.xmr+"08", border:`1px solid ${C.xmr}28`, borderRadius:8, padding:"9px 12px", width:"100%" }}>
            <div style={{ fontSize:9, color:C.xmr, lineHeight:1.75 }}>
              🔒 This is your Monero <strong>primary address</strong>. Share it to receive XMR. For view-only wallet import (Feather, Cake Wallet), you also need your <strong>private view key</strong> — exportable in settings.
            </div>
          </div>
        )}

        {/* Copy button */}
        <button style={{ ...S.btnPrimary, maxWidth:260 }} onClick={copy}>
          {copied ? "✓ ADDRESS COPIED" : "⎘ COPY ADDRESS"}
        </button>

        <div style={{ fontSize:9, color:C.dim, textAlign:"center", lineHeight:1.7, fontFamily:F }}>
          Only send <strong style={{ color:C.text }}>{chain.sym}</strong> to this address.<br />
          Sending other assets may result in permanent loss.
        </div>
      </div>
    </div>
  );
}
