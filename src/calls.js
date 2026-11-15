// What happens when a call ends. ElevenLabs sends the post-call webhook;
// server.js checks the signature and hands the parsed payload to
// processCall. The booking is saved before any slow step, then Copilot
// reviews the call, Juno's voice confirmation is recorded, and Make
// delivers the calendar event and emails.

import { randomBytes } from "node:crypto";
import * as db from "./db.js";
import { checkAvailability } from "./availability.js";
import { sendToMake, sendEmail } from "./delivery.js";
import { makeVoiceMessage } from "./elevenlabs.js";
import * as copilot from "./copilot.js";
import { dateKey } from "./time.js";

const PHONE_LIMIT_PER_DAY = 3;

// data_collection_results values arrive as {value: ...}; accept plain values too.
function field(results, name) {
  const v = results?.[name];
  if (v && typeof v === "object" && "value" in v) return v.value;
  return v;
}

function clean(s, max = 200) { return s == null ? "" : String(s).replace(/\s+/g, " ").trim().slice(0, max); }

// Pull the booking fields out of the webhook payload.
export function extractCall(payload) {
  const data = payload?.data || {};
  const r = data.analysis?.data_collection_results || {};
  const vars = data.conversation_initiation_client_data?.dynamic_variables || {};
  const confirmed = field(r, "booking_confirmed");
  return {
    conversation_id: clean(data.conversation_id, 100),
    business_id: clean(vars.business_id, 100),
    customer_name: clean(field(r, "customer_name"), 80),
    customer_email: clean(field(r, "customer_email"), 120).toLowerCase().replace(/\s/g, ""),
    customer_phone: clean(field(r, "customer_phone"), 30).replace(/[^\d+]/g, ""),
    service: clean(field(r, "service"), 60),
    group_size: Math.max(1, parseInt(field(r, "group_size"), 10) || 1),
    start_time: clean(field(r, "start_time"), 30),
    notes: clean(field(r, "notes"), 400),
    booking_confirmed: confirmed === true || String(confirmed).toLowerCase() === "true",
    transcript_summary: clean(data.analysis?.transcript_summary, 1500),
    transcript: Array.isArray(data.transcript) ? data.transcript : [],
  };
}

// Save Copilot's unanswered questions and insight as suggestions for the owner (skipping repeats).
async function saveSuggestions(business, review) {
  const existing = (await db.listSuggestions(business.id)).filter((s) => s.status === "pending");
  const faqQs = new Set((business.faq || []).map((f) => f.question.toLowerCase()));
  for (const u of review.unanswered || []) {
    const q = u.question.toLowerCase();
    if (faqQs.has(q) || existing.some((s) => s.kind === "faq" && s.question.toLowerCase() === q)) continue;
    await db.createSuggestion({ business_id: business.id, kind: "faq", question: u.question, draft_answer: u.draft_answer, status: "pending" });
  }
  if (review.insight && !existing.some((s) => s.kind === "insight" && s.text === review.insight)) {
    await db.createSuggestion({ business_id: business.id, kind: "insight", text: review.insight, status: "pending" });
  }
}

// Ask Copilot to review the call; fall back to a plain review if it's unavailable.
async function review(business, call, booking, outcome) {
  if (!copilot.isConfigured()) return { ...copilot.fallbackReview(business, booking), copilot: false };
  try {
    const r = await copilot.reviewCall(business, call.transcript, booking, outcome);
    if (booking && !r.confirmation_script) r.confirmation_script = copilot.fallbackReview(business, booking).confirmation_script;
    return { ...r, copilot: true };
  } catch (e) {
    console.warn("copilot review failed:", e.message);
    return { ...copilot.fallbackReview(business, booking), copilot: false, copilot_error: true };
  }
}

