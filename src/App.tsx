import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { onLinkClick, usePath } from "./lib/router";
import { getOwnerKey } from "./lib/owner";
import { Logo } from "./ui/icons";
import Landing from "./screens/Landing";
import CloseOut, { CloseOutHome } from "./screens/CloseOut";
import Wall from "./screens/Wall";
import Receipt from "./screens/Receipt";
import Ledger from "./screens/Ledger";
import Tip from "./screens/Tip";
import { ScreenBoundary } from "./ui/Problem";
import type { Id } from "../convex/_generated/dataModel";

export default function App() {
  const path = usePath();
  const seg = path.split("/").filter(Boolean);

  // Worker and guest pages stand alone on a phone: no manager chrome.
  if (seg[0] === "r" && seg[1]) return <ScreenBoundary><Receipt token={seg[1]} /></ScreenBoundary>;
  if (seg[0] === "tip" && seg[1]) return <ScreenBoundary><Tip slug={seg[1]} /></ScreenBoundary>;

  let screen: React.ReactNode;
  let current = "";
  if (seg[0] === "close" && seg[1]) { screen = <CloseOut nightId={seg[1] as Id<"nights">} />; current = "close"; }
  else if (seg[0] === "close") { screen = <CloseOutHome />; current = "close"; }
  else if (seg[0] === "wall" && seg[1]) { screen = <Wall nightId={seg[1] as Id<"nights">} />; current = "wall"; }
  else if (seg[0] === "ledger") { screen = <Ledger />; current = "ledger"; }
  else screen = <Landing />;

  return (
    <>
      <Shell current={current} />
      <main><ScreenBoundary key={current + path}>{screen}</ScreenBoundary></main>
    </>
  );
}

function Shell({ current }: { current: string }) {
  const ownerKey = getOwnerKey();
  const mine = useQuery(api.restaurants.mine, ownerKey ? { ownerKey } : "skip");
  const latest = mine?.nights[0];
  return (
    <header className="shell">
      <div className="container shell__in">
        <a className="wordmark" href="/" onClick={onLinkClick} aria-label="Last Call home">
          <Logo />
          Last Call
        </a>
        {mine && <span className="shell__place">{mine.restaurant.name}</span>}
        {mine && (
          <nav className="shell__nav" aria-label="Manager">
            <a href={latest ? `/close/${latest._id}` : "/close"} onClick={onLinkClick} aria-current={current === "close" ? "page" : undefined}>Tonight</a>
            {latest && (latest.status === "paying" || latest.status === "paid") && (
              <a href={`/wall/${latest._id}`} onClick={onLinkClick} aria-current={current === "wall" ? "page" : undefined}>Payout wall</a>
            )}
            <a href="/ledger" onClick={onLinkClick} aria-current={current === "ledger" ? "page" : undefined}>Ledger</a>
          </nav>
        )}
      </div>
    </header>
  );
}
