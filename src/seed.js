// Three example businesses so the demo works from the first minute.
// They are created verified, owned by SEED_OWNER_EMAIL.

import { randomBytes } from "node:crypto";
import * as db from "./db.js";

const token = () => randomBytes(16).toString("hex");

export const EXAMPLES = [
  {
    slug: "pixel-palace", name: "Pixel Palace",
    description: "An arcade with party rooms and private sessions, great for birthdays and team nights.",
    services: [
      { name: "Party room", minutes: 120, max_group: 20, capacity: 2 },
      { name: "Private arcade session", minutes: 60, max_group: 8, capacity: 1 },
    ],
    hours: { days: [0, 1, 2, 3, 4, 5, 6], open: "10:00", close: "21:00" },
    extra_questions: "Is it for a special occasion?",
    faq: [
      { question: "Can we bring our own cake?", answer: "Yes, cake is welcome in the party rooms." },
      { question: "Are game cards included?", answer: "Yes, every party room booking includes game cards for each guest." },
    ],
  },
  {
    slug: "focus-rooms", name: "Focus Rooms",
    description: "Bookable meeting rooms downtown, with fast wifi and a screen in every room.",
    services: [
      { name: "Small room", minutes: 60, max_group: 6, capacity: 3 },
      { name: "Large room", minutes: 120, max_group: 20, capacity: 1 },
    ],
    hours: { days: [1, 2, 3, 4, 5], open: "08:00", close: "18:00" },
    extra_questions: "Do you need a projector or catering?",
    faq: [
      { question: "Is there wifi?", answer: "Yes, fast wifi in every room. The password is on the door." },
      { question: "Is there coffee?", answer: "Free coffee and tea are in the lounge." },
    ],
  },
  {
    slug: "shear-studio", name: "Shear Studio",
    description: "A friendly hair salon with three chairs, for cuts, colour and beard trims.",
    services: [
      { name: "Haircut", minutes: 45, max_group: 1, capacity: 3 },
      { name: "Colour", minutes: 120, max_group: 1, capacity: 2 },
      { name: "Beard trim", minutes: 15, max_group: 1, capacity: 3 },
    ],
    hours: { days: [2, 3, 4, 5, 6], open: "09:00", close: "18:00" },
    extra_questions: "Do you have a preferred stylist?",
    faq: [
      { question: "Do you take walk-ins?", answer: "Only when a chair is free, so booking is best." },
    ],
  },
];

export async function seed() {
  if ((await db.countBusinesses()) > 0) return [];
  const owner = (process.env.SEED_OWNER_EMAIL || "owner@example.com").toLowerCase();
  const created = [];
  for (const ex of EXAMPLES) {
    created.push(await db.createBusiness({ ...ex, owner_email: owner, verified: true, verify_token: token(), owner_key: token() }));
  }
  return created;
}
