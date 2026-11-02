import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { errText, getOwnerKey, hrs, money } from "../lib/owner";
import { navigate, onLinkClick } from "../lib/router";
import { QRCodeSVG } from "qrcode.react";
import { Ticket, TicketSkeleton } from "../ui/Ticket";
import { Alert, Camera, Info, Spinner } from "../ui/icons";
import { isInputProblem, ProblemDialog, toProblem, useStoredProblem, type Problem } from "../ui/Problem";

/** /close without a night: jump to the latest one, or offer to start. */
export function CloseOutHome() {
  const ownerKey = getOwnerKey();
  const mine = useQuery(api.restaurants.mine, ownerKey ? { ownerKey } : "skip");
  const startNight = useMutation(api.restaurants.startNight);
  useEffect(() => {
    if (mine?.nights[0] && mine.nights[0].status !== "paid") navigate(`/close/${mine.nights[0]._id}`, true);
  }, [mine]);
  if (!ownerKey || mine === null)
    return (
      <div className="container page">
        <h1>No restaurant on this device yet</h1>
        <p className="muted" style={{ marginTop: "var(--space-sm)" }}>Start from the demo to get a restaurant of your own.</p>
        <p style={{ marginTop: "var(--space-lg)" }}><a className="btn btn--go" href="/" onClick={onLinkClick}>Go to the demo</a></p>
      </div>
    );
  if (mine === undefined) return <div className="container page"><span className="skel" style={{ width: 280, height: 40 }} /></div>;
  return (
    <div className="container page">
      <h1>Tonight’s pool is closed</h1>
      <p style={{ marginTop: "var(--space-lg)" }}>
        <button type="button" className="btn btn--go" onClick={async () => navigate(`/close/${await startNight({ ownerKey })}`)}>Start a new night</button>
      </p>
    </div>
  );
}

const longDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

/** Phones shoot 4 to 12 MB; the board only needs about 1800px on the long side. */
async function shrink(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob((b) => res(b ?? file), "image/jpeg", 0.85));
}

