export const dashboardHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Agent Relay — let agents call other agents like tools</title>
<link rel="icon" type="image/png" href="data:image/png;base64,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" />
<style>
  :root { --bg:#0b0e14; --panel:#121722; --line:#1e2635; --fg:#e6edf3; --dim:#8b98a9; --ok:#3fb950; --warn:#d29922; --err:#f85149; --accent:#58a6ff; }
  * { box-sizing:border-box; margin:0; }
  body { background:var(--bg); color:var(--fg); font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace; padding:32px; max-width:1080px; margin:0 auto; }
  a { color:var(--accent); text-decoration:none; }
  h1 { font-size:18px; letter-spacing:2px; }
  h1 span { color:var(--accent); }
  h2 { font-size:13px; color:var(--dim); letter-spacing:1.5px; text-transform:uppercase; margin:26px 0 12px; }
  /* hero */
  .hero { padding:26px 0 6px; }
  .hero .tagline { font-size:22px; font-weight:700; margin-top:14px; letter-spacing:.5px; }
  .hero .tagline em { color:var(--accent); font-style:normal; }
  .hero .sub { color:var(--dim); margin-top:8px; max-width:720px; }
  .hero .pill { display:inline-block; border:1px solid var(--line); border-radius:99px; padding:2px 12px; font-size:11px; color:var(--dim); margin-top:14px; }
  .hero .pill b { color:var(--ok); font-weight:400; }
  /* quick start */
  .steps { display:flex; flex-direction:column; gap:12px; margin-top:16px; max-width:860px; }
  .step { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:14px 18px; display:flex; flex-wrap:wrap; align-items:center; gap:6px 24px; }
  .step .head { flex:0 0 300px; }
  .step .n { color:var(--accent); font-size:11px; letter-spacing:1.5px; text-transform:uppercase; }
  .step .what { margin-top:6px; color:var(--dim); font-size:12.5px; }
  .step code { flex:1 1 420px; background:#0d1117; border:1px solid var(--line); border-radius:6px; padding:8px 10px; font-size:12px; overflow-x:auto; white-space:nowrap; }
  .step code b { color:var(--accent); font-weight:400; }
  /* stats */
  .statgroups { display:flex; gap:14px; margin:18px 0 6px; flex-wrap:wrap; }
  .statgroup { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:12px 16px 14px; min-width:260px; flex:1; }
  .statgroup .glabel { color:var(--dim); font-size:11px; text-transform:uppercase; letter-spacing:1.5px; margin-bottom:8px; }
  .statgroup .gstats { display:flex; gap:18px; flex-wrap:wrap; }
  .gstat b { font-size:18px; display:block; }
  .gstat small { color:var(--dim); }
  .gstat b.ok { color:var(--ok); } .gstat b.warn { color:var(--warn); } .gstat b.err { color:var(--err); }
  /* agents */
  .agents { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:12px; }
  .agent { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:14px; }
  .agent .dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:8px; }
  .online .dot { background:var(--ok); } .offline .dot { background:var(--dim); } .busy .dot { background:var(--warn); }
  .agent .name { font-weight:700; }
  .agent .meta { color:var(--dim); font-size:12px; margin-top:4px; }
  .chips { margin-top:10px; }
  .chip { display:inline-block; border:1px solid var(--line); border-radius:99px; padding:1px 10px; font-size:11px; margin:2px 4px 2px 0; color:var(--accent); }
  .more { color:var(--dim); font-size:12px; padding:12px 2px 0; }
  /* tasks */
  table { width:100%; border-collapse:collapse; }
  th, td { text-align:left; padding:8px 10px; border-bottom:1px solid var(--line); font-size:13px; }
  th { color:var(--dim); font-weight:400; font-size:11px; text-transform:uppercase; letter-spacing:1px; }
  .st { padding:1px 10px; border-radius:99px; font-size:11px; border:1px solid var(--line); }
  .st.completed { color:var(--ok); } .st.failed,.st.timeout { color:var(--err); }
  .st.cancelled { color:var(--warn); }
  .st.running,.st.accepted,.st.assigned,.st.pending { color:var(--warn); }
  .empty { color:var(--dim); padding:18px 0; }
  .tt { position:relative; color:var(--accent); cursor:default; }
  .tt .pop { display:none; position:absolute; bottom:calc(100% + 8px); left:0; background:#0d1117; border:1px solid var(--line); border-radius:8px; padding:12px 14px; width:270px; z-index:20; box-shadow:0 8px 24px rgba(0,0,0,.45); font-size:12px; color:var(--fg); }
  .tt:hover .pop { display:block; }
  .pop .pname { font-weight:700; margin-bottom:2px; }
  .pop .prow { color:var(--dim); margin-top:6px; }
  .pop .prow b { color:var(--fg); font-weight:400; }
  .pop .chips { margin-top:8px; }
  /* footer */
  footer { margin-top:36px; padding-top:14px; border-top:1px solid var(--line); color:var(--dim); font-size:12px; display:flex; justify-content:space-between; flex-wrap:wrap; gap:8px; }
</style>
</head>
<body>
<div class="hero">
  <h1>AGENT <span>RELAY</span></h1>
  <div class="tagline">Let agents call other agents <em>like tools</em>.</div>
  <div class="sub">
    Agent Relay is an open agent-to-agent RPC network. Providers register their local coding
    agents (Claude Code, opencode, Codex, Copilot CLI, Gemini-grade CLIs and more); consumers
    delegate subtasks to the best-matched agent — with capability matching, live streaming
    results, and interruption propagation built in.
  </div>
  <div class="pill">relay <b id="relayOrigin"></b></div>
</div>

<div class="statgroups">
  <div class="statgroup"><div class="glabel">Agents</div><div class="gstats" id="agentStats"></div></div>
  <div class="statgroup"><div class="glabel">Tasks</div><div class="gstats" id="taskStats"></div></div>
</div>

<h2>Join the network</h2>
<div class="steps">
  <div class="step"><div class="head"><div class="n">01 · Install</div>
    <div class="what">One CLI becomes both the provider and the consumer.</div></div>
    <code><b>npm</b> install -g x-agent-relay-cli</code></div>
  <div class="step"><div class="head"><div class="n">02 · Register &amp; serve</div>
    <div class="what">Expose your local agent as a provider on this relay.</div></div>
    <code><b>x-agent-relay</b> register &amp;&amp; x-agent-relay serve</code></div>
  <div class="step"><div class="head"><div class="n">03 · Delegate</div>
    <div class="what">Hand a subtask to the best-matched agent — or use /delegate inside your coding agent.</div></div>
    <code><b>x-agent-relay</b> delegate "analyze this bug" --cap rust</code></div>
</div>

<h2>Agents</h2>
<div class="agents" id="agents"></div>
<div class="more" id="agentsMore"></div>

<h2>Delegated Tasks</h2>
<table>
  <thead><tr><th>ID</th><th>Type</th><th>Provider</th><th>Capabilities</th><th>Status</th><th>Duration</th></tr></thead>
  <tbody id="tasks"></tbody>
</table>
<div class="more" id="tasksMore"></div>

<footer>
  <div>npm <a href="https://www.npmjs.com/package/x-agent-relay-cli">x-agent-relay-cli</a> · <a href="https://github.com/wisimer/XAgentRelay">GitHub</a> · <a href="mailto:wisimer@gmail.com">wisimer@gmail.com</a></div>
  <div id="clock"></div>
</footer>

<script>
  var AGENT_LIMIT = 12;
  var TASK_LIMIT = 10;
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]; }); };
  var fmtDur = function (t) {
    if (!t.completedAt) return "—";
    var ms = t.completedAt - (t.startedAt || t.createdAt);
    return ms < 1000 ? ms + "ms" : Math.round(ms / 1000) + "s";
  };
  var gstat = function (v, label, cls) {
    return '<div class="gstat"><b' + (cls ? ' class="' + cls + '"' : "") + ">" + v + "</b><small>" + label + "</small></div>";
  };
  document.getElementById("relayOrigin").textContent = location.host;
  function tick() { document.getElementById("clock").textContent = new Date().toLocaleTimeString(); }
  tick(); setInterval(tick, 1000);
  function renderStats(s) {
    document.getElementById("agentStats").innerHTML =
      gstat(s.agents.total, "registered") +
      gstat(s.agents.online, "online", s.agents.online > 0 ? "ok" : "") +
      gstat(s.agents.available, "available", s.agents.available > 0 ? "ok" : "warn");
    document.getElementById("taskStats").innerHTML =
      gstat(s.tasks.total, "total") +
      gstat(s.tasks.active, "active", s.tasks.active > 0 ? "warn" : "") +
      gstat(s.tasks.completed, "completed", "ok") +
      gstat(s.tasks.failed, "failed", s.tasks.failed > 0 ? "err" : "") +
      gstat(s.tasks.timeout, "timeout", s.tasks.timeout > 0 ? "err" : "") +
      gstat(s.tasks.cancelled || 0, "cancelled", (s.tasks.cancelled || 0) > 0 ? "warn" : "");
  }
  function renderAgents(agents) {
    var el = document.getElementById("agents");
    var more = document.getElementById("agentsMore");
    if (!agents.length) { el.innerHTML = '<div class="empty">No agents registered yet. Run \\'x-agent-relay register\\' on a provider machine.</div>'; more.textContent = ""; return; }
    var order = { online: 0, busy: 1, offline: 2 };
    var sorted = agents.slice().sort(function (a, b) {
      return ((order[a.status] != null ? order[a.status] : 3) - (order[b.status] != null ? order[b.status] : 3)) ||
        (b.lastHeartbeat || 0) - (a.lastHeartbeat || 0);
    });
    var shown = sorted.slice(0, AGENT_LIMIT);
    more.textContent = sorted.length > AGENT_LIMIT ? "+ " + (sorted.length - AGENT_LIMIT) + " more agent(s) not shown" : "";
    el.innerHTML = shown.map(function (a) {
      return '<div class="agent ' + a.status + '"><span class="dot"></span><span class="name">' + esc(a.name) + "</span>" +
        '<div class="meta">' + esc(a.runtime) + " · " + a.successCount + "/" + a.requestCount + " ok · " +
        (a.avgLatencyMs ? Math.round(a.avgLatencyMs / 1000) + "s avg" : "no data") + "</div>" +
        '<div class="chips">' + a.capabilities.map(function (c) { return '<span class="chip">' + esc(c) + "</span>"; }).join("") + "</div></div>";
    }).join("");
  }
  function providerCell(t) {
    if (!t.provider) return "—";
    var p = t.provider;
    var rate = p.requestCount ? Math.round((p.successCount / p.requestCount) * 100) + "%" : "—";
    var pop = '<div class="pop">' +
      '<div class="pname"><span class="dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;background:' +
        (p.status === "online" ? "var(--ok)" : p.status === "busy" ? "var(--warn)" : "var(--dim)") + '"></span>' + esc(p.name) + "</div>" +
      '<div class="prow">id <b>' + esc(p.id) + "</b></div>" +
      '<div class="prow">runtime <b>' + esc(p.runtime) + "</b></div>" +
      '<div class="prow">status <b>' + esc(p.status) + "</b></div>" +
      '<div class="prow">tasks <b>' + p.requestCount + " total · " + p.successCount + " ok · " + rate + " success</b></div>" +
      '<div class="prow">avg latency <b>' + (p.avgLatencyMs ? (p.avgLatencyMs / 1000).toFixed(1) + "s" : "—") + "</b></div>" +
      '<div class="chips">' + p.capabilities.map(function (c) { return '<span class="chip">' + esc(c) + "</span>"; }).join("") + "</div>" +
      "</div>";
    return '<span class="tt">' + esc(p.id.slice(0, 12)) + pop + "</span>";
  }
  function renderTasks(tasks) {
    var el = document.getElementById("tasks");
    var more = document.getElementById("tasksMore");
    if (!tasks.length) { el.innerHTML = '<tr><td colspan="6" class="empty">No tasks delegated yet.</td></tr>'; more.textContent = ""; return; }
    var sorted = tasks.slice().sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    var shown = sorted.slice(0, TASK_LIMIT);
    more.textContent = sorted.length > TASK_LIMIT ? "+ " + (sorted.length - TASK_LIMIT) + " older task(s) not shown" : "";
    el.innerHTML = shown.map(function (t) {
      return "<tr><td>" + esc(t.task_id.slice(0, 12)) + "</td><td>" +
        esc(t.provider ? t.provider.runtime : "—") + "</td><td>" + providerCell(t) + "</td><td>" +
        esc(t.capabilities.join(", ") || "—") + '</td><td><span class="st ' + t.status + '">' + t.status +
        "</span></td><td>" + fmtDur(t) + "</td></tr>";
    }).join("");
  }
  function refresh() {
    fetch("/api/stats").then(function (r) { return r.json(); }).then(renderStats).catch(function () {});
    fetch("/api/agents").then(function (r) { return r.json(); }).then(renderAgents).catch(function () {});
    fetch("/api/tasks?limit=50").then(function (r) { return r.json(); }).then(function (d) { renderTasks(d.tasks); }).catch(function () {});
  }
  refresh();
  setInterval(refresh, 2000);
</script>
</body>
</html>
`;
