// Server-rendered pages. Everything that came from an owner, a caller or
// Copilot is escaped with h() before it reaches the page.

import { escapeHtml as h, describeHours, DAY_NAMES } from "./validate.js";

const CSS = `
:root{--bg:#0b0718;--panel:#150d2b;--panel2:#1b1038;--line:#2c1f55;--pink:#ff3fa4;--cyan:#35e0ff;--yellow:#ffd84a;--green:#4dff9d;--red:#ff6b6b;--text:#f3efff;--muted:#a79fc7}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Space Grotesk",system-ui,sans-serif;color:var(--text);background:var(--bg);min-height:100vh;line-height:1.5;
 background-image:radial-gradient(60rem 30rem at 85% -10%,rgba(255,63,164,.2),transparent 60%),radial-gradient(50rem 30rem at 0% 20%,rgba(53,224,255,.14),transparent 60%)}
a{color:var(--cyan)} a:hover{color:#fff}
.wrap{max-width:1080px;margin:0 auto;padding:24px 24px 120px}
header.top{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:8px}
.logo{font-family:"Press Start 2P",monospace;font-size:14px;letter-spacing:1px;color:var(--text);text-decoration:none}.logo span{color:var(--pink)}
.navlinks{display:flex;gap:18px;font-size:14px}
.tag{display:inline-block;font-family:"Press Start 2P",monospace;font-size:10px;color:var(--yellow);border:1px solid var(--yellow);padding:8px 10px;border-radius:4px;margin-bottom:20px}
h1{font-family:"Press Start 2P",monospace;font-size:clamp(24px,4.2vw,42px);line-height:1.4;text-shadow:3px 3px 0 var(--pink),-2px -2px 0 rgba(53,224,255,.6)}
h2{font-family:"Press Start 2P",monospace;font-size:14px;color:var(--cyan);margin:44px 0 16px;line-height:1.6}
h3{font-size:18px;margin-bottom:4px}
.sub{margin-top:20px;font-size:19px;color:var(--muted);max-width:36em}.sub b{color:var(--text);font-weight:500}
.hero{padding:56px 0 24px}
.muted{color:var(--muted)} .small{font-size:14px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:20px}
.card.link{text-decoration:none;color:inherit;display:block;transition:border-color .15s,transform .15s}.card.link:hover{border-color:var(--cyan);transform:translateY(-2px)}
.meta{color:var(--yellow);font-size:14px;margin:4px 0 8px}
.btn{font-family:inherit;font-weight:700;font-size:16px;color:#12062a;background:var(--cyan);border:0;padding:13px 22px;border-radius:10px;cursor:pointer;box-shadow:0 5px 0 #1596b0;transition:transform .08s,box-shadow .08s;text-decoration:none;display:inline-block}
.btn:hover{transform:translateY(2px);box-shadow:0 3px 0 #1596b0;color:#12062a}.btn:active{transform:translateY(5px);box-shadow:none}
.btn.big{font-size:19px;padding:18px 30px;box-shadow:0 6px 0 #1596b0,0 0 30px rgba(53,224,255,.4)}
.btn.pink{background:var(--pink);box-shadow:0 5px 0 #a81f6a}.btn.small{font-size:13px;padding:7px 12px;box-shadow:0 3px 0 #1596b0}
.btn.ghost{background:transparent;color:var(--text);border:1px solid var(--line);box-shadow:none}.btn.ghost:hover{border-color:var(--cyan)}
.btn[disabled]{opacity:.5;cursor:not-allowed}
label{display:block;font-size:14px;color:var(--muted);margin:14px 0 6px}
input,textarea,select{width:100%;font-family:inherit;font-size:15px;color:var(--text);background:#0f0922;border:1px solid var(--line);border-radius:10px;padding:11px 12px}
input:focus,textarea:focus{outline:2px solid var(--cyan);border-color:transparent}
textarea{min-height:84px;resize:vertical}
.row{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.days{display:flex;flex-wrap:wrap;gap:8px}.days label{margin:0;display:flex;gap:6px;align-items:center;background:#0f0922;border:1px solid var(--line);border-radius:8px;padding:7px 10px;color:var(--text);cursor:pointer}.days input{width:auto}
.copilot{border:1px solid rgba(53,224,255,.45);background:linear-gradient(160deg,#10203a,#150d2b);border-radius:16px;padding:20px}
.copilot .who{font-family:"Press Start 2P",monospace;font-size:10px;color:var(--cyan);margin-bottom:10px}
.status{margin-top:12px;font-size:15px;min-height:1.5em}.status.err{color:var(--red)}.status.ok{color:var(--green)}
.pill{display:inline-block;font-size:12px;font-weight:700;padding:3px 9px;border-radius:999px;background:#2a1d52;color:var(--text)}
.pill.confirmed{background:rgba(77,255,157,.15);color:var(--green)}.pill.needs_attention{background:rgba(255,216,74,.15);color:var(--yellow)}
.pill.cancelled,.pill.missed{background:rgba(255,107,107,.13);color:var(--red)}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:10px 8px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:500}
.item{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;padding:14px 0;border-bottom:1px solid var(--line)}.item:last-child{border-bottom:0}
.actions{display:flex;gap:8px;flex-wrap:wrap;flex-shrink:0}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.chip{font-size:13px;background:#0f0922;border:1px solid var(--line);color:var(--muted);border-radius:999px;padding:6px 12px;cursor:pointer}.chip:hover{color:var(--text);border-color:var(--cyan)}
.reply{margin-top:14px;background:#0f0922;border:1px solid var(--line);border-radius:12px;padding:14px;display:none}.reply.show{display:block}
.tools{margin-top:8px;font-size:13px;color:var(--muted)}.tools code{color:var(--cyan)}
.note{margin-top:16px;padding:12px 14px;border:1px dashed var(--yellow);border-radius:10px;color:var(--yellow);font-size:14px}
.empty{color:var(--muted);font-size:15px;padding:8px 0}
.orb{width:54px;height:54px;border-radius:50%;flex:none;background:radial-gradient(circle at 30% 30%,#fff,var(--cyan) 30%,var(--pink) 75%);box-shadow:0 0 26px rgba(255,63,164,.6);animation:pulse 2.4s ease-in-out infinite}
@keyframes pulse{50%{transform:scale(1.08);box-shadow:0 0 40px rgba(53,224,255,.7)}}
.biz-hero{display:grid;grid-template-columns:1.2fr .8fr;gap:40px;align-items:start;padding:40px 0 10px}
ul.clean{list-style:none}ul.clean li{padding:8px 0;border-bottom:1px solid var(--line)}
code.k{background:#0f0922;border:1px solid var(--line);padding:2px 6px;border-radius:6px;font-size:13px;word-break:break-all}
footer{margin-top:60px;font-size:13px;color:var(--muted);border-top:1px solid var(--line);padding-top:16px}
@media(max-width:820px){.biz-hero,.row{grid-template-columns:1fr}}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`;

