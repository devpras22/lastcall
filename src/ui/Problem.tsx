import { Component, useEffect, useRef, useState } from "react";
import { Alert, Info } from "./icons";

export type Problem = { kind: string; title: string; message: string; detail?: string; retry: boolean };

/** Any thrown error from a Convex call or fetch, as a Problem the pop-up can show. */
export function toProblem(e: unknown): Problem {
  const data = (e as { data?: unknown })?.data;
  if (data && typeof data === "object" && "title" in data && "message" in data) return data as Problem;
  if (typeof data === "string") return { kind: "input", title: "That didn’t go through", message: data, retry: false };
  const msg = e instanceof Error ? e.message : String(e ?? "");
  if (/fetch|network|connection|offline|Failed to fetch|timed? ?out/i.test(msg))
    return { kind: "network", title: "Lost the connection", message: "This device couldn’t reach Last Call’s server. Check the Wi-Fi or signal and try again. Nothing was sent.", retry: true };
  return { kind: "unknown", title: "Something went wrong", message: "That didn’t work, and it’s on our side. Try again; if it keeps happening, start a fresh demo night from the home page.", detail: msg.split("\n")[0].slice(0, 160) || undefined, retry: true };
}

/** True when the error is a plain input message the form shows inline, not a pop-up. */
export const isInputProblem = (p: Problem) => p.kind === "input";

/**
 * The pop-up. Opens whenever `problem` changes to a new one; Escape, the backdrop or Close dismiss it.
 * `onRetry` appears only when the problem says trying again can help.
 */
export function ProblemDialog({ problem, onClose, onRetry }: { problem: Problem | null; onClose: () => void; onRetry?: () => Promise<unknown> | void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (problem && !d.open) d.showModal();
    if (!problem && d.open) d.close();
  }, [problem]);

  return (
    <dialog ref={ref} className="problem" aria-labelledby="problem-title" aria-describedby="problem-msg"
      onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      {problem && (
        <div className="problem__card">
          <div className="problem__icon" data-kind={problem.retry ? "temp" : "stop"}>{problem.retry ? <Info /> : <Alert />}</div>
          <h2 id="problem-title">{problem.title}</h2>
          <p id="problem-msg">{problem.message}</p>
          {problem.detail && <p className="problem__detail mono">{problem.detail}</p>}
          <div className="problem__actions">
            {problem.retry && onRetry && (
              <button type="button" className="btn btn--go" disabled={busy} aria-busy={busy} autoFocus
                onClick={async () => { setBusy(true); try { await onRetry(); onClose(); } catch { /* the next problem replaces this one */ } finally { setBusy(false); } }}>
                {busy ? "Trying again…" : "Try again"}
              </button>
            )}
            <button type="button" className="btn" onClick={onClose} autoFocus={!(problem.retry && onRetry)}>Close</button>
          </div>
        </div>
      )}
    </dialog>
  );
}

/** For problems saved on a record (board read, payout batch…): pops once per new problem, stays dismissed until it changes. */
export function useStoredProblem(problem: Problem | undefined | null, scope: string) {
  const key = problem ? `${scope}:${problem.kind}:${problem.title}:${problem.detail ?? ""}` : "";
  const [dismissed, setDismissed] = useState("");
  return { open: problem && key !== dismissed ? problem : null, dismiss: () => setDismissed(key) };
}

/** Catches a crashed screen so a judge sees an explanation, not a white page. */
export class ScreenBoundary extends Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: unknown) { console.error("screen crashed", e); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="container page">
        <div className="problem__card problem__card--page">
          <div className="problem__icon" data-kind="stop"><Alert /></div>
          <h1 style={{ fontSize: "var(--text-2xl)" }}>This screen hit a snag</h1>
          <p>Something unexpected broke while drawing this page. No money moved because of it. Reloading usually fixes it.</p>
          <div className="problem__actions">
            <button type="button" className="btn btn--go" onClick={() => location.reload()}>Reload</button>
            <a className="btn" href="/">Back to the start</a>
          </div>
        </div>
      </div>
    );
  }
}
