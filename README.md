# Juno: an AI receptionist any business can switch on

Any business describes itself in a sentence and gets its own booking page. Customers book by talking to **Juno**, an ElevenLabs voice agent who checks every time is really free before she confirms it. A **GitHub Copilot** agent is each business's manager: it sets the business up, reviews every call, and changes the setup when the owner asks, through tools the server controls.

## How a booking works

1. **Sign-up.** An owner describes their business. Copilot turns the sentence into services, hours, an FAQ and questions for callers. The owner checks it, and Juno emails a link: the business goes live only once they click it.
2. **The call.** The business's page starts Juno with that business's details (ElevenLabs dynamic variables), always fresh from the database.
3. **The live check.** Before confirming, Juno calls `check_availability`. The server checks opening days and hours, closures, group size, how many bookings can run at once, and the past. If the time doesn't work, it returns the three nearest free times.
4. **The webhook.** When the call ends, ElevenLabs sends the booking, signed. The server verifies the signature, ignores repeats, re-checks the slot and the per-phone limit, and saves the booking before anything else.
5. **Copilot reviews the call.** It writes prep notes and Juno's confirmation, and turns any question she couldn't answer into a suggested FAQ answer for the owner.
6. **Juno's voice.** ElevenLabs text-to-speech records the confirmation with the customer's name.
7. **Delivery.** Make.com emails the customer their confirmation, with Juno's voice message and a cancel link, and emails the owner the booking with Copilot's prep notes.
8. **Copilot runs the business.** On the owner's private page: "we're closed this Saturday", "add a 15-minute beard trim". Changes apply on Juno's next call, are logged with Undo, and anything that affects a customer waits for the owner's approval.

## How we used ElevenLabs

- One Conversational AI agent serves any number of businesses through dynamic variables.
- A server tool (`check_availability`) makes her confirm only times the server approves.
- Data collection turns each call into eight structured fields.
- Signed post-call webhooks deliver each call to the server.
- Text-to-speech records a personal confirmation in Juno's voice.

## How we used GitHub Copilot

- Inside the app, through the Copilot SDK (`src/copilot.js`), Copilot does three jobs: it sets up new businesses, reviews every call, and manages each business through 12 server-defined tools (`src/tools.js`) scoped to that one business.
- While we built it, Copilot in GitHub's web editor wrote the commit messages for our fixes.

## Safety rails

| Risk | What stops it |
| --- | --- |
| Double booking | Live check during the call, re-check on arrival, per-service capacity |
| Impossible times | Hours stored as data; closures; past times refused |
| Fake bookings | Signed webhooks; 3 bookings per phone per business per day |
| Fake sign-ups | Email verification; 5 sign-ups per hour per network address |
| Copilot mistakes | Tools validate everything, changes have Undo, customer actions need approval, tools can't reach other businesses |
| Prompt injection | Owner text is length-limited and Juno treats it as information only |
| Something's down | Bookings are saved first; Copilot and voice have fallbacks; Make sends retry |

## Run it

```bash
npm install
npm test
npm start
```

Full setup (Render, ElevenLabs, Copilot, Make.com): [SETUP.md](SETUP.md).

## Code map

| File | What it does |
| --- | --- |
| `server.js` | Routes: pages, sign-up, verification, availability tool, webhook, owner page, cancellations |
| `src/availability.js` | The booking rules |
| `src/calls.js` | What happens when a call ends |
| `src/copilot.js` | Every Copilot call: setup, call review, manager |
| `src/tools.js` | The 12 tools Copilot uses to manage one business |
| `src/validate.js` | Checks for everything an owner or Copilot writes |
| `src/elevenlabs.js` | Webhook signatures and text-to-speech |
| `src/delivery.js` | Sending to Make.com, with retries |
| `src/db.js` | Postgres, or memory when there's no database |
| `src/pages.js` | The HTML pages |

Known limits: one booking per call, every business on Pacific time, and a web page instead of a phone number.
