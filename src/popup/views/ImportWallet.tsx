import { useState } from "react";
import { useVault } from "../../store";
import Header from "../components/Header";
import { C, F, S } from "../ui";

export default function ImportWallet() {
  const { setView, importWallet, loading, error, clearError } = useVault();
  const [mnemonic, setMnemonic] = useState("");
  const [pw, setPw] = useState("");
  const [cf, setCf] = useState("");
  const [show, setShow] = useState(false);
  const [local, setLocal] = useState("");

  const wc = mnemonic.trim().split(/\s+/).filter(Boolean).length;
  const validWc = wc === 12 || wc === 24;

  async function submit() {
    clearError(); setLocal("");
    if (!validWc)      return setLocal("// ERR: need 12 or 24 words");
    if (pw.length < 8) return setLocal("// ERR: min 8 characters");
    if (pw !== cf)     return setLocal("// ERR: passwords do not match");
    await importWallet(mnemonic, pw);
  }

  const err = local || error;

  return (
    <div className="animate-in" style={S.screen}>
      <Header right={
        <button onClick={() => setView("welcome")} style={{ background:"none", border:"none", cursor:"pointer", color:C.dim, fontSize:10, fontFamily:F, letterSpacing:"0.1em" }}>← BACK</button>
      } />
      <div style={S.scrollBody}>
        <div>
          <div style={{ fontSize:14, fontWeight:700, color:"#fff", letterSpacing:"0.08em", fontFamily:F }}>IMPORT_WALLET</div>
          <div style={{ fontSize:10, color:C.dim, marginTop:2 }}>// Enter your 12 or 24-word seed phrase</div>
        </div>

        <div>
          <div style={S.label}>
            <span style={{ color:C.blueDim }}>//</span>SEED_PHRASE
            {mnemonic.trim() && <span style={{ color:validWc?C.green:C.red, fontWeight:400, textTransform:"none", letterSpacing:0 }}>{wc} words</span>}
          </div>
          <textarea style={{ ...S.input, height:96, lineHeight:1.7, resize:"none" }} placeholder="word1 word2 word3 … word12" value={mnemonic} onChange={e=>setMnemonic(e.target.value.toLowerCase())} spellCheck={false} />
        </div>

        <div>
          <div style={S.label}><span style={{ color:C.blueDim }}>//</span>NEW_PASSWORD</div>
          <div style={{ position:"relative" }}>
            <input type={show?"text":"password"} style={S.input} placeholder="min. 8 characters" value={pw} onChange={e=>setPw(e.target.value)} />
            <button onClick={()=>setShow(!show)} style={{ position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:C.dim,fontSize:9,fontFamily:F }}>{show?"HIDE":"SHOW"}</button>
          </div>
        </div>

        <div>
          <div style={S.label}><span style={{ color:C.blueDim }}>//</span>CONFIRM</div>
          <input type={show?"text":"password"} style={S.input} placeholder="repeat password" value={cf} onChange={e=>setCf(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()} />
        </div>

        {err && <div style={S.errBox}>{err}</div>}

        <button style={S.btnPrimary} onClick={submit} disabled={loading||!validWc}>{loading?"IMPORTING…":"[ IMPORT WALLET ]"}</button>
      </div>
    </div>
  );
}