export default function CloseOut({ nightId }: { nightId: Id<"nights"> }) {
  const ownerKey = getOwnerKey() ?? "";
  const data = useQuery(api.nights.get, ownerKey ? { ownerKey, nightId } : "skip");
  const approve = useMutation(api.nights.approve);
  const retryBoard = useMutation(api.nights.retryBoard);
  const retryPolicy = useMutation(api.restaurants.retryPolicy);
  const [thrown, setThrown] = useState<Problem | null>(null);
  const boardPop = useStoredProblem(data?.night.boardProblem, `board:${nightId}`);
  const policyPop = useStoredProblem(data?.restaurant.policyProblem, "policy");
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState("");
  const splitRef = useRef<HTMLElement>(null);
  const [splitInView, setSplitInView] = useState(false);
  useEffect(() => {
    const el = splitRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setSplitInView(e.isIntersecting), { rootMargin: "0px 0px -40% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [data === undefined]);

  if (!ownerKey) return <CloseOutHome />;
  if (data === undefined)
    return (
      <div className="container page closeout" aria-busy="true">
        <div><span className="skel" style={{ width: "70%", height: 44 }} /></div>
        <div className="tickets">{Array.from({ length: 6 }, (_, i) => <TicketSkeleton key={i} />)}</div>
      </div>
    );

  const { restaurant, night, preview, boardUrl, tips } = data;
  const locked = night.status === "paying" || night.status === "paid";
  const byKey = new Map<string, "error" | "warn">();
  for (const f of preview.flags) if (f.key && byKey.get(f.key) !== "error") byKey.set(f.key, f.severity);
  const blocking = preview.flags.filter((f) => f.severity === "error" && f.code !== "manager_in_pool");
  const paid = preview.lines.filter((l) => l.amountCents > 0);
  const ready = night.status === "review" && !!restaurant.rules && blocking.length === 0 && preview.totals.totalCents > 0;

  async function pay() {
    setPaying(true);
    setPayError("");
    try {
      await approve({ ownerKey, nightId });
      navigate(`/wall/${nightId}`);
    } catch (e) {
      const p = toProblem(e);
      if (isInputProblem(p)) setPayError(p.message);
      else setThrown(p);
      setPaying(false);
    }
  }

  return (
    <div className="container page">
      <div className="closeout">
        <div>
          <div className="closeout__head">
            <h1>Close out {longDate(night.date)}</h1>
            <p className="muted">{restaurant.name}</p>
          </div>
          {locked && (
            <div className="notice" style={{ marginBottom: "var(--space-lg)" }}>
              <Info />
              <span>This night is {night.status === "paid" ? "paid out" : "being paid out"}. <a href={`/wall/${nightId}`} onClick={onLinkClick}>Open the payout wall</a>.</span>
            </div>
          )}
          <ol className="steps">
            <TipsStep ownerKey={ownerKey} nightId={nightId} totals={preview.totals} tips={tips} slug={restaurant.slug} locked={locked} extra={night.extraTipsCents} />
            <BoardStep ownerKey={ownerKey} nightId={nightId} status={night.status} boardUrl={boardUrl} boardError={night.boardProblem ? `${night.boardProblem.title}. ${night.boardProblem.message}` : night.boardError} onProblem={setThrown} count={night.shifts.length} demo={restaurant.demo} locked={locked} />
            <PolicyStep ownerKey={ownerKey} text={restaurant.policyText} summary={restaurant.rulesSummary} hasRules={!!restaurant.rules} locked={locked}
              problem={restaurant.policyProblem} onRetry={() => retryPolicy({ ownerKey })} />
          </ol>
        </div>

        <section className="closeout__rail" aria-labelledby="split-h" ref={splitRef}>
          <div className="rail">
            <div className="rail__head">
              <h2 id="split-h">The split</h2>
              <span className="mono">{money(preview.totals.totalCents)} to {paid.length} {paid.length === 1 ? "person" : "people"}</span>
            </div>

            {preview.flags.length > 0 && night.shifts.length > 0 && (
              <ul className="flags" style={{ marginBottom: "var(--space-md)" }}>
                {preview.flags.map((f, i) => (
                  <li key={i} className={`flag flag--${f.severity}`}>{f.severity === "error" ? <Alert /> : <Info />}<span>{f.message}</span></li>
                ))}
              </ul>
            )}

            {night.status === "reading" ? (
              <div className="tickets" aria-busy="true">{Array.from({ length: 6 }, (_, i) => <TicketSkeleton key={i} />)}</div>
            ) : night.shifts.length === 0 ? (
              <div style={{ display: "grid", gap: "var(--space-md)" }}>
                <div className="notice"><Info /><span>Tickets appear here once the shift board is read. Each one is a person’s share, worked out from the house rules. No photo? Type the shifts in.</span></div>
                <AddRow ownerKey={ownerKey} nightId={nightId} locked={locked} />
              </div>
            ) : (
              <div className="tickets">
                {(locked ? data.lines : preview.lines).map((l) => (
                  <EditableTicket key={l.key} line={l} flag={byKey.get(l.key)} ownerKey={ownerKey} nightId={nightId} locked={locked} />
                ))}
                <AddRow ownerKey={ownerKey} nightId={nightId} locked={locked} />
              </div>
            )}

            {!locked && night.shifts.length > 0 && (
              <div style={{ marginTop: "var(--space-lg)", display: "grid", gap: "var(--space-xs)" }}>
                <button type="button" className="btn btn--go btn--big btn--block" onClick={pay} disabled={!ready || paying} aria-busy={paying}>
                  {paying ? <><Spinner />Sending to PayPal…</> : `Approve and pay ${money(paid.reduce((a, l) => a + l.amountCents, 0))}`}
                </button>
                <p className={`help${payError || blocking.length ? " help--error" : ""}`} role="alert">
                  {payError || (blocking.length ? "Fix the red items above first." : !restaurant.rules ? "Waiting on the house rules." : `One PayPal batch, ${paid.length} payouts. Each person gets a receipt link.`)}
                </p>
              </div>
            )}
          </div>
        </section>
      </div>
      <ProblemDialog problem={thrown} onClose={() => setThrown(null)} onRetry={thrown?.kind === "network" ? pay : undefined} />
      <ProblemDialog problem={!thrown ? boardPop.open : null} onClose={boardPop.dismiss} onRetry={() => retryBoard({ ownerKey, nightId })} />
      <ProblemDialog problem={!thrown && !boardPop.open ? policyPop.open : null} onClose={policyPop.dismiss} onRetry={() => retryPolicy({ ownerKey })} />
      {night.shifts.length > 0 && !splitInView && (
        <div className="paybar">
          <span className="money">{money(paid.reduce((a, l) => a + l.amountCents, 0))} <span className="small muted">to {paid.length}</span></span>
          <button type="button" className="btn btn--go" onClick={() => splitRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
            {locked ? "See the split" : "Review and pay"}
          </button>
        </div>
      )}
    </div>
  );
}

function TipsStep(p: { ownerKey: string; nightId: Id<"nights">; totals: { paypalCents: number; extraCents: number; totalCents: number }; tips: { _id: string; amountCents: number; status: string; simulated: boolean; at: number; payer?: string }[]; slug: string; locked: boolean; extra: number }) {
  const setExtra = useMutation(api.nights.setExtraTips);
  const [val, setVal] = useState((p.extra / 100).toFixed(2));
  const [err, setErr] = useState("");
  useEffect(() => setVal((p.extra / 100).toFixed(2)), [p.extra]);
  const captured = p.tips.filter((t) => t.status === "captured");

  async function save() {
    const cents = Math.round(Number(val.replace(/[$,\s]/g, "")) * 100);
    if (!Number.isFinite(cents)) return setErr("Enter an amount like 1184.50.");
    setErr("");
    try { await setExtra({ ownerKey: p.ownerKey, nightId: p.nightId, cents }); } catch (e) { setErr(errText(e)); }
  }

  return (
    <li className="step" data-done={p.totals.totalCents > 0}>
      <div className="step__title"><h2 style={{ fontSize: "var(--text-xl)" }}>Tonight’s tips</h2></div>
      <div className="step__body">
        <div className="total"><span className="money">{money(p.totals.totalCents)}</span><span className="muted small">in the pool</span></div>
        <ul className="tiplist">
          <li><span>PayPal tips from guests ({captured.length})</span><span className="mono">{money(p.totals.paypalCents)}</span></li>
          {captured.slice(-4).reverse().map((t) => (
            <li key={t._id} className="muted"><span>{t.payer ?? "Guest"} at {new Date(t.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}{t.simulated ? " (sample)" : ""}</span><span className="mono">{money(t.amountCents)}</span></li>
          ))}
        </ul>
        <div className="field">
          <label htmlFor="extra">Card and cash tips, from the terminal report</label>
          <div className="row">
            <input id="extra" className="input input--money" style={{ width: "10rem" }} inputMode="decimal" autoComplete="off" name="extra" value={val}
              onChange={(e) => setVal(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === "Enter" && save()} disabled={p.locked} />
          </div>
          <p className={`help${err ? " help--error" : ""}`}>{err}</p>
        </div>
        {!p.locked && (
          <a className="qr qr--tip" href={`/tip/${p.slug}`} target="_blank" rel="noreferrer">
            <QRCodeSVG value={`${location.origin}/tip/${p.slug}`} size={88} bgColor="transparent" fgColor="currentColor" level="M" />
            <span><strong>Guests scan to tip with PayPal.</strong><br /><span className="small muted">It lands in tonight’s pool the moment they pay.</span></span>
          </a>
        )}
      </div>
    </li>
  );
}

function BoardStep(p: { ownerKey: string; nightId: Id<"nights">; status: string; boardUrl: string | null; boardError?: string; count: number; demo: boolean; locked: boolean; onProblem: (p: Problem) => void }) {
  const uploadUrl = useMutation(api.nights.uploadUrl);
  const setBoard = useMutation(api.nights.setBoard);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function send(blob: Blob) {
    setBusy(true);
    setErr("");
    try {
      const url = await uploadUrl({ ownerKey: p.ownerKey });
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": blob.type || "image/jpeg" }, body: blob });
      if (!res.ok) throw new Error("network: upload failed");
      const { storageId } = await res.json();
      await setBoard({ ownerKey: p.ownerKey, nightId: p.nightId, storageId });
    } catch (e) {
      const pr = toProblem(e);
      if (isInputProblem(pr)) setErr(pr.message);
      else p.onProblem(pr);
    } finally {
      setBusy(false);
    }
  }

  const reading = p.status === "reading";
  return (
    <li className="step" data-done={p.count > 0}>
      <div className="step__title"><h2 style={{ fontSize: "var(--text-xl)" }}>The shift board</h2></div>
      <div className="step__body">
        {p.boardUrl && (
          <div className="board">
            <img className="board__thumb" src={p.boardUrl} width="96" height="72" alt="Tonight’s shift board" />
            <div>
              {reading ? <span className="status status--pending" role="status"><Spinner />Claude is reading the board…</span>
                : p.count > 0 ? <span>{p.count} people on the board</span> : null}
            </div>
          </div>
        )}
        {(p.boardError || err) && <div className="notice notice--error" role="alert"><Alert /><span>{err || p.boardError}</span></div>}
        {!p.locked && !reading && (
          <div className="row">
            <input ref={input} type="file" accept="image/*" capture="environment" className="visually-hidden" tabIndex={-1} aria-hidden="true"
              onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) await send(await shrink(f)); }} />
            <button type="button" className={`btn ${p.count ? "btn--quiet" : ""}`} onClick={() => input.current?.click()} disabled={busy} aria-busy={busy}>
              {busy ? <Spinner /> : <Camera />}{p.count ? "Retake photo" : "Take or upload a photo"}
            </button>
            {p.demo && (
              <button type="button" className="btn btn--quiet" disabled={busy} onClick={async () => {
                const r = await fetch("/demo/rosas-board.jpg");
                await send(await r.blob());
              }}>Use Rosa’s board photo</button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function PolicyStep(p: { ownerKey: string; text: string; summary?: string[]; hasRules: boolean; locked: boolean; problem?: Problem; onRetry: () => unknown }) {
  const setPolicy = useMutation(api.restaurants.setPolicy);
  const [val, setVal] = useState(p.text);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setVal(p.text), [p.text]);
  const dirty = val.trim() !== p.text;

  return (
    <li className="step" data-done={p.hasRules}>
      <div className="step__title"><h2 style={{ fontSize: "var(--text-xl)" }}>House rules</h2></div>
      <div className="step__body">
        <div className="field">
          <label htmlFor="policy">How your team splits tips, in your own words</label>
          <textarea id="policy" className="textarea" name="policy" value={val} onChange={(e) => setVal(e.target.value)} disabled={p.locked} maxLength={1500} />
          <p className={`help${err ? " help--error" : ""}`}>{err}</p>
        </div>
        {dirty && !p.locked && (
          <div><button type="button" className="btn" disabled={busy} aria-busy={busy} onClick={async () => {
            setBusy(true); setErr("");
            try { await setPolicy({ ownerKey: p.ownerKey, text: val }); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
          }}>Save rules</button></div>
        )}
        {p.problem ? (
          <div className="notice notice--error" role="alert"><Alert /><span>{p.problem.title}. <button type="button" className="linkbtn" onClick={() => p.onRetry()}>Try again</button></span></div>
        ) : p.summary === undefined ? (
          <span className="status status--pending" role="status"><Spinner />Reading the rules…</span>
        ) : (
          <div>
            <p className="label">How Last Call read it</p>
            <ul className="rules">{p.summary.map((s, i) => <li key={i}>{s}</li>)}</ul>
          </div>
        )}
      </div>
    </li>
  );
}

type L = { key: string; name: string; role: string; hours: number; points: number; amountCents: number; why: string[]; clockIn?: string; clockOut?: string; payoutStatus?: string };

function EditableTicket({ line, flag, ownerKey, nightId, locked }: { line: L; flag?: "error" | "warn"; ownerKey: string; nightId: Id<"nights">; locked: boolean }) {
  const edit = useMutation(api.nights.editShift);
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState(false);
  const [role, setRole] = useState(line.role);
  const [hours, setHours] = useState(String(line.hours));
  const [err, setErr] = useState("");

  async function save(remove = false) {
    setErr("");
    try {
      await edit({ ownerKey, nightId, key: line.key, name: line.name, role, hours: Number(hours), remove });
      setOpen(false);
    } catch (e) { setErr(errText(e)); }
  }

  return (
    <Ticket name={line.name} role={line.role} hours={line.hours} amountCents={line.amountCents} clockIn={line.clockIn} clockOut={line.clockOut} why={line.why} flag={flag} showWhy={why}>
      {open ? (
        <form className="ticket__edit" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <div className="field"><label htmlFor={`r-${line.key}`}>Role</label><input id={`r-${line.key}`} className="input" value={role} onChange={(e) => setRole(e.target.value)} /></div>
          <div className="field"><label htmlFor={`h-${line.key}`}>Hours</label><input id={`h-${line.key}`} className="input" inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} /></div>
          <div className="row" style={{ gridColumn: "1 / -1" }}>
            <button type="submit" className="btn">Save</button>
            <button type="button" className="btn btn--quiet" onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="linkbtn small" onClick={() => save(true)}>Remove {line.name}</button>
          </div>
          {err && <p className="help help--error" style={{ gridColumn: "1 / -1" }}>{err}</p>}
        </form>
      ) : (
        <div className="row small" style={{ fontFamily: "var(--font-body)" }}>
          <button type="button" className="linkbtn" onClick={() => setWhy(!why)} aria-expanded={why}>{why ? "Hide the math" : "Show the math"}</button>
          {!locked && <button type="button" className="linkbtn" onClick={() => setOpen(true)}>Fix {hrs(line.hours)}</button>}
        </div>
      )}
    </Ticket>
  );
}

function AddRow({ ownerKey, nightId, locked }: { ownerKey: string; nightId: Id<"nights">; locked: boolean }) {
  const edit = useMutation(api.nights.editShift);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState("server");
  const [hours, setHours] = useState("");
  const [err, setErr] = useState("");
  if (locked) return null;
  if (!open) return <button type="button" className="btn btn--quiet" style={{ alignSelf: "start" }} onClick={() => setOpen(true)}>Add a missed name</button>;
  return (
    <form className="ticket" onSubmit={async (e) => {
      e.preventDefault(); setErr("");
      try { await edit({ ownerKey, nightId, name, role, hours: Number(hours) }); setOpen(false); setName(""); setHours(""); } catch (x) { setErr(errText(x)); }
    }}>
      <div className="field"><label htmlFor="add-name">Name</label><input id="add-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" /></div>
      <div className="ticket__edit">
        <div className="field"><label htmlFor="add-role">Role</label><input id="add-role" className="input" value={role} onChange={(e) => setRole(e.target.value)} /></div>
        <div className="field"><label htmlFor="add-h">Hours</label><input id="add-h" className="input" inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} /></div>
      </div>
      <div className="row"><button type="submit" className="btn">Add</button><button type="button" className="btn btn--quiet" onClick={() => setOpen(false)}>Cancel</button></div>
      {err && <p className="help help--error">{err}</p>}
    </form>
  );
}
