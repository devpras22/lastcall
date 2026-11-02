// Rosa's Taqueria: the demo restaurant every judge gets a fresh copy of.

export const DEMO_NAME = "Rosa's Taqueria";

export const DEMO_POLICY =
  "Servers and bartenders get 1 point an hour. Bussers, hosts and barbacks get half a point. Kitchen gets 10% of the whole pool off the top, split by hours. Marco gets a point too since he runs food on busy nights.";

type W = { name: string; role: string; wallet: "PAYPAL" | "VENMO"; recipientType: "EMAIL" | "PHONE"; receiver: string };

// Sandbox receivers. Override with DEMO_RECEIVERS (JSON array of {receiver, wallet, recipientType}) once real sandbox personal accounts exist.
export function demoWorkers(): W[] {
  const base: W[] = [
    { name: "Ana Torres", role: "server", wallet: "PAYPAL", recipientType: "EMAIL", receiver: "ana@lastcall.test" },
    { name: "Ben Okafor", role: "bartender", wallet: "VENMO", recipientType: "PHONE", receiver: "4085550101" },
    { name: "Camila Reyes", role: "server", wallet: "PAYPAL", recipientType: "EMAIL", receiver: "camila@lastcall.test" },
    { name: "Dev Patel", role: "busser", wallet: "VENMO", recipientType: "PHONE", receiver: "4085550102" },
    { name: "Eli Brooks", role: "host", wallet: "PAYPAL", recipientType: "EMAIL", receiver: "eli@lastcall.test" },
    { name: "Fatima Noor", role: "server", wallet: "PAYPAL", recipientType: "EMAIL", receiver: "fatima@lastcall.test" },
    { name: "Gus Romero", role: "kitchen", wallet: "VENMO", recipientType: "PHONE", receiver: "4085550103" },
    { name: "Hana Kim", role: "kitchen", wallet: "PAYPAL", recipientType: "EMAIL", receiver: "hana@lastcall.test" },
    { name: "Iris Chen", role: "barback", wallet: "PAYPAL", recipientType: "EMAIL", receiver: "iris@lastcall.test" },
  ];
  try {
    const override = JSON.parse(process.env.DEMO_RECEIVERS ?? "[]") as Partial<W>[];
    return base.map((w, i) => ({ ...w, ...(override[i] ?? {}) }));
  } catch {
    return base;
  }
}

// What the sample board photo says. Used only when no Anthropic key is configured.
export const DEMO_BOARD_FIXTURE = {
  closeTime: "1:30a",
  unreadable: "",
  shifts: [
    { name: "Ana", role: "server", clockIn: "4:30p", clockOut: "11:30p", hours: 7, confidence: 0.97, note: "" },
    { name: "Ben", role: "bartender", clockIn: "4p", clockOut: "close", hours: 9.5, confidence: 0.93, note: "" },
    { name: "Camila", role: "server", clockIn: "5p", clockOut: "close", hours: 8.5, confidence: 0.9, note: "" },
    { name: "Dev", role: "busser", clockIn: "5p", clockOut: "11p", hours: 6, confidence: 0.95, note: "" },
    { name: "Eli", role: "host", clockIn: "4:30p", clockOut: "10p", hours: 5.5, confidence: 0.96, note: "" },
    { name: "Fatima", role: "server", clockIn: "6p", clockOut: "12a", hours: 6, confidence: 0.62, note: "out time smudged, could be 12a or 1a" },
    { name: "Gus", role: "kitchen", clockIn: "3p", clockOut: "11p", hours: 8, confidence: 0.96, note: "" },
    { name: "Hana", role: "kitchen", clockIn: "4p", clockOut: "12a", hours: 8, confidence: 0.94, note: "" },
    { name: "Iris", role: "barback", clockIn: "7p", clockOut: "close", hours: 6.5, confidence: 0.91, note: "" },
    { name: "Marco", role: "manager", clockIn: "3p", clockOut: "close", hours: 10.5, confidence: 0.95, note: "" },
  ],
};

// Tips already in before the manager opens the app tonight.
export const DEMO_CARD_TIPS_CENTS = 118_450; // card tips from the terminal's batch report, typed in
export const DEMO_PAYPAL_TIPS = [2_000, 3_500, 1_250, 5_000]; // guest tips via PayPal QR
