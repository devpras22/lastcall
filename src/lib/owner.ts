// The manager's browser holds the restaurant's owner key. No accounts in the demo.
const KEY = "lastcall.ownerKey";

export function getOwnerKey(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setOwnerKey(k: string) {
  try {
    localStorage.setItem(KEY, k);
  } catch {
    /* private mode: the key lives only in this tab's URL flow */
  }
}

export const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

export const hrs = (h: number) => (Number.isInteger(h) ? `${h}h` : `${h.toFixed(2).replace(/0$/, "")}h`);

export function errText(e: unknown) {
  const d = (e as { data?: unknown })?.data;
  if (typeof d === "string") return d;
  if (e instanceof Error) return e.message.replace(/^.*Uncaught (ConvexError: )?/, "").split("\n")[0];
  return "Something went wrong. Try again.";
}
