// The tools Copilot uses to manage ONE business. Every tool is bound to a
// business id when built, runs the same validation as the sign-up form,
// logs changes so they can be undone, and never touches a customer
// directly: reschedule, cancel and notify only create pending actions
// that the owner must approve. Copilot has no other way to change data.

import * as db from "./db.js";
import { checkAvailability } from "./availability.js";
import { validateHours, validateService, validateServices, validateFaq, ValidationError, LIMITS, describeHours } from "./validate.js";
import { parseNaive, formatNaive, readable } from "./time.js";

const PROFILE_FIELDS = ["name", "description", "services", "hours", "extra_questions", "faq"];

function snapshot(b) { return Object.fromEntries(PROFILE_FIELDS.map((k) => [k, b[k]])); }

// Apply a profile patch and record it as an undoable change.
async function applyChange(businessId, actor, description, patch) {
  const before = await db.getBusinessById(businessId);
  const after = await db.updateBusiness(businessId, patch);
  await db.createChange({ business_id: businessId, actor, kind: "profile", description, before: snapshot(before), after: snapshot(after), undone: false, undoable: true });
  return after;
}

// Put a change's "before" state back and mark it undone.
export async function undoChange(businessId, changeId) {
  const c = await db.getChange(changeId);
  if (!c || c.business_id !== businessId || c.undone || !c.undoable) return null;
  if (c.kind === "block") await db.deleteBlock(c.block_id, businessId);
  else if (c.kind === "unblock") await db.createBlock({ ...c.before.block, business_id: businessId });
  else await db.updateBusiness(businessId, c.before);
  return db.updateChange(changeId, { undone: true });
}

function ok(message, extra = {}) { return { ok: true, message, ...extra }; }

