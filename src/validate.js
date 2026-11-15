// Everything an owner (or Copilot) writes ends up in Juno's prompt and on
// web pages, so every field is checked, trimmed and length-limited here.
// Both the sign-up form and Copilot's tools go through these functions.

import { hhmmToMinutes } from "./time.js";

export const LIMITS = { name: 60, description: 300, faqAnswer: 200, faqQuestion: 120, questions: 300, serviceName: 40, services: 12, faq: 12, reason: 80 };

export class ValidationError extends Error {}

function text(value, max, label, { required = true } = {}) {
  const s = String(value ?? "").replace(/\s+/g, " ").trim();
  if (required && !s) throw new ValidationError(`${label} is required.`);
  if (s.length > max) throw new ValidationError(`${label} must be ${max} characters or fewer.`);
  return s;
}

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function validEmail(s) {
  const e = String(s ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) || e.length > 120) throw new ValidationError("Enter a valid email address.");
  return e;
}

export function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "business";
}

// One service: {name, minutes, max_group, capacity}
export function validateService(s) {
  const name = text(s?.name, LIMITS.serviceName, "Service name");
  const minutes = parseInt(s?.minutes, 10);
  if (!(minutes >= 5 && minutes <= 480)) throw new ValidationError(`${name}: duration must be between 5 and 480 minutes.`);
  const max_group = parseInt(s?.max_group ?? 1, 10);
  if (!(max_group >= 1 && max_group <= 500)) throw new ValidationError(`${name}: group size must be between 1 and 500.`);
  const capacity = parseInt(s?.capacity ?? 1, 10);
  if (!(capacity >= 1 && capacity <= 100)) throw new ValidationError(`${name}: capacity must be between 1 and 100.`);
  return { name, minutes, max_group, capacity };
}

export function validateServices(list) {
  if (!Array.isArray(list) || list.length === 0) throw new ValidationError("Add at least one service.");
  if (list.length > LIMITS.services) throw new ValidationError(`At most ${LIMITS.services} services.`);
  const out = list.map(validateService);
  const names = new Set();
  for (const s of out) {
    if (names.has(s.name.toLowerCase())) throw new ValidationError(`Two services are both called "${s.name}".`);
    names.add(s.name.toLowerCase());
  }
  return out;
}

// "Haircut, 45 minutes, 1 person, 3 at a time" -> service object. Also accepts "Haircut, 45".
export function parseServiceLine(line) {
  const parts = line.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) throw new ValidationError(`Can't read service "${line}". Use: Name, minutes, people, at a time.`);
  const num = (s) => parseInt(String(s).replace(/[^\d]/g, ""), 10);
  return { name: parts[0], minutes: num(parts[1]), max_group: parts[2] ? num(parts[2]) : 1, capacity: parts[3] ? num(parts[3]) : 1 };
}

// {days:[0-6], open:"HH:MM", close:"HH:MM"}
export function validateHours(h) {
  const days = [...new Set((Array.isArray(h?.days) ? h.days : []).map((d) => parseInt(d, 10)).filter((d) => d >= 0 && d <= 6))].sort();
  if (days.length === 0) throw new ValidationError("Pick at least one opening day.");
  const open = String(h?.open ?? "").trim(), close = String(h?.close ?? "").trim();
  const o = hhmmToMinutes(open), c = hhmmToMinutes(close);
  if (o == null || c == null) throw new ValidationError("Opening and closing times must look like 09:00.");
  if (c <= o) throw new ValidationError("Closing time must be after opening time.");
  return { days, open: open.padStart(5, "0"), close: close.padStart(5, "0") };
}

// [{question, answer}]
export function validateFaq(list) {
  if (!Array.isArray(list)) return [];
  if (list.length > LIMITS.faq) throw new ValidationError(`At most ${LIMITS.faq} FAQ entries.`);
  return list.map((f) => ({ question: text(f?.question, LIMITS.faqQuestion, "FAQ question"), answer: text(f?.answer, LIMITS.faqAnswer, "FAQ answer") }));
}

// "Parking? Free lot behind the shop" -> {question, answer}
export function parseFaqLine(line) {
  const m = line.match(/^(.*?\?)\s*(.+)$/) || line.match(/^(.*?):\s*(.+)$/);
  if (!m) throw new ValidationError(`Can't read FAQ "${line}". Use: Question? Answer.`);
  return { question: m[1].trim(), answer: m[2].trim() };
}

// The whole profile, from the form or from Copilot's draft. Returns clean fields only.
export function validateProfile(input) {
  return {
    name: text(input.name, LIMITS.name, "Business name"),
    description: text(input.description, LIMITS.description, "Description"),
    services: validateServices(input.services),
    hours: validateHours(input.hours),
    extra_questions: text(input.extra_questions, LIMITS.questions, "Extra questions", { required: false }),
    faq: validateFaq(input.faq),
  };
}

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// "Tuesday to Saturday, 9:00 to 18:00"
export function describeHours(h) {
  const days = (h?.days || []).map((d) => DAY_NAMES[d]);
  let dayText;
  const consecutive = days.length > 2 && days.every((_, i) => i === 0 || h.days[i] === h.days[i - 1] + 1);
  if (days.length === 7) dayText = "every day";
  else if (consecutive) dayText = `${days[0]} to ${days[days.length - 1]}`;
  else dayText = days.join(", ");
  return `${dayText}, ${h?.open} to ${h?.close}`;
}

// "Haircut (45 minutes, up to 1 person); Colour (120 minutes, up to 1 person)"
export function describeServices(services) {
  return (services || []).map((s) => `${s.name} (${s.minutes} minutes, up to ${s.max_group} ${s.max_group === 1 ? "person" : "people"})`).join("; ");
}

export function describeFaq(faq) {
  return (faq || []).map((f) => `Q: ${f.question} A: ${f.answer}`).join(" ") || "None.";
}
