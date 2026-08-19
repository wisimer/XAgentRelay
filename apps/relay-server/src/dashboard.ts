export const dashboardHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Agent Relay</title>
<style>
  :root { --bg:#0b0e14; --panel:#121722; --line:#1e2635; --fg:#e6edf3; --dim:#8b98a9; --ok:#3fb950; --warn:#d29922; --err:#f85149; --accent:#58a6ff; }
  * { box-sizing:border-box; margin:0; }
  body { background:var(--bg); color:var(--fg); font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace; padding:32px; }
  h1 { font-size:18px; letter-spacing:2px; }
  h1 span { color:var(--accent); }
  .stats { display:flex; gap:10px; margin:18px 0 28px; flex-wrap:wrap; }
  .stat { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:8px 14px; }
  .stat b { font-size:18px; display:block; }
  .stat small { color:var(--dim); }
  h2 { font-size:13px; color:var(--dim); letter-spacing:1.5px; text-transform:uppercase; margin:26px 0 12px; }
  .agents { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:12px; }
  .agent { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:14px; }
  .agent .dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:8px; }
  .online .dot { background:var(--ok); } .offline .dot { background:var(--dim); } .busy .dot { background:var(--warn); }
  .agent .name { font-weight:700; }
  .agent .meta { color:var(--dim); font-size:12px; margin-top:4px; }
  .chips { margin-top:10px; }
  .chip { display:inline-block; border:1px solid var(--line); border-radius:99px; padding:1px 10px; font-size:11px; margin:2px 4px 2px 0; color:var(--accent); }
  table { width:100%; border-collapse:collapse; }
  th, td { text-align:left; padding:8px 10px; border-bottom:1px solid var(--line); font-size:13px; }
  th { color:var(--dim); font-weight:400; font-size:11px; text-transform:uppercase; letter-spacing:1px; }
  tr.taskrow { cursor:pointer; }
  tr.taskrow:hover { background:var(--panel); }
  .st { padding:1px 10px; border-radius:99px; font-size:11px; border:1px solid var(--line); }
  .st.completed { color:var(--ok); } .st.failed,.st.timeout { color:var(--err); }
  .st.running,.st.accepted,.st.assigned,.st.pending { color:var(--warn); }
  #detail { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:16px; margin-top:16px; display:none; white-space:pre-wrap; font-size:13px; }
  .empty { color:var(--dim); padding:18px 0; }
</style>
</head>
<body>
<h1>AGENT <span>RELAY</span> <small style="color:var(--dim)">dashboard</small></h1>
<div class="stats" id="stats"></div>
<h2>Agents</h2>
<div class="agents" id="agents"></div>
<h2>Delegated Tasks</h2>
<table>
  <thead><tr><th>ID</th><th>Goal</th><th>Capabilities</th><th>Provider</th><th>Status</th><th>Duration</th></tr></thead>
  <tbody id="tasks"></tbody>
</table>
<div id="detail"></div>
<script>
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]; }); };
  var fmtDur = function (t) {
    if (!t.completedAt) return "—";
    var ms = t.completedAt - (t.startedAt || t.createdAt);
    return ms < 1000 ? ms + "ms" : Math.round(ms / 1000) + "s";
  };
  function renderStats(s) {
    document.getElementById("stats").innerHTML =
      '<div class="stat"><b>' + s.agents.online + "/" + s.agents.total + '</b><small>agents online</small></div>' +
      '<div class="stat"><b>' + s.tasks.active + '</b><small>active tasks</small></div>' +
      '<div class="stat"><b>' + s.tasks.completed + '</b><small>completed</small></div>' +
      '<div class="stat"><b>' + s.tasks.failed + '</b><small>failed</small></div>' +
      '<div class="stat"><b>' + s.tasks.timeout + '</b><small>timeout</small></div>';
  }
  function renderAgents(agents) {
    var el = document.getElementById("agents");
    if (!agents.length) { el.innerHTML = '<div class="empty">No agents registered yet. Run \\'agent-relay register\\' on a provider machine.</div>'; return; }
    el.innerHTML = agents.map(function (a) {
      return '<div class="agent ' + a.status + '"><span class="dot"></span><span class="name">' + esc(a.name) + "</span>" +
        '<div class="meta">' + esc(a.runtime) + " · " + a.successCount + "/" + a.requestCount + " ok · " +
        (a.avgLatencyMs ? Math.round(a.avgLatencyMs / 1000) + "s avg" : "no data") + "</div>" +
        '<div class="chips">' + a.capabilities.map(function (c) { return '<span class="chip">' + esc(c) + "</span>"; }).join("") + "</div></div>";
    }).join("");
  }
  function renderTasks(tasks) {
    var el = document.getElementById("tasks");
    if (!tasks.length) { el.innerHTML = '<tr><td colspan="6" class="empty">No tasks delegated yet.</td></tr>'; return; }
    el.innerHTML = tasks.map(function (t) {
      return '<tr class="taskrow" data-id="' + t.task_id + '"><td>' + esc(t.task_id.slice(0, 12)) + "</td><td>" +
        esc(String(t.goal).slice(0, 60)) + "</td><td>" + esc(t.capabilities.join(", ")) + "</td><td>" +
        esc(t.providerId || "—") + '</td><td><span class="st ' + t.status + '">' + t.status + "</span></td><td>" + fmtDur(t) + "</td></tr>";
    }).join("");
    Array.prototype.forEach.call(el.querySelectorAll(".taskrow"), function (row) {
      row.onclick = function () {
        fetch("/api/tasks/" + row.dataset.id).then(function (r) { return r.json(); }).then(function (d) {
          var t = d.task, el = document.getElementById("detail");
          el.style.display = "block";
          el.textContent = JSON.stringify(t, null, 2);
        });
      };
    });
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