export function layout(title, body, { scripts = "" } = {}) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${h(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Space+Grotesk:wght@400;500;700&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body><div class="wrap">
<header class="top"><a class="logo" href="/">JU<span>NO</span></a><nav class="navlinks"><a href="/#businesses">Businesses</a><a href="/#add">Add your business</a></nav></header>
${body}
<footer>Juno is a hackathon project. Voice by ElevenLabs, business management by GitHub Copilot, delivery by Make.com, hosted on Render.</footer>
</div>${scripts}</body></html>`;
}

function servicesList(services) {
  return (services || []).map((s) => `${h(s.name)} · ${s.minutes} min · up to ${s.max_group}`).join("<br>");
}

export function homePage(businesses, { copilotReady }) {
  const cards = businesses.length ? businesses.map((b) => `
    <a class="card link" href="/b/${h(b.slug)}"><h3>${h(b.name)}</h3><div class="meta">${h(describeHours(b.hours))}</div>
    <p class="muted small">${h(b.description)}</p><p class="small" style="margin-top:12px;color:var(--cyan)">Talk to Juno &rarr;</p></a>`).join("")
    : `<p class="empty">No businesses yet. Add the first one below.</p>`;
  const dayBoxes = DAY_NAMES.map((d, i) => `<label><input type="checkbox" name="days" value="${i}" ${i >= 1 && i <= 5 ? "checked" : ""}>${d.slice(0, 3)}</label>`).join("");
  return layout("Juno: an AI receptionist any business can switch on", `
<section class="hero">
  <div class="tag">AN AI RECEPTIONIST FOR ANY BUSINESS</div>
  <h1>Your business, answered.</h1>
  <p class="sub">Describe your business in a sentence. <b>Juno</b> answers your customers by voice and books them in, checking every time is really free. A <b>GitHub Copilot</b> agent runs the rest: it learns from every call and changes your setup when you ask.</p>
</section>

<h2 id="businesses">TALK TO A BUSINESS</h2>
<div class="grid">${cards}</div>

<h2 id="add">ADD YOUR BUSINESS</h2>
<div class="copilot">
  <div class="who">GITHUB COPILOT</div>
  <label for="describe" style="margin-top:0">Describe your business in a sentence or two</label>
  <textarea id="describe" placeholder="I run a three-chair barbershop in Portland, open Tuesday to Saturday 9 to 6. Haircuts take 30 minutes, beard trims 15."></textarea>
  <div style="margin-top:12px"><button class="btn" id="draftBtn" ${copilotReady ? "" : "disabled"}>Set it up for me</button></div>
  <div class="status" id="draftStatus">${copilotReady ? "" : "Copilot isn't connected on this server yet, so fill in the form below."}</div>
</div>

<form id="bizForm" class="card" style="margin-top:14px" novalidate>
  <div class="row"><div><label for="name">Business name</label><input id="name" name="name" maxlength="60" required></div>
  <div><label for="owner_email">Your email (we send a link to switch Juno on)</label><input id="owner_email" name="owner_email" type="email" required></div></div>
  <label for="description">Short description</label><input id="description" name="description" maxlength="300" required>
  <label for="services">Services, one per line: name, minutes, max people, how many at once</label>
  <textarea id="services" name="services" placeholder="Haircut, 30 minutes, 1 person, 3 at a time&#10;Beard trim, 15 minutes, 1 person, 3 at a time"></textarea>
  <label>Open on</label><div class="days" id="days">${dayBoxes}</div>
  <div class="row"><div><label for="open">Opens</label><input id="open" name="open" type="time" value="09:00"></div><div><label for="close">Closes</label><input id="close" name="close" type="time" value="17:00"></div></div>
  <label for="extra_questions">Anything Juno should ask callers?</label><input id="extra_questions" name="extra_questions" maxlength="300" placeholder="Do you have a preferred stylist?">
  <label for="faq">FAQ, one per line: question? answer</label>
  <textarea id="faq" name="faq" placeholder="Is there parking? Free lot behind the shop"></textarea>
  <div style="margin-top:18px"><button class="btn pink" type="submit">Create my receptionist</button></div>
  <div class="status" id="formStatus"></div>
</form>`, { scripts: `<script>
const $ = (id) => document.getElementById(id);
function fill(p) {
  $("name").value = p.name || ""; $("description").value = p.description || "";
  $("services").value = (p.services || []).map(s => s.name + ", " + s.minutes + " minutes, " + s.max_group + " " + (s.max_group == 1 ? "person" : "people") + ", " + s.capacity + " at a time").join("\\n");
  document.querySelectorAll('#days input').forEach(cb => cb.checked = (p.hours?.days || []).includes(+cb.value));
  $("open").value = p.hours?.open || "09:00"; $("close").value = p.hours?.close || "17:00";
  $("extra_questions").value = p.extra_questions || "";
  $("faq").value = (p.faq || []).map(f => f.question.replace(/\\?*$/, "?") + " " + f.answer).join("\\n");
}
$("draftBtn").addEventListener("click", async () => {
  const text = $("describe").value.trim(); const st = $("draftStatus");
  if (!text) { st.className = "status err"; st.textContent = "Describe your business first."; return; }
  $("draftBtn").disabled = true; st.className = "status"; st.textContent = "Copilot is setting up your business...";
  try {
    const r = await fetch("/api/businesses/draft", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "Copilot couldn't set this up.");
    fill(j.profile); st.className = "status ok";
    st.textContent = "Copilot set up " + j.profile.name + " in " + j.seconds + " seconds. Check it below, add your email, and save.";
    $("bizForm").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) { st.className = "status err"; st.textContent = e.message + " You can fill in the form yourself."; }
  finally { $("draftBtn").disabled = false; }
});
$("bizForm").addEventListener("submit", async (e) => {
  e.preventDefault(); const st = $("formStatus");
  const body = { name: $("name").value, description: $("description").value, owner_email: $("owner_email").value,
    services: $("services").value, faq: $("faq").value, extra_questions: $("extra_questions").value,
    hours: { days: [...document.querySelectorAll('#days input:checked')].map(c => +c.value), open: $("open").value, close: $("close").value } };
  st.className = "status"; st.textContent = "Saving...";
  try {
    const r = await fetch("/api/businesses", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "Couldn't save.");
    st.className = "status ok"; st.innerHTML = j.message;
  } catch (err) { st.className = "status err"; st.textContent = err.message; }
});
</script>` });
}

export function businessPage(b, { agentId, vars }) {
  const faq = (b.faq || []).map((f) => `<li><b>${h(f.question)}</b><br><span class="muted">${h(f.answer)}</span></li>`).join("");
  return layout(`${b.name} | Book with Juno`, `
<section class="biz-hero">
  <div>
    <div class="tag">BOOK BY VOICE</div>
    <h1>${h(b.name)}</h1>
    <p class="sub">${h(b.description)}</p>
    <div style="margin-top:28px;display:flex;gap:14px;align-items:center;flex-wrap:wrap">
      <button class="btn big" id="talk">Talk to Juno</button>
      <span class="muted small">Juno is an AI receptionist. Mic required.</span>
    </div>
    ${agentId ? "" : `<div class="note">Setup needed: set ELEVENLABS_AGENT_ID on the server to switch on the call button.</div>`}
  </div>
  <div class="card">
    <div style="display:flex;gap:14px;align-items:center;margin-bottom:14px"><div class="orb"></div><div><b>Juno</b><div class="muted small">Receptionist for ${h(b.name)}</div></div></div>
    <div class="meta">Open ${h(describeHours(b.hours))}</div>
    <p class="small">${servicesList(b.services)}</p>
  </div>
</section>
${faq ? `<h2>GOOD TO KNOW</h2><ul class="clean">${faq}</ul>` : ""}
${agentId ? `<elevenlabs-convai agent-id="${h(agentId)}" dynamic-variables="${h(JSON.stringify(vars))}" action-text="Talk to Juno" start-call-text="Start call" end-call-text="Hang up" avatar-orb-color-1="#35e0ff" avatar-orb-color-2="#ff3fa4"></elevenlabs-convai>
<script src="https://unpkg.com/@elevenlabs/convai-widget-embed" async type="text/javascript"></script>` : ""}`,
  { scripts: `<script>
document.getElementById("talk").addEventListener("click", () => {
  const w = document.querySelector("elevenlabs-convai");
  if (!w) return;
  const btn = w.shadowRoot && w.shadowRoot.querySelector("button");
  if (btn) btn.click(); else w.scrollIntoView();
});
</script>` });
}

export function messagePage(title, html) {
  return layout(title, `<section class="hero"><h1>${h(title)}</h1><div class="sub">${html}</div></section>`);
}

export function verifiedPage(b, { publicUrl, manageUrl }) {
  return layout(`${b.name} is live`, `
<section class="hero"><div class="tag">YOU'RE LIVE</div><h1>Juno is answering for ${h(b.name)}.</h1>
<p class="sub">Share your booking page with customers. Keep your manager link private: it's where Copilot runs your business.</p></section>
<div class="grid">
  <div class="card"><h3>Your booking page</h3><p class="small muted" style="margin:6px 0 14px">Share this anywhere.</p><code class="k">${h(publicUrl)}</code><div style="margin-top:14px"><a class="btn" href="${h(publicUrl)}">Open it</a></div></div>
  <div class="card"><h3>Your private manager page</h3><p class="small muted" style="margin:6px 0 14px">Bookings, Copilot's suggestions, and changes. Don't share this link.</p><code class="k">${h(manageUrl)}</code><div style="margin-top:14px"><a class="btn pink" href="${h(manageUrl)}">Open it</a></div></div>
</div>`);
}

function fmtWhen(iso) {
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function ownerPage(b, { key, bookings, suggestions, changes, pending, blocks, copilotReady }) {
  const k = encodeURIComponent(key);
  const pend = pending.filter((p) => p.status === "pending");
  const sugg = suggestions.filter((s) => s.status === "pending");
  const pendingHtml = pend.length ? pend.map((p) => `<div class="item"><div>${h(p.description)}<div class="small muted">Proposed by Copilot · ${h(fmtWhen(p.created_at))}</div></div>
    <div class="actions"><button class="btn small" data-act="pending/${h(p.id)}/approve">Approve</button><button class="btn small ghost" data-act="pending/${h(p.id)}/reject">Reject</button></div></div>`).join("")
    : `<p class="empty">Nothing waiting. Copilot asks here before it moves, cancels or messages a customer.</p>`;
  const suggHtml = sugg.length ? sugg.map((s) => s.kind === "faq" ? `<div class="item"><div style="flex:1"><div><b>Callers asked:</b> ${h(s.question)}</div>
      <label>Answer Juno will give</label><input value="${h(s.draft_answer)}" id="ans-${h(s.id)}" maxlength="200"></div>
      <div class="actions" style="margin-top:28px"><button class="btn small" data-act="suggestions/${h(s.id)}/approve" data-answer="ans-${h(s.id)}">Approve</button><button class="btn small ghost" data-act="suggestions/${h(s.id)}/dismiss">Dismiss</button></div></div>`
    : `<div class="item"><div><b>Copilot noticed:</b> ${h(s.text)}</div><div class="actions"><button class="btn small ghost" data-act="suggestions/${h(s.id)}/dismiss">Dismiss</button></div></div>`).join("")
    : `<p class="empty">No suggestions yet. After each call, Copilot turns questions Juno couldn't answer into suggested answers here.</p>`;
  const rows = bookings.length ? bookings.map((x) => `<tr><td>${h(x.readable_time || x.start_time || "")}</td><td>${h(x.service || "")}<div class="small muted">${x.group_size ? `${x.group_size} ${x.group_size == 1 ? "person" : "people"}` : ""}</div></td>
    <td>${h(x.customer_name || "")}<div class="small muted">${h(x.customer_phone || "")}</div></td>
    <td><span class="pill ${h(x.status)}">${h(String(x.status).replace("_", " "))}</span>${x.problem ? `<div class="small muted">${h(x.problem)}</div>` : ""}<div class="small muted">${x.forwarded ? "Sent to calendar" : x.status === "confirmed" ? "Not sent yet" : ""}</div></td>
    <td>${x.voice_url ? `<audio controls preload="none" src="${h(x.voice_url)}" style="width:170px"></audio>` : ""}${(x.plan_steps || []).length ? `<details><summary class="small">Prep notes</summary><ul class="small" style="margin:6px 0 0 16px">${x.plan_steps.map((s) => `<li>${h(s)}</li>`).join("")}</ul></details>` : ""}</td></tr>`).join("")
    : `<tr><td colspan="5" class="empty">No calls yet. Open your booking page and talk to Juno.</td></tr>`;
  const changeHtml = changes.length ? changes.slice(0, 30).map((c) => `<div class="item"><div>${h(c.description)}<div class="small muted">${c.actor === "copilot" ? "Copilot" : h(c.actor)} · ${h(fmtWhen(c.created_at))}${c.undone ? " · undone" : ""}</div></div>
    <div class="actions">${c.undoable && !c.undone ? `<button class="btn small ghost" data-act="changes/${h(c.id)}/undo">Undo</button>` : ""}</div></div>`).join("")
    : `<p class="empty">No changes yet.</p>`;
  const blockHtml = blocks.length ? blocks.map((x) => `<li>Closed ${h(x.start.replace("T", " ").slice(0, 16))} to ${h(x.end.replace("T", " ").slice(0, 16))}${x.reason ? ` · ${h(x.reason)}` : ""}</li>`).join("") : "";
  return layout(`${b.name} | Manager`, `
<section class="hero" style="padding-bottom:0"><div class="tag">PRIVATE MANAGER PAGE</div><h1>${h(b.name)}</h1>
<p class="sub">Your booking page: <a href="/b/${h(b.slug)}">/b/${h(b.slug)}</a></p></section>

<h2>TELL COPILOT</h2>
<div class="copilot"><div class="who">GITHUB COPILOT · MANAGER</div>
  <textarea id="msg" placeholder="We're closed this Saturday for a private event."></textarea>
  <div class="chips">${["We're closed this Saturday for a private event.", "Add a 15-minute express option.", "What's booked this week?", "Open an hour later on Mondays."].map((t) => `<button class="chip" type="button">${h(t)}</button>`).join("")}</div>
  <div style="margin-top:12px"><button class="btn" id="send" ${copilotReady ? "" : "disabled"}>Send to Copilot</button></div>
  <div class="status" id="copilotStatus">${copilotReady ? "" : "Copilot isn't connected on this server (COPILOT_GITHUB_TOKEN is not set). Everything else on this page still works."}</div>
  <div class="reply" id="reply"></div>
</div>

<h2>WAITING FOR YOUR APPROVAL</h2><div class="card">${pendingHtml}</div>
<h2>COPILOT'S SUGGESTIONS</h2><div class="card">${suggHtml}</div>
<h2>BOOKINGS</h2><div class="card" style="overflow-x:auto"><table><thead><tr><th>When</th><th>Service</th><th>Customer</th><th>Status</th><th>Juno's confirmation</th></tr></thead><tbody>${rows}</tbody></table></div>
<h2>CHANGE LOG</h2><div class="card">${changeHtml}</div>
<h2>CURRENT SETUP</h2><div class="card small"><p><b>Hours:</b> ${h(describeHours(b.hours))}</p><p style="margin-top:8px"><b>Services:</b><br>${servicesList(b.services)}</p>
<p style="margin-top:8px"><b>FAQ:</b> ${(b.faq || []).map((f) => `${h(f.question)} <span class="muted">${h(f.answer)}</span>`).join(" · ") || "none"}</p>${blockHtml ? `<p style="margin-top:8px"><b>Closures:</b></p><ul style="margin-left:18px">${blockHtml}</ul>` : ""}</div>`,
  { scripts: `<script>
const KEY = ${JSON.stringify(key)}, SLUG = ${JSON.stringify(b.slug)};
const post = (path, body) => fetch("/api/manage/" + SLUG + "/" + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: KEY, ...body }) }).then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "Something went wrong."); return j; });
const esc = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function showReply(j) { const el = document.getElementById("reply"); el.className = "reply show";
  el.innerHTML = "<div>" + esc(j.reply) + "</div>" + (j.called && j.called.length ? '<div class="tools">Tools Copilot used: ' + j.called.map(t => "<code>" + esc(t) + "</code>").join(", ") + "</div>" : ""); }
try { const saved = sessionStorage.getItem("copilotReply"); if (saved) { showReply(JSON.parse(saved)); sessionStorage.removeItem("copilotReply"); } } catch {}
document.querySelectorAll(".chip").forEach(c => c.addEventListener("click", () => { document.getElementById("msg").value = c.textContent; document.getElementById("msg").focus(); }));
document.getElementById("send").addEventListener("click", async () => {
  const msg = document.getElementById("msg").value.trim(), st = document.getElementById("copilotStatus"), btn = document.getElementById("send");
  if (!msg) return; btn.disabled = true; st.className = "status"; st.textContent = "Copilot is working on it...";
  try { const j = await post("copilot", { message: msg }); try { sessionStorage.setItem("copilotReply", JSON.stringify(j)); } catch {} location.reload(); }
  catch (e) { st.className = "status err"; st.textContent = e.message; btn.disabled = false; }
});
document.querySelectorAll("[data-act]").forEach(b => b.addEventListener("click", async () => {
  b.disabled = true; const body = {}; if (b.dataset.answer) body.answer = document.getElementById(b.dataset.answer).value;
  try { await post(b.dataset.act, body); location.reload(); } catch (e) { alert(e.message); b.disabled = false; }
}));
</script>` });
}

export function cancelPage(b, booking, { done = false } = {}) {
  if (done) return messagePage("Booking cancelled", `Your ${h(booking.service)} at ${h(b.name)} on ${h(booking.readable_time)} is cancelled. ${h(b.name)} has been told.`);
  if (booking.status === "cancelled") return messagePage("Already cancelled", `This booking at ${h(b.name)} was already cancelled.`);
  return layout("Cancel your booking", `<section class="hero"><h1>Cancel your booking?</h1>
<p class="sub">${h(booking.service)} at <b>${h(b.name)}</b> on ${h(booking.readable_time)}, for ${h(booking.customer_name)}.</p>
<form method="post" style="margin-top:24px"><button class="btn pink" type="submit">Yes, cancel it</button></form></section>`);
}
