import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { QRCodeSVG } from "qrcode.react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { errText, getOwnerKey } from "../lib/owner";
import { Check, Info } from "../ui/icons";
import { CloseOutHome } from "./CloseOut";

type W = { _id: Id<"workers">; name: string; role: string; wallet?: "PAYPAL" | "VENMO"; receiver?: string; addedBy?: string };

const hint = (w: W) =>
  !w.receiver ? null : w.wallet === "VENMO" ? `Venmo •••${w.receiver.slice(-4)}` : w.receiver.includes("@") ? `PayPal ${w.receiver.replace(/^(.).*(@.*)$/, "$1•••$2")}` : `PayPal •••${w.receiver.slice(-4)}`;

export default function Staff() {
  const ownerKey = getOwnerKey() ?? "";
  const mine = useQuery(api.restaurants.mine, ownerKey ? { ownerKey } : "skip");
  const ensure = useMutation(api.restaurants.ensureJoinToken);
  const reset = useMutation(api.restaurants.resetJoinToken);
  const [copied, setCopied] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (mine && !mine.restaurant.joinToken) ensure({ ownerKey });
  }, [mine, ensure, ownerKey]);

  if (!ownerKey || mine === null) return <CloseOutHome />;
  if (mine === undefined) return <div className="container page"><span className="skel" style={{ width: 280, height: 40 }} /></div>;

  const token = mine.restaurant.joinToken;
  const link = token ? `${location.origin}/join/${token}` : "";
  const workers = [...(mine.workers as W[])].sort((a, b) => Number(!!a.receiver) - Number(!!b.receiver) || a.name.localeCompare(b.name));
  const ready = workers.filter((w) => w.receiver).length;

  return (
    <div className="container page">
      <div className="staff">
        <div>
          <h1>Staff</h1>
          <p className="muted" style={{ marginTop: "var(--space-xs)" }}>
            {workers.length === 0 ? "No one yet." : `${ready} of ${workers.length} can be paid tonight.`}
          </p>

          <ul className="staff__list">
            {workers.map((w) => <StaffRow key={w._id} w={w} ownerKey={ownerKey} />)}
          </ul>
          {adding ? <StaffForm ownerKey={ownerKey} onDone={() => setAdding(false)} /> : (
            <button type="button" className="btn" style={{ marginTop: "var(--space-md)" }} onClick={() => setAdding(true)}>Add someone</button>
          )}
        </div>

        <aside className="joincard" aria-labelledby="join-h">
          <h2 id="join-h">Let staff add themselves</h2>
          <p>Share this link in the team chat or show the code at pre-shift. Each person adds the PayPal email or Venmo number they want to be paid to. You never type anyone’s details.</p>
          {link ? (
            <>
              <div className="joincard__qr"><QRCodeSVG value={link} size={168} bgColor="transparent" fgColor="currentColor" level="M" /></div>
              <div className="row">
                <button type="button" className="btn btn--go" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* clipboard blocked: the link is still on screen */ } }}>
                  {copied ? <><Check />Copied</> : "Copy staff link"}
                </button>
                <a className="btn" href={link} target="_blank" rel="noreferrer">Open it</a>
              </div>
              <p className="small mono joincard__link">{link}</p>
              <p className="small muted"><button type="button" className="linkbtn" onClick={() => reset({ ownerKey })}>Make a new link</button> if the old one was shared too widely. The old one stops working.</p>
            </>
          ) : <span className="skel" style={{ width: 168, height: 168 }} />}
          {mine.restaurant.demo && (
            <p className="notice small"><Info /><span>This is PayPal’s test mode. A payout to an email with no sandbox account waits as “unclaimed”, which is real PayPal behavior.</span></p>
          )}
        </aside>
      </div>
    </div>
  );
}

function StaffRow({ w, ownerKey }: { w: W; ownerKey: string }) {
  const remove = useMutation(api.restaurants.removeWorker);
  const [editing, setEditing] = useState(false);
  if (editing) return <li className="staff__row"><StaffForm ownerKey={ownerKey} w={w} onDone={() => setEditing(false)} /></li>;
  return (
    <li className="staff__row">
      <div>
        <strong>{w.name}</strong> <span className="muted small">{w.role}</span>
        <div className="small">{w.receiver ? <span className="status status--success"><Check />{hint(w)}{w.addedBy === "self" ? ", added by them" : ""}</span> : <span className="muted">No payout details yet</span>}</div>
      </div>
      <div className="row small">
        <button type="button" className="linkbtn" onClick={() => setEditing(true)}>Edit</button>
        <button type="button" className="linkbtn" onClick={() => { if (confirm(`Remove ${w.name} from the staff list?`)) remove({ ownerKey, workerId: w._id }); }}>Remove</button>
      </div>
    </li>
  );
}

function StaffForm({ ownerKey, w, onDone }: { ownerKey: string; w?: W; onDone: () => void }) {
  const upsert = useMutation(api.restaurants.upsertWorker);
  const [name, setName] = useState(w?.name ?? "");
  const [role, setRole] = useState(w?.role ?? "server");
  const [wallet, setWallet] = useState<"PAYPAL" | "VENMO">(w?.wallet ?? "PAYPAL");
  const [receiver, setReceiver] = useState(w?.receiver ?? "");
  const [err, setErr] = useState("");
  const id = w?._id ?? "new";
  return (
    <form className="staff__form" onSubmit={async (e) => {
      e.preventDefault(); setErr("");
      try { await upsert({ ownerKey, workerId: w?._id, name, role, wallet, receiver }); onDone(); } catch (x) { setErr(errText(x)); }
    }}>
      <div className="field"><label htmlFor={`n-${id}`}>Name</label><input id={`n-${id}`} className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" /></div>
      <div className="field"><label htmlFor={`r-${id}`}>Role</label><input id={`r-${id}`} className="input" value={role} onChange={(e) => setRole(e.target.value)} /></div>
      <WalletPicker value={wallet} onChange={setWallet} />
      <div className="field"><label htmlFor={`p-${id}`}>{wallet === "VENMO" ? "Venmo phone number" : "PayPal email or phone"} (optional)</label>
        <input id={`p-${id}`} className="input" value={receiver} onChange={(e) => setReceiver(e.target.value)} inputMode={wallet === "VENMO" ? "tel" : "email"} autoComplete="off" /></div>
      {err && <p className="help help--error" role="alert">{err}</p>}
      <div className="row"><button type="submit" className="btn btn--go">Save</button><button type="button" className="btn" onClick={onDone}>Cancel</button></div>
    </form>
  );
}

export function WalletPicker({ value, onChange }: { value: "PAYPAL" | "VENMO"; onChange: (v: "PAYPAL" | "VENMO") => void }) {
  return (
    <div className="field">
      <span className="label" id="wallet-l">Paid to</span>
      <div className="chips chips--2" role="group" aria-labelledby="wallet-l">
        <button type="button" className="chip chip--text" aria-pressed={value === "PAYPAL"} onClick={() => onChange("PAYPAL")}>PayPal</button>
        <button type="button" className="chip chip--text" aria-pressed={value === "VENMO"} onClick={() => onChange("VENMO")}>Venmo</button>
      </div>
    </div>
  );
}
