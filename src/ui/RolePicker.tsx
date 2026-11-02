import { useId, useRef, useState } from "react";

const ROLES = ["server", "bartender", "busser", "host", "runner", "barback", "kitchen"];

/**
 * Role as a set of pills, not a dropdown or free text: one tap on a phone, and no typos that
 * the house rules wouldn't recognise. "Other" opens a short text field for anything else.
 * Keyboard: a radio group, arrow keys move between pills.
 */
export function RolePicker({ value, onChange, label = "Role", withManager = false, compact = false }: {
  value: string;
  onChange: (role: string) => void;
  label?: string;
  withManager?: boolean;
  compact?: boolean;
}) {
  const id = useId();
  const roles = withManager ? [...ROLES, "manager"] : ROLES;
  const isOther = !!value && !roles.includes(value);
  const [other, setOther] = useState(isOther);
  const otherRef = useRef<HTMLInputElement>(null);
  const options = [...roles, "other"];
  const current = other ? "other" : value;

  function pick(r: string) {
    if (r === "other") {
      setOther(true);
      if (!isOther) onChange("");
      requestAnimationFrame(() => otherRef.current?.focus());
    } else {
      setOther(false);
      onChange(r);
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLDivElement>) {
    const i = options.indexOf(current);
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = options[(Math.max(0, i) + step + options.length) % options.length];
    pick(next);
    (e.currentTarget.querySelector(`[data-role="${next}"]`) as HTMLElement | null)?.focus();
  }

  return (
    <div className="field">
      <span className="label" id={`${id}-l`}>{label}</span>
      <div className={`pills${compact ? " pills--compact" : ""}`} role="radiogroup" aria-labelledby={`${id}-l`} onKeyDown={onKey}>
        {options.map((r) => {
          const on = current === r;
          return (
            <button key={r} type="button" role="radio" aria-checked={on} tabIndex={on || (!current && r === options[0]) ? 0 : -1}
              data-role={r} className="pill" onClick={() => pick(r)}>
              {r === "other" ? "Other…" : r}
            </button>
          );
        })}
      </div>
      {other && (
        <input ref={otherRef} className="input" aria-label="Other role" placeholder="e.g. sommelier" value={isOther ? value : ""}
          maxLength={30} onChange={(e) => onChange(e.target.value.toLowerCase())} style={{ marginTop: "var(--space-xs)" }} />
      )}
    </div>
  );
}