// Tool definitions as plain objects: {name, description, parameters (JSON schema), handler}.
// copilot.js wraps them with the SDK's defineTool; tests call the handlers directly.
export function managerTools(businessId, { actor = "copilot" } = {}) {
  const load = async () => {
    const b = await db.getBusinessById(businessId);
    if (!b) throw new ValidationError("Business not found.");
    return b;
  };
  const ownBooking = async (id) => {
    const bk = await db.getBooking(id);
    if (!bk || bk.business_id !== businessId) throw new ValidationError("No booking with that id at this business.");
    return bk;
  };
  const pending = async (tool, args, description) => {
    const p = await db.createPendingAction({ business_id: businessId, tool, args, description, status: "pending" });
    return ok(`Proposed for the owner to approve: ${description}`, { pending_action_id: p.id, requires_approval: true });
  };

  const tools = [
    {
      name: "get_profile", description: "Read this business's name, description, services, hours, extra questions and FAQ.",
      parameters: { type: "object", properties: {} },
      handler: async () => { const b = await load(); return { ...snapshot(b), blocks: await db.listBlocks(businessId) }; },
    },
    {
      name: "list_bookings", description: "List this business's bookings, newest first, with ids, status and times.",
      parameters: { type: "object", properties: { status: { type: "string", description: "Optional: confirmed, needs_attention, cancelled or missed" } } },
      handler: async ({ status } = {}) => (await db.listBookings(businessId)).filter((b) => !status || b.status === status).slice(0, 50)
        .map((b) => ({ id: b.id, status: b.status, service: b.service, customer_name: b.customer_name, group_size: b.group_size, start_time: b.start_time, readable_time: b.readable_time, notes: b.notes })),
    },
    {
      name: "update_hours", description: "Set opening days (0=Sunday..6=Saturday) and opening/closing times (HH:MM, 24-hour).",
      parameters: { type: "object", required: ["days", "open", "close"], properties: { days: { type: "array", items: { type: "integer" } }, open: { type: "string" }, close: { type: "string" } } },
      handler: async (args) => { const hours = validateHours(args); await applyChange(businessId, actor, `Hours set to ${describeHours(hours)}`, { hours }); return ok("Hours updated.", { hours }); },
    },
    {
      name: "add_service", description: "Add a bookable service with its duration in minutes, max group size and capacity (how many can run at once).",
      parameters: { type: "object", required: ["name", "minutes"], properties: { name: { type: "string" }, minutes: { type: "integer" }, max_group: { type: "integer" }, capacity: { type: "integer" } } },
      handler: async (args) => {
        const b = await load(); const s = validateService(args);
        const services = validateServices([...b.services, s]);
        await applyChange(businessId, actor, `Added service "${s.name}" (${s.minutes} min)`, { services });
        return ok(`Added ${s.name}.`, { services });
      },
    },
    {
      name: "update_service", description: "Change an existing service's duration, max group, capacity or name.",
      parameters: { type: "object", required: ["name"], properties: { name: { type: "string" }, new_name: { type: "string" }, minutes: { type: "integer" }, max_group: { type: "integer" }, capacity: { type: "integer" } } },
      handler: async ({ name, new_name, ...rest }) => {
        const b = await load(); const i = b.services.findIndex((s) => s.name.toLowerCase() === String(name).toLowerCase());
        if (i < 0) throw new ValidationError(`No service called "${name}".`);
        const updated = validateService({ ...b.services[i], ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v != null)), name: new_name || b.services[i].name });
        const services = validateServices(b.services.map((s, j) => (j === i ? updated : s)));
        await applyChange(businessId, actor, `Updated service "${updated.name}"`, { services });
        return ok(`Updated ${updated.name}.`, { services });
      },
    },
    {
      name: "remove_service", description: "Remove a service so it can no longer be booked.",
      parameters: { type: "object", required: ["name"], properties: { name: { type: "string" } } },
      handler: async ({ name }) => {
        const b = await load(); const services = b.services.filter((s) => s.name.toLowerCase() !== String(name).toLowerCase());
        if (services.length === b.services.length) throw new ValidationError(`No service called "${name}".`);
        validateServices(services);
        await applyChange(businessId, actor, `Removed service "${name}"`, { services });
        return ok(`Removed ${name}.`, { services });
      },
    },
    {
      name: "block_time", description: "Close the business for a period, e.g. a holiday or private event. Times are local, like 2026-11-21T00:00:00.",
      parameters: { type: "object", required: ["start", "end"], properties: { start: { type: "string" }, end: { type: "string" }, reason: { type: "string" } } },
      handler: async ({ start, end, reason }) => {
        const s = parseNaive(start), e = parseNaive(end);
        if (!s || !e || e <= s) throw new ValidationError("Give a start and an end, with the end after the start.");
        const r = String(reason || "").trim().slice(0, LIMITS.reason);
        const block = await db.createBlock({ business_id: businessId, start: formatNaive(s), end: formatNaive(e), reason: r });
        await db.createChange({ business_id: businessId, actor, kind: "block", description: `Closed ${readable(s)} to ${readable(e)}${r ? ` (${r})` : ""}`, before: {}, after: { block }, undone: false, undoable: true, block_id: block.id });
        return ok(`Blocked ${readable(s)} to ${readable(e)}.`, { block_id: block.id });
      },
    },
    {
      name: "unblock_time", description: "Remove a blocked period by its id (see get_profile).",
      parameters: { type: "object", required: ["block_id"], properties: { block_id: { type: "string" } } },
      handler: async ({ block_id }) => {
        const block = (await db.listBlocks(businessId)).find((b) => b.id === block_id);
        if (!block || !(await db.deleteBlock(block_id, businessId))) throw new ValidationError("No block with that id at this business.");
        await db.createChange({ business_id: businessId, actor, kind: "unblock", description: `Reopened ${readable(parseNaive(block.start))} to ${readable(parseNaive(block.end))}`, before: { block }, after: {}, undone: false, undoable: true });
        return ok("Block removed.");
      },
    },
    {
      name: "update_faq", description: "Add or replace an FAQ answer Juno can give callers. Pass an empty answer to remove the question.",
      parameters: { type: "object", required: ["question", "answer"], properties: { question: { type: "string" }, answer: { type: "string" } } },
      handler: async ({ question, answer }) => {
        const b = await load(); const q = String(question || "").trim();
        let faq = (b.faq || []).filter((f) => f.question.toLowerCase() !== q.toLowerCase());
        if (String(answer || "").trim()) faq.push({ question: q, answer });
        faq = validateFaq(faq);
        await applyChange(businessId, actor, String(answer || "").trim() ? `FAQ: "${q}"` : `Removed FAQ "${q}"`, { faq });
        return ok("FAQ updated.", { faq });
      },
    },
    {
      name: "reschedule_booking", description: "Propose moving a booking to a new time. The owner must approve before the customer is told.",
      parameters: { type: "object", required: ["booking_id", "start_time"], properties: { booking_id: { type: "string" }, start_time: { type: "string", description: "New start, local, like 2026-11-21T15:00:00" } } },
      handler: async ({ booking_id, start_time }) => {
        const bk = await ownBooking(booking_id); const b = await load();
        const others = (await db.listBookings(businessId)).filter((x) => x.id !== bk.id);
        const check = checkAvailability(b, others, await db.listBlocks(businessId), { service: bk.service, start_time, group_size: bk.group_size });
        if (!check.available) throw new ValidationError(`That time isn't available: ${check.reason} Alternatives: ${check.alternatives.join(", ") || "none"}`);
        return pending("reschedule_booking", { booking_id, start_time: check.start_time, end_time: check.end_time, readable_time: check.readable_time }, `Move ${bk.customer_name}'s ${bk.service} from ${bk.readable_time} to ${check.readable_time}`);
      },
    },
    {
      name: "cancel_booking", description: "Propose cancelling a booking. The owner must approve before the customer is told.",
      parameters: { type: "object", required: ["booking_id"], properties: { booking_id: { type: "string" }, reason: { type: "string" } } },
      handler: async ({ booking_id, reason }) => {
        const bk = await ownBooking(booking_id);
        return pending("cancel_booking", { booking_id, reason: String(reason || "").slice(0, 200) }, `Cancel ${bk.customer_name}'s ${bk.service} on ${bk.readable_time}`);
      },
    },
    {
      name: "notify_customer", description: "Propose emailing a booking's customer a message. The owner must approve before it is sent.",
      parameters: { type: "object", required: ["booking_id", "message"], properties: { booking_id: { type: "string" }, message: { type: "string" } } },
      handler: async ({ booking_id, message }) => {
        const bk = await ownBooking(booking_id);
        const m = String(message || "").trim().slice(0, 500);
        if (!m) throw new ValidationError("Message is empty.");
        return pending("notify_customer", { booking_id, message: m }, `Email ${bk.customer_name}: "${m.slice(0, 60)}${m.length > 60 ? "..." : ""}"`);
      },
    },
  ];

  // Wrap every handler so a validation error becomes a message Copilot can read, not a crash.
  return tools.map((t) => ({ ...t, handler: async (args) => { try { return await t.handler(args || {}); } catch (e) { if (e instanceof ValidationError) return { ok: false, error: e.message }; throw e; } } }));
}
