// Claude reads; code counts. These calls only turn messy input into structured data or plain words.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

const MODEL = "claude-sonnet-5-5";

export const aiConfigured = () => !!process.env.ANTHROPIC_API_KEY;

const client = () => new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 60_000, maxRetries: 2 });

// ---- Shift board photo -> shifts ----

const BoardSchema = z.object({
  shifts: z.array(
    z.object({
      name: z.string().describe("First name or name as written"),
      role: z.string().describe("Role in lowercase, e.g. server, bartender, busser, host, kitchen, manager"),
      clockIn: z.string().describe("As written, e.g. 4:30p. Empty if not shown"),
      clockOut: z.string().describe("As written, e.g. 11p or close. Empty if not shown"),
      hours: z.number().describe("Hours worked, computed from in/out (overnight past midnight counts), or as written"),
      confidence: z.number().describe("0 to 1: how sure you are this row is read correctly"),
      note: z.string().describe("Only something the manager must double-check before paying (a smudged or ambiguous time, a name you are unsure of). Leave empty for routine clean-up like matching a role or name to the roster or reading CL as close."),
    }),
  ),
  closeTime: z.string().describe("If the board says what time 'close' was, e.g. 1:30a; else empty"),
  unreadable: z.string().describe("Shift details (names, roles, times) you could not read at all; empty if none. Ignore non-shift writing like notes, specials or ghosting."),
});
export type BoardRead = z.infer<typeof BoardSchema>;

export async function readBoard(image: { base64: string; mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" }, roster: { name: string; role: string }[]) {
  const res = await client().messages.parse({
    model: MODEL,
    max_tokens: 8000,
    output_config: { effort: "low", format: zodOutputFormat(BoardSchema) },
    system:
      "You read restaurant shift boards: whiteboards, printed schedules, handwritten sign-in sheets. Transcribe each person who worked tonight. Never invent a row. If a time is 'close', use the board's close time if written, otherwise assume 1:00a and lower confidence. Use the roster to fix spelling of names and to fill a missing role, but keep people who are not on the roster.",
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } },
          { type: "text", text: `Roster (for spelling and roles):\n${roster.map((r) => `- ${r.name} (${r.role})`).join("\n") || "(none)"}\n\nRead tonight's shifts from this board.` },
        ],
      },
    ],
  });
  if (res.stop_reason === "refusal" || !res.parsed_output) throw new Error("Couldn't read that photo. Try a straighter, closer shot.");
  return res.parsed_output;
}

// ---- House policy (plain English) -> rules ----

const RulesSchema = z.object({
  method: z.enum(["hours", "points", "hours_x_points"]).describe("hours = split by hours only; points = equal per role-point regardless of hours; hours_x_points = hours times role points (most common)"),
  rolePoints: z.array(z.object({ role: z.string(), points: z.number() })).describe("Points per role, lowercase role names"),
  offTheTop: z.array(z.object({ role: z.string(), percent: z.number() })).describe("Percent of the whole pool set aside for a role before the main split, e.g. kitchen 10"),
  excludedRoles: z.array(z.string()).describe("Roles the policy says are not in the pool"),
  summary: z.array(z.string()).describe("3-6 short plain-English bullets restating the rules so a manager can confirm them"),
  ambiguities: z.array(z.string()).describe("Anything the policy leaves unclear, phrased as a question; empty if none"),
});

export async function parsePolicy(text: string) {
  const res = await client().messages.parse({
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: "low", format: zodOutputFormat(RulesSchema) },
    system:
      "You turn a restaurant's tip-pool policy, written in plain English, into structured rules. Record what the policy says, even if it is illegal (for example including managers); the app checks legality separately. Use lowercase singular role names (server, bartender, busser, host, runner, barback, kitchen, manager). If no method is stated but roles get points, use hours_x_points. If nothing is stated, split by hours.",
    messages: [{ role: "user", content: `Policy:\n"""${text}"""` }],
  });
  if (!res.parsed_output) throw new Error("Couldn't understand that policy. Try saying who gets what share.");
  const p = res.parsed_output;
  return {
    rules: {
      method: p.method,
      rolePoints: Object.fromEntries(p.rolePoints.map((r) => [r.role.toLowerCase(), r.points])),
      offTheTop: p.offTheTop.map((t) => ({ role: t.role.toLowerCase(), percent: t.percent })),
      excludedRoles: p.excludedRoles.map((r) => r.toLowerCase()),
    },
    summary: p.summary,
    ambiguities: p.ambiguities,
  };
}

// ---- Worker dispute -> verdict ----

const DisputeSchema = z.object({
  plausible: z.boolean().describe("True if the board read or the evidence plausibly supports the worker's claim"),
  claimedHours: z.number().describe("The hours the worker says they actually worked; 0 if the claim is not about hours"),
  reply: z.string().describe("2-3 warm, plain sentences to the worker explaining what you found and what happens next. No legal advice."),
  managerNote: z.string().describe("One line for the manager: what to check"),
});

export async function reviewDispute(input: {
  message: string;
  worker: { name: string; role: string; hours: number; clockIn?: string; clockOut?: string; confidence?: number; amount: string };
  why: string[];
  board?: { base64: string; mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" };
}) {
  const content: Anthropic.ContentBlockParam[] = [];
  if (input.board) content.push({ type: "image", source: { type: "base64", media_type: input.board.mediaType, data: input.board.base64 } });
  content.push({
    type: "text",
    text: `Worker: ${input.worker.name} (${input.worker.role})
Board read: ${input.worker.clockIn ?? "?"} to ${input.worker.clockOut ?? "?"}, ${input.worker.hours}h, read confidence ${input.worker.confidence ?? "n/a"}
Paid: ${input.worker.amount}
How it was worked out:
${input.why.map((w) => `- ${w}`).join("\n")}

Their message: """${input.message}"""`,
  });
  const res = await client().messages.parse({
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: "low", format: zodOutputFormat(DisputeSchema) },
    system:
      "A restaurant worker thinks their tip-out is wrong. Check their claim against the shift board photo (if given) and the board read. Be fair to both sides: if the board is ambiguous or the read had low confidence, the claim is plausible. You never decide money; the manager approves any correction and the app does the math.",
    messages: [{ role: "user", content }],
  });
  if (!res.parsed_output) throw new Error("Couldn't check that right now.");
  return res.parsed_output;
}
