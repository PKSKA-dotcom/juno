// All GitHub Copilot calls. Copilot is each business's manager: it sets
// the business up from a sentence, reviews every call, and makes the
// owner's changes through the tools in tools.js. It never touches the
// database directly, and nothing in a call or booking waits for it.

import { CopilotClient, defineTool } from "@github/copilot-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as db from "./db.js";
import { managerTools } from "./tools.js";
import { validateProfile, describeHours, describeServices, describeFaq, ValidationError } from "./validate.js";
import { spoken, parseNaive } from "./time.js";

const MODEL = process.env.COPILOT_MODEL || "gpt-5";
const TIMEOUT_MS = 30000;

let client = null;
// Copilot runs in an empty scratch folder, never the app's own folder.
const SANDBOX = mkdtempSync(path.join(tmpdir(), "juno-copilot-"));
export function isConfigured() { return !!process.env.COPILOT_GITHUB_TOKEN; }

// One shared client; the SDK starts the Copilot runtime behind it.
async function getClient() {
  if (client) return client;
  if (!isConfigured()) throw new Error("COPILOT_GITHUB_TOKEN is not set");
  const c = new CopilotClient({ gitHubToken: process.env.COPILOT_GITHUB_TOKEN, workingDirectory: SANDBOX });
  await c.start();
  client = c;
  return c;
}

// Run one Copilot session: a system message, a prompt, optional tools. Returns the reply text and the tools it called.
export async function runCopilot({ system, prompt, tools = [], timeoutMs = TIMEOUT_MS }) {
  const c = await getClient();
  const called = [];
  const allowed = new Set(tools.map((t) => t.name));
  const wrapped = tools.map((t) => defineTool(t.name, {
    description: t.description, parameters: t.parameters,
    handler: async (args) => { called.push({ tool: t.name, args }); return t.handler(args); },
  }));
  // Two locks: only our own tools are offered, and any other request (shell, files, web) is refused.
  const onPermissionRequest = (req) => (req.kind === "custom-tool" && allowed.has(req.toolName))
    ? { kind: "approve-once" }
    : { kind: "reject", feedback: "Only Juno's own tools are allowed." };
  let session;
  try {
    session = await c.createSession({
      model: MODEL, systemMessage: { mode: "replace", content: system }, tools: wrapped,
      availableTools: tools.map((t) => `custom:${t.name}`), workingDirectory: SANDBOX,
      onPermissionRequest,
    });
    const msg = await session.sendAndWait({ prompt }, timeoutMs);
    return { text: msg?.data?.content ?? "", called };
  } catch (e) {
    client = null; // Restart the runtime on the next call.
    throw e;
  } finally {
    try { await session?.disconnect(); } catch {}
  }
}

// Pull the first JSON object out of a reply that may have prose around it.
export function extractJson(text) {
  const s = String(text || "");
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1] : s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1);
  try { return JSON.parse(candidate); } catch { return null; }
}

function profileText(b) {
  return `Business: ${b.name}\nAbout: ${b.description}\nServices: ${describeServices(b.services)}\nHours: ${describeHours(b.hours)}\nExtra questions asked of callers: ${b.extra_questions || "none"}\nFAQ: ${describeFaq(b.faq)}`;
}

// Fallbacks used when Copilot is unavailable, so a booking is never blocked.
export function fallbackReview(business, booking) {
  const when = booking?.start_time ? spoken(parseNaive(booking.start_time)) : "";
  return {
    plan_steps: booking ? [`Prepare for ${booking.service} for ${booking.group_size} on ${booking.readable_time}.`, booking.notes ? `Notes from the caller: ${booking.notes}` : "Check the caller's notes before they arrive."] : [],
    confirmation_script: booking ? `Hi ${String(booking.customer_name).split(" ")[0]}, it's Juno from ${business.name}. Your ${booking.service} is confirmed for ${when}. See you then!` : "",
    unanswered: [], insight: "",
  };
}

