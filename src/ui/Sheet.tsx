import { useEffect, useRef, useState } from "react";

/** Bottom sheet with a grab handle: drag down (or press Escape) to dismiss. */
export function Sheet({ open, onClose, label, children }: { open: boolean; onClose: () => void; label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const start = useRef<number | null>(null);
  const [drag, setDrag] = useState(0);
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (open) {
      setMounted(true);
      const r = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(r);
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), 300);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open || !mounted) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("textarea, input, button:not(.sheet__grab)")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prev?.focus(); };
  }, [open, mounted]);

  if (!mounted) return null;

  const down = (e: React.PointerEvent) => { start.current = e.clientY; (e.target as Element).setPointerCapture(e.pointerId); };
  const move = (e: React.PointerEvent) => { if (start.current !== null) setDrag(Math.max(0, e.clientY - start.current)); };
  const up = () => {
    if (start.current === null) return;
    const h = ref.current?.offsetHeight ?? 400;
    start.current = null;
    if (drag > Math.min(140, h * 0.3)) onClose();
    setDrag(0);
  };

  return (
    <>
      <div className="scrim" data-open={shown} onClick={onClose} />
      <div ref={ref} className="sheet" role="dialog" aria-modal="true" aria-label={label} data-open={shown} data-dragging={start.current !== null}
        style={{ "--drag": `${drag}px` } as React.CSSProperties}>
        <button type="button" className="sheet__grab" aria-label="Close" onClick={onClose}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
        {children}
      </div>
    </>
  );
}
