import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { navigate, onLinkClick } from "../lib/router";
import { setOwnerKey } from "../lib/owner";
import { ProblemDialog, toProblem, type Problem } from "../ui/Problem";
import { Ticket } from "../ui/Ticket";
import { Arrow } from "../ui/icons";

// The rail on the landing page is a picture of the product, labelled as an example night.
const SAMPLE = [
  { name: "Ana", role: "server", hours: 7, amountCents: 17842, status: "success" as const, wallet: "PAYPAL" },
  { name: "Ben", role: "bartender", hours: 9.5, amountCents: 24214, status: "success" as const, wallet: "VENMO" },
  { name: "Dev", role: "busser", hours: 6, amountCents: 7647, status: "pending" as const, wallet: "VENMO" },
  { name: "Gus", role: "kitchen", hours: 8, amountCents: 6510, status: "success" as const, wallet: "VENMO" },
  { name: "Iris", role: "barback", hours: 6.5, amountCents: 8284, status: "pending" as const, wallet: "PAYPAL" },
  { name: "Marco", role: "manager", hours: 10.5, amountCents: 0, status: "none" as const, wallet: null },
];

export default function Landing() {
  const createDemo = useMutation(api.restaurants.createDemo);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  async function start() {
    setBusy(true);
    setProblem(null);
    try {
      const { ownerKey, nightId } = await createDemo({});
      setOwnerKey(ownerKey);
      navigate(`/close/${nightId}`);
    } catch (e) {
      setProblem(toProblem(e));
      setBusy(false);
    }
  }

  return (
    <div className="container">
      <section className="land" aria-labelledby="land-h">
        <div>
          <h1 id="land-h">Everyone’s tipped out before the lights go up.</h1>
          <p className="land__lede">Snap the shift board, say the house rules once. Last Call splits the pool to the cent and pays each person by PayPal or Venmo, tonight.</p>
          <div className="land__act">
            <button type="button" className="btn btn--go btn--big" onClick={start} aria-busy={busy} disabled={busy}>
              {busy ? "Opening Rosa’s…" : "Close out a demo night"}
              {!busy && <Arrow />}
            </button>
            <a className="btn btn--big" href="/setup" onClick={onLinkClick}>Set up your restaurant</a>
          </div>
          <p className="small muted" style={{ marginTop: "var(--space-sm)" }}>The demo is a sample taqueria with nine staff. Both run on real PayPal sandbox money.</p>
          <ProblemDialog problem={problem} onClose={() => setProblem(null)} onRetry={start} />
        </div>
        <div className="land__rail" aria-label="Example night: each share is a ticket on the rail">
          <div className="rail">
            <div className="rail__head">
              <span className="small muted">Example night, Rosa’s Taqueria</span>
              <span className="small mono">$1,302.00 pool</span>
            </div>
            <div className="tickets">
              {SAMPLE.map((t) => <Ticket key={t.name} {...t} />)}
            </div>
          </div>
        </div>
      </section>

      <section className="how" aria-label="How a close-out works">
        <div>
          <h2>One photo of the board</h2>
          <p>Whiteboard, printout or sign-in sheet. Claude reads names, roles and hours, and says where it’s unsure.</p>
        </div>
        <div>
          <h2>House rules in your words</h2>
          <p>“Bussers get half a point, kitchen 10% off the top.” The math runs in code, never in the model. Managers stay out, as the law requires.</p>
        </div>
        <div>
          <h2>Receipts that show the math</h2>
          <p>Each person gets a link with their share worked out line by line, and a way to say “I stayed till close.”</p>
        </div>
      </section>

      <footer className="foot">
        <span>Built for the PayPal AI Hackathon. Sandbox money only.</span>
        <a href="https://github.com/devpras22/lastcall">Source on GitHub</a>
      </footer>
    </div>
  );
}
