import { ShieldLogo } from "../App";
import { C, F } from "../ui";

interface Props { right?: React.ReactNode; }

export default function Header({ right }: Props) {
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 16px 7px", borderBottom:`1px solid ${C.border}`, flexShrink:0 }}>
      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
        <ShieldLogo size={20} />
        <span style={{ fontSize:11, fontWeight:700, letterSpacing:"0.12em", color:C.blue, fontFamily:F }}>LIBERVAULT</span>
      </div>
      {right}
    </div>
  );
}
