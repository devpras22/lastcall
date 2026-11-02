import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { navigate } from "../lib/router";
import { setOwnerKey } from "../lib/owner";
import { ProblemDialog, toProblem, type Problem } from "../ui/Problem";

const RULES_EXAMPLE =
  "Servers and bartenders get 1 point an hour. Bussers and hosts get half. Kitchen gets 10% off the top, split by hours.";

/** "Ana, server" per line → staff. Commas, dashes or tabs all work. */
function parseStaff(text: string) {
  return text
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [name, role] = l.split(/\s*[,\t–-]\s*/);
      return { name: name ?? "", role: role ?? "server" };
    })
    .filter((s) => s.name.length > 0);
}

export default function Setup() {
  const createOwn = useMutation(api.restaurants.createOwn);
  const [name, setName] = useState("");
  const [rules, setRules] = useState(RULES_EXAMPLE);
  const [staff, setStaff] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [problem, setProblem] = useState<Problem | null>(null);
  const people = parseStaff(staff);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const { ownerKey, nightId } = await createOwn({ name, policyText: rules, staff: people });
      setOwnerKey(ownerKey);
      navigate(`/close/${nightId}`);
    } catch (x) {
      const p = toProblem(x);
      if (p.kind === "input") setErr(p.message);
      else setProblem(p);
      setBusy(false);
    }
  }

  return (
    <div className="container page">
      <div className="setup">
        <div className="setup__head">
          <h1>Set up your restaurant</h1>
          <p className="muted">Two minutes. Then snap tonight’s board and pay your team through PayPal’s sandbox.</p>
        </div>
        <form className="setup__form" onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="r-name">Restaurant name</label>
            <input id="r-name" className="input" name="restaurant" autoComplete="organization" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
          </div>
          <div className="field">
            <label htmlFor="r-rules">How your team splits tips, in your own words</label>
            <textarea id="r-rules" className="textarea" name="rules" value={rules} onChange={(e) => setRules(e.target.value)} maxLength={1500} />
            <p className="help">Claude turns this into rules and reads them back. The math itself runs in code.</p>
          </div>
          <div className="field">
            <label htmlFor="r-staff">Staff, one per line (optional)</label>
            <textarea id="r-staff" className="textarea" name="staff" placeholder={"Ana, server\nBen, bartender\nDev, busser"} value={staff} onChange={(e) => setStaff(e.target.value)} />
            <p className="help">{people.length ? `${people.length} ${people.length === 1 ? "person" : "people"}. They add their own PayPal or Venmo from a link you share.` : "Or skip it: names from tonight’s board photo can join the list in one tap."}</p>
          </div>
          <p className="help help--error" role="alert">{err}</p>
          <div className="row">
            <button type="submit" className="btn btn--go btn--big" disabled={busy} aria-busy={busy}>{busy ? "Setting up…" : "Create my restaurant"}</button>
          </div>
        </form>
      </div>
      <ProblemDialog problem={problem} onClose={() => setProblem(null)} />
    </div>
  );
}
