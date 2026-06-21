import { useState } from "react";
import { useVault, ChainTab } from "../../store";
import Header   from "../components/Header";
import Send     from "./Send";
import Receive  from "./Receive";
import { C, F, S, CHAIN_META } from "../ui";

function truncAddr(addr: string, front = 9, back = 7) {
  if (!addr || addr.length <= front + back + 3) return addr;
  return `${addr.slice(0, front)}…${addr.slice(-back)}`;
}

export default function Dashboard() {
  const {
    accounts, lock, activeTab, setTab, modal, setModal,
    balances, balanceLoading, fetchBalances, lastTxHash, lastTxExplorer,
  } = useVault();
  const [copied, setCopied] = useState<string | null>(null);

  if (!accounts) return null;

  // Show send/receive modals as overlays inside the popup
  if (modal === "send")    return <Send />;
  if (modal === "receive") return <Receive />;

  const addrMap: Record<string, string> = {
    evm: accounts.evm, bitcoin: accounts.bitcoin, solana: accounts.solana,
    polkadot: accounts.polkadot, liberland: accounts.liberland, monero: accounts.monero, cardano: accounts.cardano,
  };

  async function copy(key: string) {
    await navigator.clipboard.writeText(addrMap[key] || "");
    setCopied(key); setTimeout(() => setCopied(null), 2000);
  }

  const active  = CHAIN_META.find(c => c.key === activeTab)!;
  const balance = balances?.[activeTab as keyof typeof balances];

  // Sum up all balances for total (placeholder — real fiat in Phase 3)
  const hasBalances = !!balances && !balanceLoading;

  return (
    <div className="animate-in" style={S.screen}>
      <Header right={
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ ...S.tag, color:C.green, borderColor:C.green+"44", background:C.green+"0D" }}>
            <span style={{ width:4,height:4,borderRadius:"50%",background:C.green }} />ONLINE
          </span>
          <button onClick={lock} style={{ background:"none",border:"none",cursor:"pointer",color:C.dim,fontSize:10,fontFamily:F }}>🔒</button>
        </div>
      } />

      <div style={{ ...S.scrollBody, gap:10 }}>

        {/* Balance card */}
        <div style={{ background:C.surface, border:`1px solid ${C.borderLit}`, borderRadius:12, padding:"14px 16px", position:"relative", overflow:"hidden" }}>
          <div style={{ position:"absolute",top:0,left:0,right:0,height:1,background:`linear-gradient(90deg,transparent,${active.color}88,transparent)`,transition:"background 0.4s" }} />

          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
            <div>
              <div style={{ fontSize:9,color:C.dim,letterSpacing:"0.14em",marginBottom:4,fontFamily:F }}>// {active.label.toUpperCase()}_BALANCE</div>
              {balanceLoading ? (
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <div style={{ width:14,height:14,border:`2px solid ${C.border}`,borderTopColor:active.color,borderRadius:"50%",animation:"spin 0.8s linear infinite" }} />
                  <span style={{ fontSize:11, color:C.dim, fontFamily:F }}>Fetching…</span>
                </div>
              ) : (
                <div style={{ fontSize:22, fontWeight:700, color: balance?.error ? C.dim : "#fff", lineHeight:1, fontFamily:F }}>
                  {balance?.formatted ?? "—"}
                </div>
              )}
            </div>
            <button onClick={fetchBalances} disabled={balanceLoading} style={{ background:"none",border:`1px solid ${C.border}`,borderRadius:6,padding:"4px 8px",cursor:"pointer",color:C.dim,fontSize:9,fontFamily:F }}>
              ⟳ REFRESH
            </button>
          </div>

          {/* Active address chip */}
          <div style={{ display:"flex",alignItems:"center",gap:8,background:C.bg,border:`1px solid ${C.border}`,borderRadius:6,padding:"6px 10px" }}>
            <span style={{ fontSize:9,color:active.color,fontFamily:F }}>{active.sym}</span>
            <span style={{ fontSize:10,color:C.dim,flex:1,fontFamily:F,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" as const }}>
              {truncAddr(addrMap[activeTab] || "")}
            </span>
            <button onClick={() => copy(activeTab)} style={{ background:"none",border:"none",cursor:"pointer",color:C.dim,fontSize:14,padding:"0 2px" }}>
              {copied === activeTab ? <span style={{ color:C.green,fontSize:11 }}>✓</span> : "⎘"}
            </button>
          </div>

          {/* Send / Receive buttons */}
          <div style={{ display:"flex", gap:6, marginTop:10 }}>
            <button
              onClick={() => setModal("send")}
              style={{ flex:1, padding:"8px", background:active.color, color:"#000", border:"none", borderRadius:7, fontFamily:F, fontSize:10, fontWeight:700, letterSpacing:"0.08em", cursor:"pointer" }}>
              ↑ SEND
            </button>
            <button
              onClick={() => setModal("receive")}
              style={{ flex:1, padding:"8px", background:"transparent", color:active.color, border:`1px solid ${active.color}55`, borderRadius:7, fontFamily:F, fontSize:10, fontWeight:700, letterSpacing:"0.08em", cursor:"pointer" }}>
              ↓ RECEIVE
            </button>
          </div>
        </div>

        {/* Last tx success banner */}
        {lastTxHash && (
          <div style={{ background:C.green+"0A", border:`1px solid ${C.green}33`, borderRadius:8, padding:"8px 12px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <div style={{ fontSize:9, color:C.green, fontFamily:F }}>✓ Last tx confirmed</div>
            <a href={lastTxExplorer ?? "#"} target="_blank" rel="noopener noreferrer"
              style={{ fontSize:9, color:C.blue, fontFamily:F, textDecoration:"none" }}>VIEW →</a>
          </div>
        )}

        {/* Chain tabs */}
        <div style={{ display:"flex",background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:3,gap:2 }}>
          {CHAIN_META.map(c => (
            <button key={c.key} onClick={() => setTab(c.key as ChainTab)} style={{
              flex:1, padding:"6px 1px", border:"none", borderRadius:6, cursor:"pointer",
              fontFamily:F, fontSize:8, fontWeight:700, letterSpacing:"0.04em", textTransform:"uppercase" as const,
              background: activeTab === c.key ? c.color+"18" : "transparent",
              color:      activeTab === c.key ? c.color : C.dim,
              transition: "all 0.15s",
            }}>
              {c.sym}
            </button>
          ))}
        </div>

        {/* Per-chain balance list */}
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          <div style={{ fontSize:9, color:C.dim, letterSpacing:"0.14em", fontFamily:F }}>// ALL_BALANCES</div>
          {CHAIN_META.map(chain => {
            const bal = balances?.[chain.key as keyof typeof balances];
            return (
              <div key={chain.key}
                onClick={() => setTab(chain.key as ChainTab)}
                style={{ display:"flex",alignItems:"center",gap:10,background:C.surface,
                  border:`1px solid ${chain.key === activeTab ? chain.color+"44" : C.border}`,
                  borderRadius:8, padding:"9px 12px", transition:"border-color 0.2s", cursor:"pointer" }}>
                <div style={{ width:28,height:28,borderRadius:6,background:chain.color+"18",border:`1px solid ${chain.color}33`,color:chain.color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700,fontFamily:F,flexShrink:0 }}>
                  {chain.sym[0]}
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:9,color:C.dim,marginBottom:2,letterSpacing:"0.06em",fontFamily:F }}>
                    {chain.label.toUpperCase()}{chain.note}
                  </div>
                  <div style={{ fontSize:10,color:C.text,fontFamily:F,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" as const }}>
                    {truncAddr(addrMap[chain.key] || "")}
                  </div>
                </div>
                <div style={{ textAlign:"right" as const, flexShrink:0 }}>
                  {balanceLoading ? (
                    <div style={{ width:10,height:10,border:`1.5px solid ${C.border}`,borderTopColor:chain.color,borderRadius:"50%",animation:"spin 0.8s linear infinite" }} />
                  ) : (
                    <div style={{ fontSize:10,color:bal?.error ? C.dim : C.text,fontFamily:F,fontWeight:600,maxWidth:100,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" as const }}>
                      {bal?.formatted ?? "—"}
                    </div>
                  )}
                </div>
                <button onClick={e => { e.stopPropagation(); copy(chain.key); }}
                  style={{ background:"none",border:"none",cursor:"pointer",color:C.dim,fontSize:13,padding:"2px 4px",flexShrink:0 }}>
                  {copied === chain.key ? <span style={{ color:C.green,fontSize:10 }}>✓</span> : "⎘"}
                </button>
              </div>
            );
          })}
        </div>

        {/* Chain-specific callouts */}
        {activeTab === "monero" && (
          <div style={{ background:C.xmr+"09",border:`1px solid ${C.xmr}28`,borderRadius:8,padding:"9px 12px",display:"flex",gap:8 }}>
            <span style={{ fontSize:14 }}>🔒</span>
            <div style={{ fontSize:9,color:C.xmr,lineHeight:1.75 }}>
              Full send/receive supported via ring-signature WASM. First send syncs outputs against a remote node. Your <strong>spend key never leaves</strong> this extension.
            </div>
          </div>
        )}
        {activeTab === "liberland" && (
          <div style={{ background:C.lib+"09",border:`1px solid ${C.lib}28`,borderRadius:8,padding:"9px 12px",display:"flex",gap:8 }}>
            <span>🛡️</span>
            <div style={{ fontSize:9,color:C.lib,lineHeight:1.75 }}>
              Same address holds <strong>LLD</strong> and <strong>LLM</strong>. Select asset when sending.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
