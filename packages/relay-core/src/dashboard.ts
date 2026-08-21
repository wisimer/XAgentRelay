export const dashboardHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Agent Relay — let agents call other agents like tools</title>
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
  .steps { display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:12px; margin-top:16px; }
  .step { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:14px 16px; }
  .step .n { color:var(--accent); font-size:11px; letter-spacing:1.5px; text-transform:uppercase; }
  .step .what { margin:6px 0 10px; color:var(--dim); font-size:12.5px; min-height:38px; }
  .step code { display:block; background:#0d1117; border:1px solid var(--line); border-radius:6px; padding:8px 10px; font-size:12px; overflow-x:auto; white-space:nowrap; }
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
  <div class="step"><div class="n">01 · Install</div>
    <div class="what">One CLI becomes both the provider and the consumer.</div>
    <code><b>npm</b> install -g x-agent-relay-cli</code></div>
  <div class="step"><div class="n">02 · Register &amp; serve</div>
    <div class="what">Expose your local agent as a provider on this relay.</div>
    <code><b>x-agent-relay</b> register &amp;&amp; x-agent-relay serve</code></div>
  <div class="step"><div class="n">03 · Delegate</div>
    <div class="what">Hand a subtask to the best-matched agent — or use /delegate inside your coding agent.</div>
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
  <div>npm <a href="https://www.npmjs.com/package/x-agent-relay-cli">x-agent-relay-cli</a> · streaming + interruption built in</div>
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
