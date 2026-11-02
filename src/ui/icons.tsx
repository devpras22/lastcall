// Line icons, 16px grid, stroke follows currentColor.
type P = { title?: string };
const svg = (d: React.ReactNode) => ({ title }: P) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? "img" : undefined}>
    {title && <title>{title}</title>}
    {d}
  </svg>
);

export const Check = svg(<path d="M3.5 8.5l3 3 6-7" />);
export const Alert = svg(<><path d="M8 2.5l6 11H2z" /><path d="M8 7v3M8 12v.01" /></>);
export const Info = svg(<><circle cx="8" cy="8" r="6" /><path d="M8 7.5v3.5M8 5v.01" /></>);
export const Camera = svg(<><path d="M2.5 5.5h2l1.2-2h4.6l1.2 2h2v7h-11z" /><circle cx="8" cy="9" r="2.3" /></>);
export const Spinner = ({ title }: P) => (
  <svg className="spin" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden={title ? undefined : true}>
    <path d="M8 2a6 6 0 1 1-6 6" />
  </svg>
);
export const Cross = svg(<path d="M4 4l8 8M12 4l-8 8" />);
export const Arrow = svg(<path d="M3 8h10M9 4l4 4-4 4" />);
export const Logo = () => (
  <svg viewBox="0 0 32 32" aria-hidden="true">
    <rect width="32" height="32" rx="7" fill="var(--color-ink)" />
    <path d="M9 7h14v16l-2.3-1.6L18.3 23 16 21.4 13.7 23l-2.4-1.6L9 23z" fill="var(--color-ticket)" />
    <rect x="12" y="11" width="8" height="2" fill="var(--color-accent)" />
    <rect x="12" y="15" width="5" height="2" fill="var(--color-ink)" />
  </svg>
);
