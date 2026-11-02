import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { errText, hrs, money } from "../lib/owner";
import { StatusText, type PayoutStatus } from "../ui/Ticket";
import { Sheet } from "../ui/Sheet";
import { Spinner } from "../ui/icons";

export default function Receipt({ token }: { token: string }) {
  const r = useQuery(api.disputes.receipt, { token });
  const open = useMutation(api.disputes.open);
  const [sheet, setSheet] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  if (r === undefined)
    return <div className="receipt-page" aria-busy="true"><div className="receipt"><div className="ticket ticket--skel" style={{ minHeight: 360 }} /></div></div>;
  if (r === null)
    return <div className="receipt-page"><div className="receipt"><h1 style={{ fontSize: "var(--text-2xl)" }}>This receipt link doesn’t work</h1><p className="muted" style={{ marginTop: "var(--space-xs)" }}>Ask your manager to resend it.</p></div></div>;

  const { line } = r;
  const first = line.name.split(" ")[0];
  const active = r.disputes.some((d) => d.status === "checking" || d.status === "proposed" || d.status === "approved");

  async function send() {
    setBusy(true); setErr("");
    try { await open({ token, message: msg }); setMsg(""); setSheet(false); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  }

  return (
    <div className="receipt-page">
      <div className="receipt">
        <article className="ticket">
          <div className="ticket__top">
            <span className="receipt__place">{r.restaurant}</span>
            <span className="muted">{r.date}</span>
          </div>
          <hr className="ticket__cut" />
          <p className="muted" style={{ fontFamily: "var(--font-body)" }}>{first}, your tips tonight</p>
          <p className="receipt__amt money">{money(line.amountCents)}</p>
          <StatusText status={line.payoutStatus as PayoutStatus} wallet={r.wallet} />
          {r.receiverHint && <p className="muted">to {r.receiverHint}</p>}
          {r.simulated && <span className="badge">Demo payout: PayPal sandbox not connected</span>}
          <hr className="ticket__cut" />
          <div className="ticket__meta"><span>{line.role}</span><span>{line.clockIn && line.clockOut ? `${line.clockIn} to ${line.clockOut}, ` : ""}{hrs(line.hours)}</span></div>
          <ul className="ticket__why">{line.why.map((w, i) => <li key={i}>{w}</li>)}</ul>
          {r.disputes.filter((d) => d.status === "paid" && d.topUpCents).map((d) => (
            <p key={d._id}><strong>Top-up {money(d.topUpCents!)}</strong> paid after your note.</p>
          ))}
        </article>
      </div>

      {r.disputes.length > 0 && (
        <div className="thread" aria-live="polite">
          {r.disputes.map((d) => (
            <div key={d._id} style={{ display: "grid", gap: "var(--space-xs)" }}>
              <p className="bubble bubble--me">{d.message}</p>
              {d.status === "checking" ? (
                <p className="bubble"><span className="status status--pending"><Spinner />Checking the shift board…</span></p>
              ) : d.reply ? (
                <p className="bubble">{d.reply}{d.status === "approved" && " Your manager approved it; the top-up is on its way."}{d.status === "paid" && ` ${money(d.topUpCents ?? 0)} sent.`}</p>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {!active && line.amountCents >= 0 && (
        <button type="button" className="btn btn--quiet" onClick={() => setSheet(true)}>Something’s off?</button>
      )}

      <Sheet open={sheet} onClose={() => setSheet(false)} label="Tell your manager what’s off">
        <h2 style={{ fontSize: "var(--text-xl)" }}>What’s off?</h2>
        <div className="field">
          <label htmlFor="msg">Say it like you’d say it to your manager. Claude checks it against the shift board first.</label>
          <textarea id="msg" className="textarea" name="message" value={msg} maxLength={500} placeholder="I stayed till 1am, not midnight. Closed out the patio." onChange={(e) => setMsg(e.target.value)} />
          <p className={`help${err ? " help--error" : ""}`} role="alert">{err}</p>
        </div>
        <button type="button" className="btn btn--go btn--big btn--block" onClick={send} disabled={busy || msg.trim().length < 4} aria-busy={busy}>
          {busy ? "Sending…" : "Send to my manager"}
        </button>
      </Sheet>
    </div>
  );
}
