# Juno: an AI receptionist any business can switch on

Node.js 20+, Express 5, ES modules, built-in fetch. Read README.md for the
flow and the code map. Every business shares one ElevenLabs agent, one
server and one Make.com scenario; there is no limit on businesses.

## Rules for changes
- Never remove a safety check: webhook signature verification,
  duplicate-call detection, the availability re-check, rate limits,
  email verification, or owner-key checks.
- Save a booking before any slow step. Copilot, text-to-speech and Make
  must never block or lose a booking; keep their fallbacks.
- Copilot never touches the database directly. It acts only through the
  tools in src/tools.js, each bound to one business id. Tools that
  affect a customer create a PendingAction for the owner to approve.
  Profile changes write a Change with before/after so they can be undone.
- Everything an owner or Copilot writes goes through src/validate.js and
  is escaped with escapeHtml before reaching a page.
- Secrets only from environment variables (see .env.example). Never put
  owner_email, tokens or keys in a page.
- Times are naive Pacific wall-clock strings like 2026-11-21T15:00:00;
  use src/time.js, never the server's local time zone.
- Add a test in test/ for any new booking rule or tool, and keep
  `npm test` passing.
- Short functions with a comment saying what each does. Plain language
  in anything a customer or owner reads.
