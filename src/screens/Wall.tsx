import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { QRCodeSVG } from "qrcode.react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { errText, getOwnerKey, hrs, money } from "../lib/owner";
import { onLinkClick } from "../lib/router";
import { Ticket, TicketSkeleton, type PayoutStatus } from "../ui/Ticket";
import { Alert, Info } from "../ui/icons";
import { CloseOutHome } from "./CloseOut";

export default function Wall({ nightId }: { nightId: Id<"nights"> }) {
  const ownerKey = getOwnerKey() ?? "";
  const data = useQuery(api.nights.get, ownerKey ? { ownerKey, nightId } : "skip");
  if (!ownerKey) return <CloseOutHome />;
  if (data === undefined)
    return <div className="container page wall"><div className="tickets">{Array.from({ length: 9 }, (_, i) => <TicketSkeleton key={i} />)}</div></div>;

  const { night, lines, disputes, restaurant } = data;
  if (lines.length === 0)
    return (
      <div className="container page">
        <h1>Nothing sent yet</h1>
        <p className="muted" style={{ marginTop: "var(--space-sm)" }}>Approve the split first, then the payouts show up here.</p>
        <p style={{ marginTop: "var(--space-lg)" }}><a className="btn" href={`/close/${nightId}`} onClick={onLinkClick}>Back to the close-out</a></p>
      </div>
    );

  const paidLines = lines.filter((l) => l.amountCents > 0);
  const done = paidLines.filter((l) => l.payoutStatus === "success");
  const sent = done.reduce((a, l) => a + l.amountCents, 0);
  const origin = location.origin;

  return (
    <div className="container page wall">
      <div className="rail__head" style={{ marginTop: 0 }}>
        <div>
          <h1>{night.status === "paid" ? "Everyone’s paid" : "Paying the team"}</h1>
          <p className="muted" style={{ marginTop: "var(--space-xs)" }}>{restaurant.name}, {night.date}</p>
        </div>
        <div className="wall__sum" aria-live="polite">
          <dl><dt>Paid</dt><dd>{done.length} of {paidLines.length}</dd></dl>
          <dl><dt>Sent</dt><dd>{money(sent)}</dd></dl>
        </div>
      </div>

      <p className="small muted" style={{ marginBottom: "var(--space-md)" }}>
        PayPal batch <span className="mono">{night.payoutBatchId ?? "starting…"}</span>
        {night.simulated && <span className="badge" style={{ marginLeft: "var(--space-xs)" }}>Simulated: PayPal sandbox keys not set</span>}
        {!night.simulated && data.sandbox && <span className="badge" style={{ marginLeft: "var(--space-xs)" }}>PayPal sandbox: Venmo payouts go to the PayPal wallet here, Venmo runs in live mode</span>}
      </p>
      {night.payoutError && <div className="notice notice--error" role="alert" style={{ marginBottom: "var(--space-md)" }}><Alert /><span>{night.payoutError}</span></div>}

      <div className="rail">
        <div className="tickets" style={{ marginTop: "var(--space-lg)" }}>
          {lines.map((l) => (
            <Ticket key={l._id} name={l.name} role={l.role} hours={l.hours} amountCents={l.amountCents} status={l.payoutStatus as PayoutStatus}
              wallet={data.preview.lines.find((p) => p.key === l.key)?.worker?.wallet}>
              {l.amountCents > 0 && (
                <>
                  <hr className="ticket__cut" />
                  <a className="qr" href={`/r/${l.receiptToken}`} target="_blank" rel="noreferrer" aria-label={`Open ${l.name}'s receipt`}>
                    <QRCodeSVG value={`${origin}/r/${l.receiptToken}`} size={64} bgColor="transparent" fgColor="currentColor" level="L" />
                    <span className="small">{l.name.split(" ")[0]}'s receipt, as they see it</span>
                  </a>
                </>
              )}
            </Ticket>
          ))}
        </div>
      </div>

      <Corrections ownerKey={ownerKey} disputes={disputes} lines={lines} />
    </div>
  );
}

type D = { _id: Id<"disputes">; lineId: Id<"lines">; message: string; status: string; verdict?: string; claimedHours?: number; topUpCents?: number; topUpStatus?: string };
type Ln = { _id: Id<"lines">; name: string; hours: number; amountCents: number };

function Corrections({ ownerKey, disputes, lines }: { ownerKey: string; disputes: D[]; lines: Ln[] }) {
  const decide = useMutation(api.disputes.decide);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <section style={{ marginTop: "var(--space-2xl)" }} aria-labelledby="corr-h">
      <h2 id="corr-h">Corrections</h2>
      {disputes.length === 0 ? (
        <p className="muted" style={{ marginTop: "var(--space-xs)" }}>When someone says their share is off, it shows up here with Claude’s read of the board and a top-up ready to approve.</p>
      ) : (
        <div className="disputes" style={{ marginTop: "var(--space-md)" }}>
          {disputes.map((d) => {
            const l = lines.find((x) => x._id === d.lineId)!;
            const [reply, note] = (d.verdict ?? "").split("\n\nFor the manager: ");
            return (
              <article key={d._id} className="dispute">
                <div className="dispute__head">
                  <h3>{l.name}, paid {money(l.amountCents)} for {hrs(l.hours)}</h3>
                  <span className="badge">{label(d)}</span>
                </div>
                <blockquote>“{d.message}”</blockquote>
                {d.status === "checking" ? <span className="small muted">Claude is checking the board…</span> : (
                  <>
                    {note && <p className="notice"><Info /><span>{note}</span></p>}
                    {reply && <p className="small muted">Told {l.name.split(" ")[0]}: {reply}</p>}
                  </>
                )}
                {d.status === "proposed" && d.topUpCents && (
                  <div className="row">
                    <button type="button" className="btn btn--go" disabled={busy === d._id} aria-busy={busy === d._id} onClick={async () => {
                      setBusy(d._id); setErr("");
                      try { await decide({ ownerKey, disputeId: d._id, approve: true }); } catch (e) { setErr(errText(e)); } finally { setBusy(null); }
                    }}>Send {money(d.topUpCents)} top-up for {d.claimedHours}h</button>
                    <button type="button" className="btn btn--quiet" disabled={busy === d._id} onClick={() => decide({ ownerKey, disputeId: d._id, approve: false })}>Decline</button>
                  </div>
                )}
              </article>
            );
          })}
          {err && <p className="help help--error" role="alert">{err}</p>}
        </div>
      )}
    </section>
  );
}

function label(d: D) {
  if (d.status === "checking") return "Checking";
  if (d.status === "proposed") return "Needs your OK";
  if (d.status === "approved") return d.topUpStatus === "failed" ? "Top-up failed" : "Sending top-up";
  if (d.status === "paid") return "Topped up";
  return "Closed";
}
