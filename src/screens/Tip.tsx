import { useEffect, useRef, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { errText, money } from "../lib/owner";
import { Check } from "../ui/icons";

declare global {
  interface Window {
    paypal?: { Buttons: (o: object) => { render: (el: HTMLElement) => Promise<void>; close: () => void } };
  }
}

function loadSdk(clientId: string) {
  const id = "paypal-sdk";
  if (document.getElementById(id)) return Promise.resolve();
  return new Promise<void>((res, rej) => {
    const s = document.createElement("script");
    s.id = id;
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture&enable-funding=venmo`;
    s.onload = () => res();
    s.onerror = () => rej(new Error("PayPal didn’t load. Check your connection."));
    document.head.appendChild(s);
  });
}

const AMOUNTS = [500, 1000, 2000, 5000];

export default function Tip({ slug }: { slug: string }) {
  const page = useQuery(api.tips.page, { slug });
  const createOrder = useAction(api.tips.createOrder);
  const capture = useAction(api.tips.captureOrder);
  const [cents, setCents] = useState(1000);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const centsRef = useRef(cents);
  centsRef.current = cents;

  useEffect(() => {
    if (!page?.paypalClientId || !page.open || done !== null || !box.current) return;
    let btn: { close: () => void } | null = null;
    loadSdk(page.paypalClientId)
      .then(() => {
        if (!window.paypal || !box.current) return;
        box.current.innerHTML = "";
        const b = window.paypal.Buttons({
          style: { layout: "vertical", shape: "rect", label: "pay", height: 48 },
          createOrder: () => createOrder({ slug, cents: centsRef.current }),
          onApprove: async (d: { orderID: string }) => {
            await capture({ orderId: d.orderID });
            setDone(centsRef.current);
          },
          onError: (e: unknown) => setErr(errText(e)),
        });
        btn = b;
        return b.render(box.current);
      })
      .catch((e) => setErr(errText(e)));
    return () => btn?.close();
  }, [page?.paypalClientId, page?.open, done, slug, createOrder, capture]);

  if (page === undefined) return <div className="tip-page"><div className="tip-card"><span className="skel" style={{ height: 40 }} /></div></div>;
  if (page === null) return <div className="tip-page"><div className="tip-card"><h1 style={{ fontSize: "var(--text-2xl)" }}>This tip link doesn’t work</h1></div></div>;

  return (
    <div className="tip-page">
      <div className="tip-card">
        <div>
          <p className="muted">Tip the team at</p>
          <h1>{page.name}</h1>
        </div>
        {done !== null ? (
          <div className="ticket">
            <span className="status status--success"><Check />Thank you</span>
            <p style={{ fontFamily: "var(--font-body)" }}>{money(done)} goes into tonight’s pool. Everyone on shift gets their share before they leave.</p>
          </div>
        ) : !page.open ? (
          <p>Tonight’s pool is already paid out. Thanks for thinking of the team.</p>
        ) : (
          <>
            <div className="chips" role="group" aria-label="Tip amount">
              {AMOUNTS.map((a) => (
                <button key={a} type="button" className="chip" aria-pressed={cents === a} onClick={() => setCents(a)}>${a / 100}</button>
              ))}
            </div>
            <p className="small muted">The whole tip goes to the floor, bar and kitchen, split by the house rules.</p>
            {page.paypalClientId ? <div ref={box} style={{ minHeight: 110 }} /> : <div className="notice"><span /><span>PayPal sandbox isn’t connected yet, so guest tips are off in this demo.</span></div>}
            {err && <p className="help help--error" role="alert">{err}</p>}
          </>
        )}
      </div>
    </div>
  );
}