// 1. Review a finished call: prep notes, confirmation, unanswered questions, an insight.
export async function reviewCall(business, transcript, booking, outcome) {
  const recent = (await db.listBookings(business.id)).slice(0, 20).map((b) => `${b.status}: ${b.service} on ${b.readable_time || b.start_time}${b.notes ? ` (${b.notes})` : ""}`).join("\n") || "none yet";
  const lines = (transcript || []).map((t) => `${t.role === "agent" ? "Juno" : "Caller"}: ${t.message}`).join("\n").slice(0, 8000);
  const system = `You are the manager of a small business, reviewing a call its AI receptionist Juno just took. Reply with JSON only, no prose, no markdown fences.`;
  const prompt = `${profileText(business)}

Outcome of this call: ${outcome}
${booking ? `Booking: ${booking.service} for ${booking.group_size} on ${booking.readable_time}, customer ${booking.customer_name}, notes: ${booking.notes || "none"}` : "No booking was made."}

Recent calls at this business:
${recent}

Transcript:
${lines}

Return exactly this JSON:
{"plan_steps": [3 to 5 short prep steps for the staff, specific to this kind of business and this booking; [] if nothing was booked],
 "confirmation_script": "under 50 words, spoken by Juno to the customer by first name, with the business name and the day and date in words, no symbols; empty if nothing was booked",
 "unanswered": [{"question": "something the caller asked that the FAQ did not cover", "draft_answer": "your best guess, for the owner to check"}],
 "insight": "one sentence on a pattern the owner should act on, or empty"}`;
  const { text } = await runCopilot({ system, prompt });
  const j = extractJson(text);
  if (!j) throw new Error("Copilot returned no JSON");
  return {
    plan_steps: Array.isArray(j.plan_steps) ? j.plan_steps.map(String).slice(0, 5) : [],
    confirmation_script: String(j.confirmation_script || "").slice(0, 400),
    unanswered: Array.isArray(j.unanswered) ? j.unanswered.filter((u) => u && u.question).map((u) => ({ question: String(u.question).slice(0, 120), draft_answer: String(u.draft_answer || "").slice(0, 200) })).slice(0, 5) : [],
    insight: String(j.insight || "").slice(0, 300),
  };
}

// 2. Turn an owner's sentence into a full, validated profile draft.
export async function draftBusiness(description) {
  const system = "You set up small businesses on Juno, an AI phone receptionist. Reply with JSON only, no prose, no markdown fences.";
  const prompt = `The owner says: """${String(description).slice(0, 600)}"""

Return exactly this JSON, filling in sensible defaults for anything they didn't say:
{"name": "business name, under 60 characters",
 "description": "one or two sentences a receptionist would say about the business, under 300 characters",
 "services": [{"name": "service name", "minutes": duration as an integer, "max_group": max people per booking, "capacity": how many of this service can run at the same time}],
 "hours": {"days": [integers, 0=Sunday .. 6=Saturday], "open": "HH:MM", "close": "HH:MM"},
 "extra_questions": "one short sentence listing anything the receptionist should ask callers, or empty",
 "faq": [{"question": "a common customer question", "answer": "a short answer"}] (2 to 4 entries)}`;
  const { text } = await runCopilot({ system, prompt });
  const j = extractJson(text);
  if (!j) throw new Error("Copilot returned no JSON");
  return validateProfile(j); // Same checks as the form.
}

// 3. The manager: act on an owner's message through tools only.
export async function manage(business, message) {
  const tools = managerTools(business.id);
  const system = `You are Copilot, the manager of "${business.name}" on Juno, an AI phone receptionist service. The owner is talking to you. You can read and change ONLY this business, and ONLY through your tools: hours, services, blocked periods and FAQ apply at once; rescheduling, cancelling or messaging a customer only creates a proposal the owner approves. Today's date is ${new Date().toISOString().slice(0, 10)} (Pacific time). Times are local, written like 2026-11-21T15:00:00. Call get_profile first when you need current details. Act, then reply in one or two plain sentences saying exactly what you changed or proposed. If something can't be done, say why. Never invent data.`;
  const { text, called } = await runCopilot({ system, prompt: String(message).slice(0, 1000), tools, timeoutMs: 60000 });
  return { reply: text || "Done.", called: called.map((c) => c.tool) };
}

export { ValidationError };
