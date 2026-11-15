// Juno: an AI receptionist any business can switch on.
// Routes: public pages, sign-up and verification, the availability tool
// Juno calls during a call, the ElevenLabs post-call webhook, the owner's
// private manager page (Copilot), and customer cancellation links.

import express from "express";
import { rateLimit } from "express-rate-limit";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import * as db from "./src/db.js";
import { seed } from "./src/seed.js";
import { checkAvailability } from "./src/availability.js";
import { verifyWebhook } from "./src/elevenlabs.js";
import { processCall } from "./src/calls.js";
import * as copilot from "./src/copilot.js";
import { managerTools, undoChange } from "./src/tools.js";
import { sendEmail } from "./src/delivery.js";
import * as pages from "./src/pages.js";
import { validateProfile, validEmail, slugify, parseServiceLine, parseFaqLine, describeHours, describeServices, describeFaq, ValidationError, escapeHtml as h } from "./src/validate.js";

const token = () => randomBytes(16).toString("hex");
const baseUrl = (req) => process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
const limiter = (windowMs, limit, extra = {}) => rateLimit({ windowMs, limit, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Too many requests. Please wait a bit and try again." }, ...extra });

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);

  // The webhook needs the raw body to check the signature, so it comes before express.json().
  app.post("/webhook/elevenlabs", express.raw({ type: "*/*", limit: "2mb" }), async (req, res) => {
    const raw = req.body?.toString("utf8") || "";
    if (!verifyWebhook(raw, req.get("elevenlabs-signature"), process.env.ELEVENLABS_WEBHOOK_SECRET)) {
      return res.status(401).json({ error: "Invalid signature" });
    }
    let payload;
    try { payload = JSON.parse(raw); } catch { return res.status(400).json({ error: "Bad JSON" }); }
    res.status(200).json({ ok: true }); // Answer straight away; the rest runs after.
    try {
      const r = await processCall(payload);
      console.log("call:", r.status, r.booking?.id || "");
      await r.done;
    } catch (e) { console.error("webhook processing failed:", e); }
  });

  app.use(express.json({ limit: "100kb" }));
  app.use(express.static("public", { index: false, maxAge: "1h" }));

  app.get("/health", (req, res) => res.json({ ok: true, database: db.isPostgres() ? "postgres" : "memory", copilot: copilot.isConfigured() }));

  // Home page with every verified business and the sign-up form.
  app.get("/", async (req, res) => {
    res.send(pages.homePage(await db.listBusinesses(), { copilotReady: copilot.isConfigured() }));
  });

  // Copilot drafts a business from one sentence.
  const signupLimit = limiter(60 * 60 * 1000, 5);
  const draftLimit = limiter(60 * 60 * 1000, 10);
  app.post("/api/businesses/draft", draftLimit, async (req, res) => {
    const text = String(req.body?.text || "").trim();
    if (text.length < 10) return res.status(400).json({ error: "Describe your business in at least a sentence." });
    if (!copilot.isConfigured()) return res.status(503).json({ error: "Copilot isn't connected on this server." });
    const started = Date.now();
    try {
      const profile = await copilot.draftBusiness(text);
      res.json({ profile, seconds: Math.max(1, Math.round((Date.now() - started) / 1000)) });
    } catch (e) {
      console.warn("draft failed:", e.message);
      res.status(e instanceof ValidationError ? 422 : 502).json({ error: e instanceof ValidationError ? `Copilot's draft didn't pass our checks: ${e.message}` : "Copilot couldn't set this up right now." });
    }
  });

  // Sign-up. The business is saved unverified; it goes live when the owner clicks the emailed link.
  app.post("/api/businesses", signupLimit, async (req, res) => {
    try {
      const b = req.body || {};
      const services = Array.isArray(b.services) ? b.services : String(b.services || "").split("\n").map((l) => l.trim()).filter(Boolean).map(parseServiceLine);
      const faq = Array.isArray(b.faq) ? b.faq : String(b.faq || "").split("\n").map((l) => l.trim()).filter(Boolean).map(parseFaqLine);
      const profile = validateProfile({ ...b, services, faq });
      const owner_email = validEmail(b.owner_email);
      let slug = slugify(profile.name);
      if (await db.getBusinessBySlug(slug)) slug = `${slug}-${randomBytes(2).toString("hex")}`;
      const business = await db.createBusiness({ ...profile, slug, owner_email, verified: false, verify_token: token(), owner_key: token() });
      const verifyUrl = `${baseUrl(req)}/verify/${business.verify_token}`;
      const sent = await sendEmail({ to: owner_email, subject: `Switch on Juno for ${business.name}`,
        body: `Hi! Click this link to confirm it's your business and switch Juno on:\n\n${verifyUrl}\n\nIf you didn't sign up, ignore this email and nothing will happen.` });
      const message = sent
        ? `Almost there! We sent a link to <b>${h(owner_email)}</b>. Click it to switch Juno on for ${h(business.name)}.`
        : `Saved. Email isn't connected on this server, so here's the switch-on link: <a href="${h(verifyUrl)}">${h(verifyUrl)}</a>`;
      res.json({ ok: true, message });
    } catch (e) {
      if (e instanceof ValidationError) return res.status(400).json({ error: e.message });
      console.error(e); res.status(500).json({ error: "Couldn't save the business." });
    }
  });

  // Email verification.
  app.get("/verify/:token", async (req, res) => {
    const b = await db.getBusinessByVerifyToken(req.params.token);
    if (!b) return res.status(404).send(pages.messagePage("Link not found", "This link isn't valid. Try signing up again."));
    if (!b.verified) await db.updateBusiness(b.id, { verified: true });
    res.send(pages.verifiedPage(b, { publicUrl: `${baseUrl(req)}/b/${b.slug}`, manageUrl: `${baseUrl(req)}/b/${b.slug}/manage?key=${b.owner_key}` }));
  });

  // A business's booking page, with Juno. Variables are built fresh, so Copilot's changes apply to the next call.
  app.get("/b/:slug", async (req, res) => {
    const b = await db.getBusinessBySlug(req.params.slug);
    if (!b || !b.verified) return res.status(404).send(pages.messagePage("Not found", "We couldn't find that business."));
    const vars = {
      business_id: b.id, business_name: b.name, business_description: b.description,
      services: describeServices(b.services), hours: describeHours(b.hours),
      extra_questions: b.extra_questions || "None.", faq: describeFaq(b.faq),
    };
    res.send(pages.businessPage(b, { agentId: process.env.ELEVENLABS_AGENT_ID || "", vars }));
  });

  // The tool Juno calls during a call before confirming a time.
  app.post("/api/tools/check-availability", limiter(60 * 1000, 60), async (req, res) => {
    const { business_id, service, start_time, group_size } = req.body || {};
    const b = await db.getBusinessById(String(business_id || ""));
    const [bookings, blocks] = b ? await Promise.all([db.listBookings(b.id), db.listBlocks(b.id)]) : [[], []];
    res.json(checkAvailability(b, bookings, blocks, { service, start_time, group_size }));
  });

  // ---- Owner's private manager page ----
  async function owner(req, res) {
    const b = await db.getBusinessBySlug(req.params.slug);
    const key = String(req.query.key || req.body?.key || "");
    const a = Buffer.from(key), e = Buffer.from(b?.owner_key || "x");
    if (!b || a.length !== e.length || !timingSafeEqual(a, e)) { res.status(404).json({ error: "Not found" }); return null; }
    return b;
  }

  app.get("/b/:slug/manage", async (req, res) => {
    const b = await db.getBusinessBySlug(req.params.slug);
    const key = String(req.query.key || "");
    const a = Buffer.from(key), e = Buffer.from(b?.owner_key || "x");
    if (!b || a.length !== e.length || !timingSafeEqual(a, e)) return res.status(404).send(pages.messagePage("Not found", "We couldn't find that page."));
    const [bookings, suggestions, changes, pending, blocks] = await Promise.all([
      db.listBookings(b.id), db.listSuggestions(b.id), db.listChanges(b.id), db.listPendingActions(b.id), db.listBlocks(b.id)]);
    res.send(pages.ownerPage(b, { key, bookings, suggestions, changes, pending, blocks, copilotReady: copilot.isConfigured() }));
  });

  const copilotLimit = limiter(60 * 60 * 1000, 20, { keyGenerator: (req) => `copilot:${req.params.slug}` });
  app.post("/api/manage/:slug/copilot", copilotLimit, async (req, res) => {
    const b = await owner(req, res); if (!b) return;
    const message = String(req.body?.message || "").trim();
    if (!message) return res.status(400).json({ error: "Type something for Copilot." });
    if (!copilot.isConfigured()) return res.status(503).json({ error: "Copilot isn't connected on this server." });
    try { res.json(await copilot.manage(b, message)); }
    catch (e) { console.warn("copilot manage failed:", e.message); res.status(502).json({ error: "Copilot is unavailable right now. Nothing was changed." }); }
  });

  app.post("/api/manage/:slug/suggestions/:id/:action", async (req, res) => {
    const b = await owner(req, res); if (!b) return;
    const s = await db.getSuggestion(req.params.id);
    if (!s || s.business_id !== b.id || s.status !== "pending") return res.status(404).json({ error: "Suggestion not found." });
    if (req.params.action === "dismiss") { await db.updateSuggestion(s.id, { status: "dismissed" }); return res.json({ ok: true }); }
    if (req.params.action !== "approve" || s.kind !== "faq") return res.status(400).json({ error: "Unknown action." });
    const update = managerTools(b.id, { actor: "owner" }).find((t) => t.name === "update_faq");
    const r = await update.handler({ question: s.question, answer: req.body?.answer ?? s.draft_answer });
    if (!r.ok) return res.status(400).json({ error: r.error });
    await db.updateSuggestion(s.id, { status: "approved" });
    res.json({ ok: true });
  });

  app.post("/api/manage/:slug/changes/:id/undo", async (req, res) => {
    const b = await owner(req, res); if (!b) return;
    const c = await undoChange(b.id, req.params.id);
    if (!c) return res.status(400).json({ error: "That change can't be undone." });
    res.json({ ok: true });
  });

  // Approving runs the action Copilot proposed. Rejecting just closes it.
  app.post("/api/manage/:slug/pending/:id/:action", async (req, res) => {
    const b = await owner(req, res); if (!b) return;
    const p = await db.getPendingAction(req.params.id);
    if (!p || p.business_id !== b.id || p.status !== "pending") return res.status(404).json({ error: "Not found." });
    if (req.params.action === "reject") { await db.updatePendingAction(p.id, { status: "rejected" }); return res.json({ ok: true }); }
    if (req.params.action !== "approve") return res.status(400).json({ error: "Unknown action." });
    const bk = await db.getBooking(p.args.booking_id);
    if (!bk || bk.business_id !== b.id) return res.status(400).json({ error: "That booking no longer exists." });
    if (p.tool === "reschedule_booking") {
      const others = (await db.listBookings(b.id)).filter((x) => x.id !== bk.id);
      const check = checkAvailability(b, others, await db.listBlocks(b.id), { service: bk.service, start_time: p.args.start_time, group_size: bk.group_size });
      if (!check.available) return res.status(409).json({ error: `That time is no longer free: ${check.reason}` });
      await db.updateBooking(bk.id, { start_time: check.start_time, end_time: check.end_time, readable_time: check.readable_time });
      await sendEmail({ to: bk.customer_email, subject: `Your ${bk.service} at ${b.name} has moved`, body: `Hi ${bk.customer_name},\n\nYour ${bk.service} at ${b.name} has moved from ${bk.readable_time} to ${check.readable_time}.\n\nIf that doesn't work, just call us again.` });
      await sendEmail({ to: b.owner_email, subject: `Moved: ${bk.customer_name}'s ${bk.service}`, body: `You approved moving ${bk.customer_name}'s ${bk.service} from ${bk.readable_time} to ${check.readable_time}. The customer has been emailed. Remember to move the calendar event.` });
    } else if (p.tool === "cancel_booking") {
      await db.updateBooking(bk.id, { status: "cancelled" });
      await sendEmail({ to: bk.customer_email, subject: `Your ${bk.service} at ${b.name} is cancelled`, body: `Hi ${bk.customer_name},\n\nYour ${bk.service} at ${b.name} on ${bk.readable_time} has been cancelled.${p.args.reason ? ` Reason: ${p.args.reason}` : ""}\n\nCall us any time to book again.` });
      await sendEmail({ to: b.owner_email, subject: `Cancelled: ${bk.customer_name}'s ${bk.service}`, body: `You approved cancelling ${bk.customer_name}'s ${bk.service} on ${bk.readable_time}. The customer has been emailed. Remember to delete the calendar event.` });
    } else if (p.tool === "notify_customer") {
      await sendEmail({ to: bk.customer_email, subject: `A message from ${b.name}`, body: `Hi ${bk.customer_name},\n\n${p.args.message}\n\n${b.name}` });
    } else return res.status(400).json({ error: "Unknown action." });
    await db.updatePendingAction(p.id, { status: "approved" });
    await db.createChange({ business_id: b.id, actor: "owner", kind: "action", description: `Approved: ${p.description}`, undoable: false, undone: false });
    res.json({ ok: true });
  });

  // ---- Customer cancellation links ----
  async function cancellable(req, res) {
    const bk = await db.getBookingByCancelToken(req.params.token);
    const b = bk && (await db.getBusinessById(bk.business_id));
    if (!bk || !b) { res.status(404).send(pages.messagePage("Link not found", "This cancellation link isn't valid.")); return null; }
    return { bk, b };
  }
  app.get("/cancel/:token", async (req, res) => { const r = await cancellable(req, res); if (r) res.send(pages.cancelPage(r.b, r.bk)); });
  app.post("/cancel/:token", async (req, res) => {
    const r = await cancellable(req, res); if (!r) return;
    if (r.bk.status !== "cancelled") {
      await db.updateBooking(r.bk.id, { status: "cancelled" });
      await db.createChange({ business_id: r.b.id, actor: "customer", kind: "action", description: `Customer cancelled: ${r.bk.customer_name}'s ${r.bk.service} on ${r.bk.readable_time}`, undoable: false, undone: false });
      await sendEmail({ to: r.b.owner_email, subject: `Cancelled by customer: ${r.bk.customer_name}'s ${r.bk.service}`, body: `${r.bk.customer_name} cancelled their ${r.bk.service} on ${r.bk.readable_time}. The slot is free again. Remember to delete the calendar event.` });
    }
    res.send(pages.cancelPage(r.b, r.bk, { done: true }));
  });

  app.use((req, res) => res.status(404).send(pages.messagePage("Not found", "There's nothing here.")));
  app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: "Something went wrong." }); });
  return app;
}

// Start the server when run directly (not when imported by tests).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await db.init();
  const seeded = await seed();
  const app = createApp();
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, async () => {
    const base = process.env.PUBLIC_URL || `http://localhost:${port}`;
    console.log(`Juno is running at ${base}`);
    console.log(`Copilot: ${copilot.isConfigured() ? "connected" : "not configured (set COPILOT_GITHUB_TOKEN)"}`);
    for (const b of seeded.length ? seeded : await db.listBusinesses()) {
      console.log(`  ${b.name}: ${base}/b/${b.slug}   manager: ${base}/b/${b.slug}/manage?key=${b.owner_key}`);
    }
  });
}
