import { hrs, money } from "../lib/owner";
import { Check, Spinner, Alert } from "./icons";

export type PayoutStatus = "none" | "pending" | "success" | "unclaimed" | "failed";

export function StatusText({ status, wallet }: { status: PayoutStatus; wallet?: string | null }) {
  const to = wallet === "VENMO" ? "Venmo" : "PayPal";
  if (status === "success") return <span className="status status--success"><Check />Paid to {to}</span>;
  if (status === "pending") return <span className="status status--pending" role="status"><Spinner />Sending to {to}</span>;
  if (status === "unclaimed") return <span className="status status--unclaimed"><Alert />Waiting to be claimed</span>;
  if (status === "failed") return <span className="status status--failed"><Alert />Didn’t go through</span>;
  return <span className="status status--pending">Not in the pool</span>;
}

export function Ticket(props: {
  name: string;
  role: string;
  hours: number;
  points?: number;
  amountCents: number;
  clockIn?: string;
  clockOut?: string;
  why?: string[];
  flag?: "error" | "warn";
  status?: PayoutStatus;
  wallet?: string | null;
  children?: React.ReactNode;
  showWhy?: boolean;
}) {
  const zero = props.amountCents === 0;
  return (
    <article className="ticket" data-zero={zero} data-flag={props.flag} data-status={props.status} aria-label={`${props.name}, ${money(props.amountCents)}`}>
      <div className="ticket__top">
        <h3 className="ticket__name">{props.name}</h3>
        <span className="ticket__amt money">{money(props.amountCents)}</span>
      </div>
      <div className="ticket__meta">
        <span>{props.role}</span>
        <span>
          {props.clockIn && props.clockOut ? `${props.clockIn} to ${props.clockOut}, ` : ""}
          {hrs(props.hours)}
        </span>
      </div>
      {props.status && <StatusText status={props.status} wallet={props.wallet} />}
      {props.showWhy && props.why && props.why.length > 0 && (
        <>
          <hr className="ticket__cut" />
          <ul className="ticket__why">
            {props.why.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </>
      )}
      {props.children}
    </article>
  );
}

export function TicketSkeleton() {
  return (
    <div className="ticket ticket--skel" aria-hidden="true">
      <span className="skel" style={{ width: "55%", height: 18 }} />
      <span className="skel" style={{ width: "35%", height: 14 }} />
      <span className="skel" style={{ width: "80%", height: 12 }} />
    </div>
  );
}
