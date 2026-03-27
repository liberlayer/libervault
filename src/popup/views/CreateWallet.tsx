import { useState } from "react";
import { useVault } from "../../store";
import Header from "../components/Header";
import { C, F, S } from "../ui";

export default function CreateWallet() {
  const { setView, createWallet, loading, error, clearError } = useVault();
  const [pw, setPw]  = useState("");
  const [cf, setCf]  = useState("");
  const [show, setShow] = useState(false);
  const [local, setLocal] = useState("");

  const str = !pw ? 0 : pw.length < 8 ? 1 : pw.length < 12 ? 2 : /[A-Z]/.test(pw)&&/\d/.test(pw) ? 4 : 3;
  const strLabel = ["","WEAK","FAIR","GOOD","STRONG"][str];
  const strColor = ["",C.red,C.amber,C.blue,C.green][str];

  async function submit() {
    clearError(); setLocal("");
    if (pw.length < 8) return setLocal("// ERR: min 8 characters");
    if (pw !== cf)     return setLocal("// ERR: passwords do not match");
    await createWallet(pw);
  }

  const err = local || error;

  return (
    <div className="animate-in" style={S.screen}>
      <Header right={
        <button onClick={() => setView("welcome")} style={{ background:"none", border:"none", cursor:"pointer", color:C.dim, fontSize:10, fontFamily:F, letterSpacing:"0.1em" }}>← BACK</button>
      } />
      <div style={S.scrollBody}>
        <div>
          <div style={{ fontSize:14, fontWeight:700, color:"#fff", letterSpacing:"0.08em", fontFamily:F }}>INIT_WALLET</div>
          <div style={{ fontSize:10, color:C.dim, marginTop:2 }}>// Set encryption password for local vault</div>
        </div>

        <div>
          <div style={S.label}><span style={{ color:C.blueDim }}>//</span>PASSWORD</div>
          <div style={{ position:"relative" }}>
            <input type={show?"text":"password"} style={S.input} placeholder="min. 8 characters" value={pw} onChange={e=>{setPw(e.target.value);setLocal("");}} />
            <button onClick={()=>setShow(!show)} style={{ position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:C.dim,fontSize:9,fontFamily:F }}>{show?"HIDE":"SHOW"}</button>
          </div>
          {pw && (
            <div style={{ marginTop:6 }}>
              <div style={{ display:"flex", gap:4, marginBottom:4 }}>
                {[1,2,3,4].map(i=><div key={i} style={{ height:2, flex:1, borderRadius:2, background:str>=i?strColor:C.border, transition:"background 0.3s" }} />)}
              </div>
              <span style={{ fontSize:9, color:strColor, letterSpacing:"0.12em" }}>{strLabel}</span>
            </div>
          )}
        </div>

        <div>
          <div style={S.label}><span style={{ color:C.blueDim }}>//</span>CONFIRM</div>
          <input type={show?"text":"password"} style={S.input} placeholder="repeat password" value={cf} onChange={e=>{setCf(e.target.value);setLocal("");}} onKeyDown={e=>e.key==="Enter"&&submit()} />
        </div>

        {err && <div style={S.errBox}>{err}</div>}

        <div style={{ ...S.card, display:"flex", gap:10, alignItems:"flex-start" }}>
          <span style={{ color:C.green, fontSize:13 }}>⚡</span>
          <div style={{ fontSize:10, color:C.dim, lineHeight:1.7 }}>Your password encrypts your seed phrase with AES-256-GCM locally. LiberVault never transmits or sees your keys.</div>
        </div>

        <button style={S.btnPrimary} onClick={submit} disabled={loading}>{loading?"GENERATING WALLET…":"[ GENERATE SEED PHRASE ]"}</button>
      </div>
    </div>
  );
}