// The slow part, run after the booking is saved: review, voice, delivery.
async function finishConfirmed(business, booking, call) {
  const r = await review(business, call, booking, "confirmed booking");
  await saveSuggestions(business, r);
  const voice_url = await makeVoiceMessage(r.confirmation_script, booking.id);
  const cancel_token = randomBytes(16).toString("hex");
  booking = await db.updateBooking(booking.id, { plan_steps: r.plan_steps, confirmation_script: r.confirmation_script, voice_url, cancel_token, reviewed_by_copilot: r.copilot });
  const base = process.env.PUBLIC_URL || "";
  const sent = await sendToMake({
    type: "booking",
    business_name: business.name, owner_email: business.owner_email,
    customer_name: booking.customer_name, customer_email: booking.customer_email, customer_phone: booking.customer_phone,
    service: booking.service, group_size: booking.group_size, start_time: booking.start_time, end_time: booking.end_time,
    readable_time: booking.readable_time, notes: booking.notes,
    plan_title: `Prep notes for ${booking.service}`, plan_steps: (r.plan_steps || []).map((s) => `- ${s}`).join("\n"),
    confirmation_script: r.confirmation_script, voice_url, cancel_url: `${base}/cancel/${cancel_token}`,
    manage_url: `${base}/b/${business.slug}/manage?key=${business.owner_key}`,
    transcript_summary: booking.transcript_summary, conversation_id: booking.conversation_id,
  });
  // Ready-written emails too, so confirmations go out even before a calendar step exists in Make.
  const people = `${booking.group_size} ${Number(booking.group_size) === 1 ? "person" : "people"}`;
  if (booking.customer_email) await sendEmail({ to: booking.customer_email, subject: `You're booked: ${booking.service} at ${business.name}`,
    body: `Hi ${booking.customer_name},\n\nYou're booked for ${booking.service} (${people}) on ${booking.readable_time}.\n\n${voice_url ? `Hear your confirmation from Juno: ${voice_url}\n\n` : ""}Need to cancel? ${base}/cancel/${cancel_token}\n\nSee you soon,\n${business.name}` });
  if (business.owner_email) await sendEmail({ to: business.owner_email, subject: `New booking: ${booking.customer_name}, ${booking.service}, ${booking.readable_time}`,
    body: `${booking.customer_name} booked ${booking.service} for ${people} on ${booking.readable_time}.\n\nPhone: ${booking.customer_phone || "not given"}\nEmail: ${booking.customer_email}\nNotes: ${booking.notes || "none"}\n\nCopilot's prep notes:\n${(r.plan_steps || []).map((x) => `- ${x}`).join("\n") || "- none"}\n\nManage bookings: ${base}/b/${business.slug}/manage?key=${business.owner_key}` });
  return db.updateBooking(booking.id, { forwarded: sent });
}

// Main entry. Returns {status, booking, done} where `done` resolves when the slow work finishes.
export async function processCall(payload) {
  if (payload?.type !== "post_call_transcription") return { status: "ignored" };
  const call = extractCall(payload);
  if (!call.conversation_id) return { status: "ignored" };
  if (await db.getBookingByConversation(call.conversation_id)) return { status: "duplicate" };
  const business = await db.getBusinessById(call.business_id);
  if (!business) { console.warn("call for unknown business", call.business_id); return { status: "unknown_business" }; }

  const base = {
    business_id: business.id, conversation_id: call.conversation_id,
    customer_name: call.customer_name, customer_email: call.customer_email, customer_phone: call.customer_phone,
    service: call.service, group_size: call.group_size, start_time: call.start_time, notes: call.notes,
    transcript_summary: call.transcript_summary, forwarded: false,
  };
  const manageUrl = `${process.env.PUBLIC_URL || ""}/b/${business.slug}/manage?key=${business.owner_key}`;

  // 1. No confirmed booking: a missed call. Tell the owner if we have a number to call back.
  if (!call.booking_confirmed || !call.customer_email) {
    const booking = await db.saveBooking({ ...base, status: "missed" });
    if (!booking) return { status: "duplicate" };
    const done = (async () => {
      if (call.customer_phone) {
        await sendEmail({ to: business.owner_email, subject: `Missed booking at ${business.name}: please call back`,
          body: `Juno spoke with ${call.customer_name || "a caller"} (${call.customer_phone}) but the booking wasn't completed.\n\nWhat they wanted: ${call.service || "not stated"}${call.start_time ? ` around ${call.start_time}` : ""}.\n\nCall summary: ${call.transcript_summary || "none"}\n\nYour Juno page: ${manageUrl}` });
      }
      await saveSuggestions(business, await review(business, call, null, "no booking was made"));
    })().catch((e) => console.error("missed-call follow-up failed:", e));
    return { status: "missed", booking, done };
  }

  // 2. Re-check the slot and the per-phone limit before confirming.
  const [bookings, blocks] = await Promise.all([db.listBookings(business.id), db.listBlocks(business.id)]);
  const check = checkAvailability(business, bookings, blocks, { service: call.service, start_time: call.start_time, group_size: call.group_size });
  const phoneCount = await db.countBookingsByPhoneToday(business.id, call.customer_phone, dateKey(new Date()));
  let problem = null;
  if (!check.available) problem = check.reason;
  else if (phoneCount >= PHONE_LIMIT_PER_DAY) problem = `This phone number already has ${phoneCount} bookings here today.`;

  const timing = check.start_time ? { service: check.service, start_time: check.start_time, end_time: check.end_time, readable_time: check.readable_time } : {};
  const booking = await db.saveBooking({ ...base, ...timing, status: problem ? "needs_attention" : "confirmed", problem: problem || "" });
  if (!booking) return { status: "duplicate" };

  if (problem) {
    const done = sendEmail({ to: business.owner_email, subject: `Booking needs your attention at ${business.name}`,
      body: `Juno took a booking that the server couldn't confirm: ${problem}\n\n${call.customer_name} (${call.customer_email}, ${call.customer_phone}) wanted ${call.service} for ${call.group_size} at ${call.start_time}.\n\nPlease contact them. Your Juno page: ${manageUrl}` })
      .then(async (sent) => db.updateBooking(booking.id, { forwarded: sent }))
      .catch((e) => console.error("needs-attention email failed:", e));
    return { status: "needs_attention", booking, done };
  }

  const done = finishConfirmed(business, booking, call).catch((e) => console.error("booking follow-up failed:", e));
  return { status: "confirmed", booking, done };
}
