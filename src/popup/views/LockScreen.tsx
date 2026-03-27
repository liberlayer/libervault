import { useState } from "react";
import { useVault } from "../../store";
import { ShieldLogo } from "../App";
import { C, F, S } from "../ui";

export default function LockScreen() {
  const { unlock, loading, error, clearError } = useVault();
  const [pw, setPw]   = useState("");
  const [show, setShow] = useState(false);

  async function submit() { clearError(); if (!pw) return; await unlock(pw); }

  return (
    <div className="animate-in" style={{ ...S.screen, alignItems:"center", justifyContent:"center", padding:"28px 24px", gap:24 }}>
      <ShieldLogo size={68} />

      <div style={{ textAlign:"center" }}>
        <div style={{ fontSize:20, fontWeight:700, color:"#fff", letterSpacing:"0.1em", fontFamily:F }}>
          LIBER<span style={{ color:C.blue }}>VAULT</span>
        </div>
        <div style={{ fontSize:9, color:C.dim, letterSpacing:"0.16em", marginTop:4 }}>◉ VAULT LOCKED</div>
      </div>

      <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:8 }}>
        <div style={S.label}><span style={{ color:C.blueDim }}>//</span>PASSWORD</div>
        <div style={{ position:"relative" }}>
          <input type={show?"text":"password"} style={S.input} placeholder="enter password to unlock" value={pw} onChange={e=>{setPw(e.target.value);clearError();}} onKeyDown={e=>e.key==="Enter"&&submit()} autoFocus />
          <button onClick={()=>setShow(!show)} style={{ position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:C.dim,fontSize:9,fontFamily:F }}>{show?"HIDE":"SHOW"}</button>
        </div>

        {error && <div style={S.errBox}>// ERR: {error}</div>}

        <button style={S.btnPrimary} onClick={submit} disabled={loading||!pw}>
          {loading
            ? <span style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
                <span style={{ width:12,height:12,border:"2px solid #000",borderTopColor:"transparent",borderRadius:"50%",display:"inline-block",animation:"spin 0.7s linear infinite" }} />
                UNLOCKING...
              </span>
            : "[ UNLOCK VAULT ]"
          }
        </button>
      </div>
    </div>
  );
}
