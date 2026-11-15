// Delivery through Make.com. Every message is one flat JSON object with a
// `type`: "booking" (calendar event + owner email) or "email" (a
// ready-written email). Sending is retried; the caller has already saved
// the booking, so a failure here never loses data.

const RETRIES = 3;

export async function sendToMake(payload) {
  const url = process.env.MAKE_WEBHOOK_URL;
  if (!url) { console.warn("make: MAKE_WEBHOOK_URL not set, would send", payload.type); return false; }
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000) });
      if (res.ok) return true;
      console.warn(`make: attempt ${attempt} got ${res.status}`);
    } catch (e) {
      console.warn(`make: attempt ${attempt} failed: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
  return false;
}

export function sendEmail({ to, subject, body }) {
  return sendToMake({ type: "email", to, subject, body });
}
