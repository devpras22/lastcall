import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { ProblemDialog, toProblem, type Problem } from "../ui/Problem";
import { Check } from "../ui/icons";
import { WalletPicker } from "./Staff";

const ROLES = ["server", "bartender", "busser", "host", "runner", "barback", "kitchen"];

/** What a worker sees when they open the staff link on their phone. */
export default function Join({ token }: { token: string }) {
  const page = useQuery(api.join.page, { token });
  const add = useMutation(api.join.add);
  const [name, setName] = useState("");
  const [role, setRole] = useState("server");
  const [wallet, setWallet] = useState<"PAYPAL" | "VENMO">("PAYPAL");
  const [receiver, setReceiver] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [problem, setProblem] = useState<Problem | null>(null);
  const [done, setDone] = useState(false);

  if (page === undefined) return <div className="tip-page"><div className="tip-card"><span className="skel" style={{ height: 40 }} /></div></div>;
  if (page === null)
    return <div className="tip-page"><div className="tip-card"><h1 style={{ fontSize: "var(--text-2xl)" }}>This staff link doesn’t work anymore</h1><p className="muted">Ask your manager for the new one.</p></div></div>;

  if (done)
    return (
      <div className="tip-page">
        <div className="tip-card">
          <div className="ticket">
            <span className="status status--success"><Check />You’re on the list</span>
            <p style={{ fontFamily: "var(--font-body)" }}>At close, your share of the tips goes straight to your {wallet === "VENMO" ? "Venmo" : "PayPal"}, with a receipt that shows how it was worked out.</p>
          </div>
        </div>
      </div>
    );

  return (
    <div className="tip-page">
      <form className="tip-card" noValidate onSubmit={async (e) => {
        e.preventDefault(); setErr(""); setBusy(true);
        try { await add({ token, name, role, wallet, receiver }); setDone(true); }
        catch (x) { const p = toProblem(x); if (p.kind === "input") setErr(p.message); else setProblem(p); }
        finally { setBusy(false); }
      }}>
        <div>
          <p className="muted">Get your tips from</p>
          <h1>{page.name}</h1>
          <p className="muted" style={{ marginTop: "var(--space-xs)" }}>Add where you want to be paid. Your manager won’t need to ask.</p>
        </div>
        <div className="field"><label htmlFor="j-name">Your name, as it’s written on the schedule</label>
          <input id="j-name" className="input" name="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></div>
        <div className="field"><label htmlFor="j-role">Your role</label>
          <select id="j-role" className="input" name="role" value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select></div>
        <WalletPicker value={wallet} onChange={setWallet} />
        <div className="field"><label htmlFor="j-pay">{wallet === "VENMO" ? "Phone number on your Venmo" : "Email or phone on your PayPal"}</label>
          <input id="j-pay" className="input" name="receiver" type={wallet === "VENMO" ? "tel" : "text"} inputMode={wallet === "VENMO" ? "tel" : "email"} autoComplete={wallet === "VENMO" ? "tel" : "email"} value={receiver} onChange={(e) => setReceiver(e.target.value)} /></div>
        <p className="help help--error" role="alert">{err}</p>
        <button type="submit" className="btn btn--go btn--big btn--block" disabled={busy} aria-busy={busy}>{busy ? "Saving…" : "Add me"}</button>
        {page.demo && <p className="small muted">Demo restaurant: this runs on PayPal’s test mode, so no real money moves.</p>}
      </form>
      <ProblemDialog problem={problem} onClose={() => setProblem(null)} />
    </div>
  );
}
