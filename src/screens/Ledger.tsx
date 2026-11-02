import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef } from "ag-grid-community";
import { api } from "../../convex/_generated/api";
import { getOwnerKey } from "../lib/owner";
import { CloseOutHome } from "./CloseOut";

ModuleRegistry.registerModules([AllCommunityModule]);

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

type Row = { id: string; date: string; name: string; role: string; hours: number; points: number; pool: string; amount: number; topUp: number; perHour: number; status: string; dispute: string; receipt: string; simulated: boolean };

const usd = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD" });

export default function Ledger() {
  const ownerKey = getOwnerKey() ?? "";
  const rows = useQuery(api.ledger.rows, ownerKey ? { ownerKey } : "skip");
  const [q, setQ] = useState("");

  // AG Grid takes the page’s tokens, so the grid reads as part of the app.
  const theme = useMemo(
    () =>
      themeQuartz.withParams({
        backgroundColor: css("--color-ticket"),
        foregroundColor: css("--color-ink"),
        headerBackgroundColor: css("--color-paper-2"),
        headerTextColor: css("--color-ink-2"),
        borderColor: css("--color-rule"),
        rowHoverColor: css("--color-paper"),
        selectedRowBackgroundColor: css("--color-warn-wash"),
        accentColor: css("--color-focus"),
        fontFamily: { googleFont: "Archivo" },
        headerFontWeight: 700,
        fontSize: 14,
        wrapperBorderRadius: 6,
        spacing: 7,
      }),
    [],
  );

  const cols = useMemo<ColDef<Row>[]>(
    () => [
      { field: "date", headerName: "Night", sort: "desc", width: 120, filter: true },
      { field: "name", headerName: "Name", flex: 1, minWidth: 140, filter: true, pinned: "left" },
      { field: "role", headerName: "Role", width: 120, filter: true },
      { field: "hours", headerName: "Hours", width: 96, type: "rightAligned", cellClass: "mono" },
      { field: "amount", headerName: "Tip-out", width: 120, type: "rightAligned", cellClass: "mono", valueFormatter: (p) => usd(p.value), aggFunc: "sum" },
      { field: "topUp", headerName: "Top-ups", width: 110, type: "rightAligned", cellClass: "mono", valueFormatter: (p) => (p.value ? usd(p.value) : "") },
      { field: "perHour", headerName: "Per hour", width: 110, type: "rightAligned", cellClass: "mono", valueFormatter: (p) => (p.value ? usd(p.value) : "") },
      { field: "status", headerName: "Payout", width: 120, filter: true, valueFormatter: (p) => ({ success: "Paid", pending: "Sending", none: "Not in pool", failed: "Failed", unclaimed: "Unclaimed" })[p.value as string] ?? p.value },
      { field: "dispute", headerName: "Correction", width: 130, filter: true, valueFormatter: (p) => ({ paid: "Topped up", proposed: "Needs OK", declined: "Closed", checking: "Checking", approved: "Sending" })[p.value as string] ?? "" },
    ],
    [],
  );

  if (!ownerKey) return <CloseOutHome />;
  const total = (rows ?? []).reduce((a, r) => a + r.amount + r.topUp, 0);
  const people = new Set((rows ?? []).filter((r) => r.amount > 0).map((r) => r.name)).size;

  return (
    <div className="container page">
      <div className="ledger-bar">
        <div>
          <h1>Ledger</h1>
          <p className="muted" style={{ marginTop: "var(--space-xs)" }}>
            {rows === undefined ? "Loading…" : rows.length === 0 ? "Nothing paid out yet." : <>Every tip-out, every night. <span className="mono">{usd(total)}</span> to {people} people.</>}
          </p>
        </div>
        <div className="field">
          <label htmlFor="ledger-q">Find a name, role or night</label>
          <input id="ledger-q" className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
        </div>
      </div>
      <div className="ledger">
        <AgGridReact<Row> theme={theme} rowData={rows ?? []} columnDefs={cols} quickFilterText={q} loading={rows === undefined}
          overlayNoRowsTemplate="<span>Pay out a night and every share lands here.</span>" getRowId={(p) => p.data.id} animateRows />
      </div>
    </div>
  );
}
