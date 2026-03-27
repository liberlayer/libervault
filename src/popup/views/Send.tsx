import { useState, useEffect } from "react";
import { useVault, ChainTab } from "../../store";
import { C, F, S, CHAIN_META } from "../ui";

const CHAIN_DECIMALS: Record<string, number> = {
  evm: 18, bitcoin: 8, solana: 9, polkadot: 10, liberland: 12, monero: 12,
};

export default function Send() {
  const { activeTab, accounts, balances, sendTx, estimateFee, loading, error, clearError, setModal, lastTxHash, lastTxExplorer } = useVault();
  const [to,      setTo]      = useState("");
  const [amount,  setAmount]  = useState("");
  const [memo,    setMemo]    = useState("");
  const [fee,     setFee]     = useState("Estimating…");
  const [confirm, setConfirm] = useState(false);
  const [localErr, setLocalErr] = useState("");

  const chain = CHAIN_META.find(c => c.key === activeTab)!;
  const balance = balances?.[activeTab as keyof typeof balances];
  const isMonero = activeTab === "monero";

  useEffect(() => {
    clearError();
    setLocalErr("");
    if (amount && parseFloat(amount) > 0 && to) {
      const t = setTimeout(async () => {
        const f = await estimateFee(activeTab, to, amount);
        setFee(f);
      }, 600);
      return () => clearTimeout(t);
    } else {
      setFee("Enter amount to estimate");
    }
  }, [amount, to, activeTab]);

  async function handleSend() {
    setLocalErr("");
    if (!to)                    return setLocalErr("// ERR: recipient address required");
    if (!amount || parseFloat(amount) <= 0) return setLocalErr("// ERR: enter a valid amount");

    await sendTx(activeTab, to, amount, memo || undefined);
  }

  // Success state
  if (lastTxHash) {
    return (
      <div className="animate-in" style={{ ...S.screen, alignItems:"center", justifyContent:"center", padding:"24px 20px", gap:20 }}>
        <div style={{ fontSize:40 }}>✅</div>
        <div style={{ textAlign:"center" }}>
          <div style={{ fontSize:14, fontWeight:700, color:C.green, fontFamily:F, marginBottom:4 }}>TX_BROADCAST</div>
          <div style={{ fontSize:10, color:C.dim }}>Transaction sent successfully</div>
        </div>
        <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:"10px 14px", width:"100%" }}>
          <div style={{ fontSize:9, color:C.dim, marginBottom:4, fontFamily:F }}>// TX_HASH</div>
          <div style={{ fontSize:10, color:C.text, fontFamily:F, wordBreak:"break-all" as const }}>{lastTxHash}</div>
        </div>
        <a href={lastTxExplorer ?? "#"} target="_blank" rel="noopener noreferrer"
          style={{ fontSize:10, color:C.blue, fontFamily:F, textDecoration:"none" }}>
          VIEW ON EXPLORER →
        </a>
        <button style={S.btnPrimary} onClick={() => setModal(null)}>[ DONE ]</button>
      </div>
    );
  }

  return (
    <div className="animate-in" style={S.screen}>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 16px 8px", borderBottom:`1px solid ${C.border}`, flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <div style={{ width:24,height:24,borderRadius:5,background:chain.color+"18",border:`1px solid ${chain.color}33`,color:chain.color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700,fontFamily:F }}>
            {chain.sym[0]}
          </div>
          <span style={{ fontSize:12, fontWeight:700, color:"#fff", fontFamily:F }}>SEND {chain.sym}</span>
        </div>
        <button onClick={() => setModal(null)} style={{ background:"none",border:"none",cursor:"pointer",color:C.dim,fontSize:16,lineHeight:1 }}>✕</button>
      </div>

      <div style={{ ...S.scrollBody, gap:14 }}>

        {/* Monero sync note */}
        {isMonero && (
          <div style={{ background:C.xmr+"0A", border:`1px solid ${C.xmr}33`, borderRadius:8, padding:"10px 12px", fontSize:10, color:C.xmr, lineHeight:1.7 }}>
            🔒 XMR send uses ring signatures via WASM. First send triggers a wallet sync against a remote node — this may take a moment. Your spend key never leaves this extension.
          </div>
        )}

        {/* Balance */}
        <div style={{ ...S.card, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span style={{ fontSize:9, color:C.dim, fontFamily:F, letterSpacing:"0.1em" }}>// AVAILABLE</span>
          <span style={{ fontSize:12, color:balance?.error ? C.dim : C.text, fontFamily:F, fontWeight:600 }}>
            {balance?.formatted ?? "Loading…"}
          </span>
        </div>

        {/* Recipient */}
        <div>
          <div style={S.label}><span style={{ color:C.blueDim }}>//</span>RECIPIENT</div>
          <input
            value={to} onChange={e => setTo(e.target.value)}
            placeholder={`${chain.label} address`}
            style={{ ...S.input, fontSize:11 }}
          />
        </div>

        {/* Amount */}
        <div>
          <div style={{ ...S.label, justifyContent:"space-between" }}>
            <span style={{ display:"flex", alignItems:"center", gap:5 }}><span style={{ color:C.blueDim }}>//</span>AMOUNT</span>
            <button
              onClick={() => {
                const raw = balance?.formatted?.split(" ")[0] ?? "0";
                setAmount(raw);
              }}
              style={{ background:"none",border:"none",cursor:"pointer",color:C.blue,fontSize:9,fontFamily:F,letterSpacing:"0.08em" }}
            >MAX</button>
          </div>
          <div style={{ position:"relative" }}>
            <input
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0.00"
              style={{ ...S.input, paddingRight:48 }}
              min="0"
              step="any"
            />
            <span style={{ position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",fontSize:10,color:C.dim,fontFamily:F }}>
              {chain.sym}
            </span>
          </div>
        </div>

        {/* Memo (optional for some chains) */}
        {(activeTab === "evm" || activeTab === "solana") && (
          <div>
            <div style={S.label}><span style={{ color:C.blueDim }}>//</span>MEMO (OPTIONAL)</div>
            <input value={memo} onChange={e => setMemo(e.target.value)} placeholder="Optional note" style={S.input} />
          </div>
        )}

        {/* Fee estimate */}
        <div style={{ ...S.card, display:"flex", justifyContent:"space-between" }}>
          <span style={{ fontSize:9, color:C.dim, fontFamily:F }}>// ESTIMATED FEE</span>
          <span style={{ fontSize:10, color:C.text, fontFamily:F }}>{fee}</span>
        </div>

        {/* Errors */}
        {(localErr || error) && (
          <div style={S.errBox}>{localErr || error}</div>
        )}

        {/* Confirm step */}
        {!confirm ? (
          <button
            style={S.btnPrimary}
            onClick={() => {
              if (!to || !amount || parseFloat(amount) <= 0) return setLocalErr("// ERR: fill in all fields");
              setLocalErr("");
              setConfirm(true);
            }}
            disabled={loading}
          >
            [ REVIEW TRANSACTION ]
          </button>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {/* Summary */}
            <div style={{ background:chain.color+"0D", border:`1px solid ${chain.color}33`, borderRadius:8, padding:"10px 14px" }}>
              <div style={{ fontSize:9, color:C.dim, fontFamily:F, marginBottom:8 }}>// CONFIRM TRANSACTION</div>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                <span style={{ fontSize:10, color:C.dim, fontFamily:F }}>TO</span>
                <span style={{ fontSize:10, color:C.text, fontFamily:F, maxWidth:180, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" as const }}>{to}</span>
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                <span style={{ fontSize:10, color:C.dim, fontFamily:F }}>AMOUNT</span>
                <span style={{ fontSize:13, color:"#fff", fontFamily:F, fontWeight:700 }}>{amount} {chain.sym}</span>
              </div>
              <div style={{ display:"flex", justifyContent:"space-between" }}>
                <span style={{ fontSize:10, color:C.dim, fontFamily:F }}>FEE</span>
                <span style={{ fontSize:10, color:C.dim, fontFamily:F }}>{fee}</span>
              </div>
            </div>
            <button style={S.btnPrimary} onClick={handleSend} disabled={loading}>
              {loading
                ? <span style={{ display:"flex",alignItems:"center",justifyContent:"center",gap:8 }}>
                    <span style={{ width:12,height:12,border:"2px solid #000",borderTopColor:"transparent",borderRadius:"50%",display:"inline-block",animation:"spin 0.7s linear infinite" }} />
                    BROADCASTING…
                  </span>
                : `[ SIGN & SEND ${chain.sym} ]`
              }
            </button>
            <button style={S.btnGhost} onClick={() => { setConfirm(false); clearError(); }}>CANCEL</button>
          </div>
        )}
      </div>
    </div>
  );
}
