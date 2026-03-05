// ─── BetLens PWA — app.js ────────────────────────────────────────────────────

// ─── Backend config ───────────────────────────────────────────────────────────

const BACKEND = "https://betlens-backend-production.up.railway.app";

async function apiCall(path, method = "GET", body = null) {
  const token = localStorage.getItem("betlensToken");
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = "Bearer " + token;
  const resp = await fetch(BACKEND + path, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || "Request failed");
  return data;
}

function isLoggedIn() {
  return !!localStorage.getItem("betlensToken");
}

// ─── IndexedDB ───────────────────────────────────────────────────────────────

const DB_NAME = "betlens", DB_VERSION = 1, STORE = "bets";

function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => e.target.result.createObjectStore(STORE, { keyPath: "orderId" });
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e.target.error);
  });
}

async function saveBets(bets) {
  const db = await openDB();
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  for (const bet of bets) store.put(bet);
  return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
}

async function loadBets() {
  const db = await openDB();
  const tx = db.transaction(STORE, "readonly");
  const store = tx.objectStore(STORE);
  return new Promise((res, rej) => {
    const req = store.getAll();
    req.onsuccess = () => res(req.result);
    req.onerror   = rej;
  });
}

async function clearBets() {
  const db = await openDB();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).clear();
  return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
}

// ─── Stats computation ────────────────────────────────────────────────────────

function computeStats(bets, fromDate, toDate) {
  const filtered = bets.filter(b => {
    const d = b.date ? new Date(b.date) : null;
    if (!d) return true;
    if (fromDate && d < fromDate) return false;
    if (toDate   && d > toDate)   return false;
    return true;
  });

  let totalBets = 0, totalWins = 0, totalLosses = 0;
  let totalVoid = 0, totalPending = 0;
  let totalStake = 0, totalReturn = 0;
  let biggestWin = 0, biggestLoss = 0;

  for (const bet of filtered) {
    totalStake  += bet.stake  || 0;
    totalReturn += bet.ret    || 0;
    const net = (bet.ret || 0) - (bet.stake || 0);
    if (net > biggestWin)  biggestWin  = net;
    if (net < biggestLoss) biggestLoss = net;
    if      (bet.status === "win")     { totalBets++; totalWins++;    }
    else if (bet.status === "loss")    { totalBets++; totalLosses++;  }
    else if (bet.status === "void")    { totalVoid++;                  }
    else if (bet.status === "pending") { totalPending++;               }
  }

  const settledBets = totalWins + totalLosses;
  const pnl     = totalReturn - totalStake;
  const roi     = totalStake > 0 ? (pnl / totalStake) * 100 : 0;
  const winRate = settledBets > 0 ? (totalWins / settledBets) * 100 : 0;
  const avgStake = (settledBets + totalPending) > 0
    ? totalStake / (settledBets + totalPending) : 0;

  const settled = filtered
    .filter(b => b.status === "win" || b.status === "loss")
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

  const accaBets   = settled.filter(b => b.isAcca);
  const singleBets = settled.filter(b => !b.isAcca);

  const chronological = [...settled].sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
  let cumulative = 0;
  const sparklineData = chronological.map(b => {
    cumulative += (b.ret - b.stake);
    return parseFloat(cumulative.toFixed(2));
  });

  return {
    bets: filtered, settledBets, totalWins, totalLosses, totalVoid, totalPending,
    totalStake, totalReturn,
    pnl:        parseFloat(pnl.toFixed(2)),
    roi:        parseFloat(roi.toFixed(2)),
    winRate:    parseFloat(winRate.toFixed(2)),
    avgStake:   parseFloat(avgStake.toFixed(2)),
    biggestWin:  parseFloat(biggestWin.toFixed(2)),
    biggestLoss: parseFloat(biggestLoss.toFixed(2)),
    accaCount:   accaBets.length,
    accaWins:    accaBets.filter(b => b.status === "win").length,
    singleCount: singleBets.length,
    singleWins:  singleBets.filter(b => b.status === "win").length,
    sparklineData,
    recentBets: filtered
      .filter(b => b.status !== "pending")
      .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
      .slice(0, 30),
  };
}

// ─── Formatting ───────────────────────────────────────────────────────────────

function fmt(n) {
  const abs = Math.abs(n).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return "₦" + abs;
}

function fmtDate(d) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// ─── Sparkline ────────────────────────────────────────────────────────────────

function drawSparkline(data, canvasId = "sparkline") {
  const canvas = document.getElementById(canvasId);
  if (!canvas || data.length < 2) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.offsetWidth * window.devicePixelRatio;
  const H = canvas.offsetHeight * window.devicePixelRatio;
  canvas.width = W; canvas.height = H;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  const w = canvas.offsetWidth, h = canvas.offsetHeight;

  ctx.clearRect(0, 0, w, h);
  const min = Math.min(...data, 0), max = Math.max(...data, 0);
  const range = max - min || 1;
  const pad = 8, xStep = w / Math.max(data.length - 1, 1);
  const toY = v => h - pad - ((v - min) / range) * (h - pad * 2);

  // Zero line
  const zeroY = toY(0);
  ctx.beginPath(); ctx.setLineDash([3, 4]);
  ctx.moveTo(0, zeroY); ctx.lineTo(w, zeroY);
  ctx.strokeStyle = "rgba(255,255,255,0.1)"; ctx.lineWidth = 1; ctx.stroke();
  ctx.setLineDash([]);

  const isPos = data[data.length - 1] >= 0;
  const color = isPos ? "#00e5a0" : "#ff4d6a";
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, isPos ? "rgba(0,229,160,0.25)" : "rgba(255,77,106,0.25)");
  grad.addColorStop(1, "rgba(0,0,0,0)");

  ctx.beginPath();
  ctx.moveTo(0, toY(data[0]));
  data.forEach((v, i) => {
    if (i === 0) return;
    const x = i * xStep, px = (i-1) * xStep, cpx = (px+x)/2;
    ctx.bezierCurveTo(cpx, toY(data[i-1]), cpx, toY(v), x, toY(v));
  });
  ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();

  ctx.beginPath();
  ctx.moveTo(0, toY(data[0]));
  data.forEach((v, i) => {
    if (i === 0) return;
    const x = i * xStep, px = (i-1) * xStep, cpx = (px+x)/2;
    ctx.bezierCurveTo(cpx, toY(data[i-1]), cpx, toY(v), x, toY(v));
  });
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();

  const lx = (data.length - 1) * xStep, ly = toY(data[data.length - 1]);
  ctx.beginPath(); ctx.arc(lx, ly, 4, 0, Math.PI * 2);
  ctx.fillStyle = color; ctx.fill();
}

// ─── Calendar ─────────────────────────────────────────────────────────────────

let calYear = new Date().getFullYear(), calMonth = new Date().getMonth();

function renderCalendar(bets) {
  const dayMap = {};
  for (const bet of bets) {
    if (bet.status !== "win" && bet.status !== "loss") continue;
    const d = new Date(bet.date);
    if (isNaN(d)) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    if (!dayMap[key]) dayMap[key] = { pnl: 0, count: 0 };
    dayMap[key].pnl   += (bet.ret - bet.stake);
    dayMap[key].count += 1;
  }

  document.getElementById("calMonthLabel").textContent =
    new Date(calYear, calMonth, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  let monthPnl = 0, profitDays = 0, lossDays = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${calYear}-${String(calMonth+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    if (dayMap[key]) {
      monthPnl += dayMap[key].pnl;
      dayMap[key].pnl >= 0 ? profitDays++ : lossDays++;
    }
  }

  const pos = monthPnl >= 0;
  document.getElementById("calSummary").innerHTML = `
    <span class="chip" style="color:${pos?"var(--green)":"var(--red)"}">${pos?"+":"−"}${fmt(Math.abs(monthPnl))}</span>
    <span class="chip">🟢 ${profitDays} days</span>
    <span class="chip">🔴 ${lossDays} days</span>`;

  const firstDow = (new Date(calYear, calMonth, 1).getDay() + 6) % 7;
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;

  let html = "";
  for (let i = 0; i < firstDow; i++) html += `<div class="cal-day blank"></div>`;

  for (let day = 1; day <= daysInMonth; day++) {
    const key = `${calYear}-${String(calMonth+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    const data = dayMap[key];
    const isToday = key === todayKey;
    let cls = "cal-day";
    let pnlHtml = "";

    if (data) {
      cls += data.pnl >= 0 ? " win" : " loss";
      const amt = Math.abs(data.pnl);
      const amtStr = amt >= 100000 ? (amt/1000).toFixed(0)+"k"
                   : amt >= 10000  ? (amt/1000).toFixed(1)+"k"
                   : amt.toFixed(0);
      pnlHtml = `<div class="cal-pnl">${data.pnl>=0?"+":"−"}₦${amtStr}</div>`;
    } else {
      cls += " empty";
    }
    if (isToday) cls += " today";

    html += `<div class="${cls}"><div class="cal-num">${day}</div>${pnlHtml}</div>`;
  }

  document.getElementById("calDays").innerHTML = html;
}

// ─── Render dashboard ─────────────────────────────────────────────────────────

function renderDashboard(stats) {
  const pnlPos = stats.pnl >= 0;
  document.getElementById("pnl").textContent      = (pnlPos?"+":"−") + fmt(Math.abs(stats.pnl));
  document.getElementById("pnl").className        = "stat-val " + (pnlPos?"green":"red");
  document.getElementById("roi").textContent      = (stats.roi>=0?"↑":"↓") + " " + Math.abs(stats.roi).toFixed(1) + "% ROI";
  document.getElementById("roi").className        = "stat-badge " + (stats.roi>=0?"up":"down");
  document.getElementById("staked").textContent   = fmt(stats.totalStake);
  document.getElementById("bets").textContent     = stats.settledBets + " settled" + (stats.totalPending>0?` · ${stats.totalPending} pending`:"");
  document.getElementById("winRate").textContent  = stats.winRate.toFixed(1) + "%";
  document.getElementById("wl").textContent       = `${stats.totalWins}W · ${stats.totalLosses}L` + (stats.totalVoid?` · ${stats.totalVoid} void`:"");
  document.getElementById("bigWin").textContent   = "+" + fmt(stats.biggestWin);
  document.getElementById("bigLoss").textContent  = "−" + fmt(Math.abs(stats.biggestLoss));

  const accaWR   = stats.accaCount   > 0 ? Math.round(stats.accaWins   / stats.accaCount   * 100) : 0;
  const singleWR = stats.singleCount > 0 ? Math.round(stats.singleWins / stats.singleCount * 100) : 0;
  document.getElementById("chips").innerHTML = [
    stats.accaCount   ? `<span class="chip">Accas ${accaWR}% WR (${stats.accaCount})</span>` : "",
    stats.singleCount ? `<span class="chip">Singles ${singleWR}% WR (${stats.singleCount})</span>` : "",
    stats.avgStake > 0 ? `<span class="chip">Avg stake ${fmt(stats.avgStake)}</span>` : "",
  ].filter(Boolean).join("");

  // Bet list
  const list = document.getElementById("betList");
  list.innerHTML = "";
  if (!stats.recentBets.length) {
    list.innerHTML = `<p class="empty-msg">No bets in this period</p>`;
    return;
  }
  for (const bet of stats.recentBets) {
    const net = bet.ret - bet.stake;
    const netStr = (net>=0?"+":"−") + fmt(Math.abs(net));
    const row = document.createElement("div");
    row.className = "bet-row";
    row.innerHTML = `
      <div class="bet-info">
        <div class="bet-name">${escHtml(bet.name||"Unknown")}</div>
        <div class="bet-meta">${fmtDate(bet.date)}${bet.odds?" · Odds "+escHtml(String(bet.odds)):""}</div>
      </div>
      <div class="bet-right">
        <div class="bet-pnl ${bet.status}">${bet.status==="pending"?fmt(bet.stake):netStr}</div>
        <div class="bet-stake">${fmt(bet.stake)} stake</div>
      </div>`;
    list.appendChild(row);
  }

  setTimeout(() => drawSparkline(stats.sparklineData), 50);
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

// ─── Date filters ─────────────────────────────────────────────────────────────

let allBets = [];
let activeFrom = null, activeTo = null;

function applyFilter(from, to) {
  activeFrom = from; activeTo = to;
  if (!allBets.length) return;
  const stats = computeStats(allBets, from, to);
  renderDashboard(stats);
  if (document.getElementById("tab-calendar").classList.contains("active")) {
    renderCalendar(stats.bets);
  }
}

function todayRange() {
  const d = new Date(); d.setHours(0,0,0,0);
  const e = new Date(); e.setHours(23,59,59,999);
  return [d, e];
}

// ─── Sync from hash ───────────────────────────────────────────────────────────

async function processSyncHash() {
  // Data arrives via URL hash from bookmarklet
  const hash = location.hash;
  if (!hash.startsWith("#sync=")) return false;
  showToast("⏳ Importing bets…");
  try {
    const encoded = hash.slice(6);
    const json = decodeURIComponent(escape(atob(encoded)));
    const slim = JSON.parse(json);
    // Expand slim format back to full bet objects
    const bets = slim.map(b => ({
      orderId: b.i, name: b.n, odds: b.o,
      stake: b.s, ret: b.r, status: b.t,
      date: b.d, isAcca: b.a === 1,
    }));
    await saveBets(bets);
    location.hash = "";
    localStorage.setItem("betlensLastSync", Date.now());
    showToast(`✅ ${bets.length} bets synced!`);
    return true;
  } catch (err) {
    showToast("❌ Sync failed — try again");
    console.error(err);
    location.hash = "";
    return false;
  }
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function showToast(msg, duration = 3000) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), duration);
}

// ─── Export CSV ───────────────────────────────────────────────────────────────

function exportCSV() {
  if (!allBets.length) { showToast("No data to export"); return; }
  const rows = [["Date","Name","Odds","Stake","Return","P&L","Status"]];
  allBets.forEach(b => rows.push([
    fmtDate(b.date), b.name||"", b.odds||"",
    (b.stake||0).toFixed(2), (b.ret||0).toFixed(2),
    ((b.ret||0)-(b.stake||0)).toFixed(2), b.status||""
  ]));
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(new Blob([csv], {type:"text/csv"})),
    download: "betlens-export.csv"
  });
  a.click(); URL.revokeObjectURL(a.href);
}

// ─── Bookmarklet generator ────────────────────────────────────────────────────

function buildBookmarklet(pwaUrl) {
  const code = `(function(){
"use strict";
var BL_PWA="${pwaUrl}";
var BL_PS=50;
async function blFetch(pageNo,settled){
  var resp=await fetch("https://www.sportybet.com/api/ng/orders/order/v2/realbetlist?isSettled="+settled+"&pageSize="+BL_PS+"&pageNo="+pageNo+"&_t="+Date.now(),{credentials:"include"});
  var json=await resp.json();
  if(json.bizCode!==10000)throw new Error(json.message||"API error");
  return json.data;
}
function blStatus(ws){return ws===20?"win":ws===30?"loss":(ws===40||ws===50)?"void":"pending";}
function blParse(order){
  var stake=parseFloat(order.totalStake)||0;
  var ret=parseFloat(order.totalWinnings)||0;
  var legs=(order.selections||[]).map(function(sel){return(sel.home||"?")+" v "+(sel.away||"?");});
  var nm=legs.length===0?"Unknown":legs.length===1?legs[0]:legs[0]+" +"+(legs.length-1);
  var combinedOdds=(order.selections||[]).reduce(function(acc,sel){var v=parseFloat(sel.odds);return isNaN(v)?acc:acc*v;},1);
  return{orderId:order.shortId||order.orderId||"",name:nm,odds:combinedOdds.toFixed(2),
    stake:stake,ret:ret,status:blStatus(order.winningStatus),
    date:order.createTime?new Date(order.createTime).toISOString():null,
    isAcca:(order.selectionSize||1)>1};
}
var blEl=document.createElement("div");
blEl.style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#111318;color:#00e5a0;font-family:monospace;font-size:14px;padding:20px 28px;border-radius:12px;z-index:2147483647;border:1px solid #00e5a0;min-width:240px;text-align:center;box-shadow:0 0 40px rgba(0,229,160,0.2)";
document.body.appendChild(blEl);
function blMsg(txt){blEl.textContent=txt;}
blMsg("BetLens: connecting…");
(async function(){
  try{
    var allBets=[];
    var settledTypes=[10,0];
    for(var si=0;si<settledTypes.length;si++){
      var settled=settledTypes[si];
      var pageNo=1;
      var totalPages=1;
      while(pageNo<=totalPages){
        blMsg("Fetching page "+pageNo+" of "+totalPages+"…");
        var pageData=await blFetch(pageNo,settled);
        totalPages=Math.ceil((pageData.totalNum||0)/BL_PS)||1;
        var items=pageData.entityList||[];
        for(var ii=0;ii<items.length;ii++){allBets.push(blParse(items[ii]));}
        pageNo++;
        if(pageNo<=totalPages){await new Promise(function(resolve){setTimeout(resolve,250);});}
      }
    }
    blMsg("✅ "+allBets.length+" bets found! Opening BetLens…");
    var slim=allBets.map(function(b){return{i:b.orderId,n:b.name,o:b.odds,s:b.stake,r:b.ret,t:b.status,d:b.date,a:b.isAcca?1:0};});
    var enc=btoa(unescape(encodeURIComponent(JSON.stringify(slim))));
    setTimeout(function(){window.location.href=BL_PWA+"#sync="+enc;},1500);
  }catch(err){
    blMsg("\u274C Error: "+err.message);
    setTimeout(function(){blEl.remove();},4000);
  }
})();
})();`;
  return "javascript:" + encodeURIComponent(code);
}


// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  // Unregister any old service workers, then register fresh
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.getRegistrations().then(regs => {
      regs.forEach(r => r.unregister());
    });
    navigator.serviceWorker.register("/sw.js").catch(console.warn);
  }

  // Tab switching — works for both top tabs and bottom nav
  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
      // Activate all tabs with same data-tab (nav + any header tabs)
      document.querySelectorAll(`.tab[data-tab="${tab.dataset.tab}"]`).forEach(t => t.classList.add("active"));
      const panel = document.getElementById("tab-" + tab.dataset.tab);
      if (panel) panel.classList.add("active");
      if (tab.dataset.tab === "calendar") {
        const stats = computeStats(allBets, activeFrom, activeTo);
        renderCalendar(stats.bets);
      }
    });
  });

  // Quick filters
  document.querySelectorAll(".qf[data-range]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".qf[data-range]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const to = new Date(); to.setHours(23,59,59,999);
      let from = new Date(); from.setHours(0,0,0,0);
      if      (btn.dataset.range === "7d")  from.setDate(from.getDate() - 7);
      else if (btn.dataset.range === "30d") from.setDate(from.getDate() - 30);
      else if (btn.dataset.range === "3m")  from.setMonth(from.getMonth() - 3);
      else if (btn.dataset.range === "all") { from = null; }
      applyFilter(from, to);
    });
  });

  // Month picker
  const monthPicker = document.getElementById("monthPicker");
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const opt = document.createElement("option");
    opt.value = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
    opt.textContent = d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    monthPicker.appendChild(opt);
  }
  monthPicker.addEventListener("change", () => {
    if (!monthPicker.value) return;
    const [yr, mo] = monthPicker.value.split("-").map(Number);
    const from = new Date(yr, mo - 1, 1);
    const to   = new Date(yr, mo, 0, 23, 59, 59, 999);
    document.querySelectorAll(".qf[data-range]").forEach(b => b.classList.remove("active"));
    applyFilter(from, to);
  });

  // Calendar nav
  document.getElementById("calPrev").addEventListener("click", () => {
    calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; }
    renderCalendar(computeStats(allBets, activeFrom, activeTo).bets);
  });
  document.getElementById("calNext").addEventListener("click", () => {
    calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; }
    renderCalendar(computeStats(allBets, activeFrom, activeTo).bets);
  });

  // Theme toggle
  const themeToggle = document.getElementById("themeToggle");

  function applyTheme(theme) {
    document.body.classList.toggle("light", theme === "light");
    if (themeToggle) themeToggle.textContent = theme === "light" ? "🌙" : "☀️";
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === "light" ? "#f0f2f7" : "#0a0b0d";
  }

  applyTheme(localStorage.getItem("betlensTheme") || "dark");

  if (themeToggle) {
    themeToggle.addEventListener("click", () => {
      const next = document.body.classList.contains("light") ? "dark" : "light";
      applyTheme(next);
      localStorage.setItem("betlensTheme", next);
    });
  }

  // Export
  document.getElementById("exportBtn").addEventListener("click", exportCSV);

  // Clear data
  document.getElementById("clearBtn").addEventListener("click", async () => {
    if (!confirm("Clear all bet data? This cannot be undone.")) return;
    await clearBets();
    allBets = [];
    renderDashboard(computeStats([], null, null));
    showToast("Data cleared");
  });

  // Account info + logout
  const emailEl = document.getElementById("accountEmail");
  const logoutBtn = document.getElementById("logoutBtn");
  const email = localStorage.getItem("betlensEmail");
  if (emailEl) emailEl.textContent = email || "Not logged in";
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      if (!confirm("Log out of BetLens?")) return;
      localStorage.removeItem("betlensToken");
      localStorage.removeItem("betlensEmail");
      localStorage.removeItem("betlensLastSync");
      window.location.reload();
    });
  }

  // Sync page setup
  const bmInstr = document.getElementById("bmInstructions");
  const bmWrap  = document.getElementById("bmBtnWrap");
  if (bmInstr) {
    bmInstr.innerHTML =
      `<strong>How to sync:</strong><br><br>
      1. Log into <strong>SportyBet</strong> in this browser<br>
      2. Come back here and tap <strong>"Sync Bets"</strong> below<br>
      3. Your bets load automatically ✅<br><br>
      <small>Your data stays on your phone. Nothing is sent anywhere.</small>`;
  }
  if (bmWrap) {
    const syncLink = document.createElement("a");
    syncLink.href = "/sync.html";
    syncLink.className = "bm-btn";
    syncLink.style.cssText = "display:block;text-align:center;text-decoration:none;width:100%;padding:14px;background:var(--green);color:#000;border-radius:12px;font-weight:700;font-size:15px;";
    syncLink.textContent = "⚡ Sync Bets";
    const note = document.createElement("p");
    note.className = "bm-note";
    note.style.marginTop = "10px";
    note.textContent = "Make sure you're logged into SportyBet first";
    bmWrap.appendChild(syncLink);
    bmWrap.appendChild(note);
  }


  // Init login overlay
  initLoginOverlay();

  // If not logged in, show login screen
  if (!isLoggedIn()) {
    document.getElementById("loginOverlay").classList.add("show");
    return;
  }

  // Logged in — load bets from backend
  await loadBetsFromBackend();
}

// ─── Login overlay ────────────────────────────────────────────────────────────

let loginMode = true; // true = login, false = register

function initLoginOverlay() {
  const overlay   = document.getElementById("loginOverlay");
  const loginBtn  = document.getElementById("loginBtn");
  const toggleBtn = document.getElementById("loginToggle");
  const errEl     = document.getElementById("loginErr");
  const subEl     = document.getElementById("loginSub");

  if (!loginBtn) return;

  toggleBtn.addEventListener("click", () => {
    loginMode = !loginMode;
    loginBtn.textContent  = loginMode ? "Log In" : "Create Account";
    subEl.textContent     = loginMode ? "Log in to see your bet stats" : "Create a free BetLens account";
    toggleBtn.innerHTML   = loginMode
      ? `Don't have an account? <span>Sign up</span>`
      : `Already have an account? <span>Log in</span>`;
    errEl.textContent = "";
  });

  loginBtn.addEventListener("click", async () => {
    const email    = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;
    errEl.textContent = "";

    if (!email || !password) { errEl.textContent = "Enter email and password"; return; }

    loginBtn.textContent = "Please wait…";
    loginBtn.disabled = true;

    try {
      const path = loginMode ? "/auth/login" : "/auth/register";
      const data = await apiCall(path, "POST", { email, password });
      localStorage.setItem("betlensToken", data.token);
      localStorage.setItem("betlensEmail", data.email);
      overlay.classList.remove("show");
      await loadBetsFromBackend();
    } catch (err) {
      errEl.textContent = err.message;
      loginBtn.textContent = loginMode ? "Log In" : "Create Account";
      loginBtn.disabled = false;
    }
  });
}

// ─── Load bets from backend ───────────────────────────────────────────────────

async function loadBetsFromBackend() {
  const email = localStorage.getItem("betlensEmail") || "";
  document.getElementById("lastSync").textContent = email;

  try {
    document.getElementById("lastSync").textContent = "Loading…";
    const data = await apiCall("/bets");

    // Also merge any locally cached bets (from sync.html)
    const localBets = await loadBets();
    const betMap = {};
    for (const b of [...(data.bets || []), ...localBets]) {
      betMap[b.orderId] = b;
    }
    allBets = Object.values(betMap);

    // If we had local bets, push them to backend too
    if (localBets.length > 0) {
      apiCall("/bets/sync", "POST", { bets: localBets }).catch(() => {});
    }

    const lastSync = localStorage.getItem("betlensLastSync");
    const mins = lastSync ? Math.round((Date.now() - parseInt(lastSync)) / 60000) : null;
    document.getElementById("lastSync").textContent = mins === null ? email
      : mins < 1 ? `${email} · just now`
      : mins < 60 ? `${email} · ${mins}m ago`
      : `${email} · ${Math.round(mins/60)}h ago`;

    if (allBets.length === 0) {
      document.getElementById("emptyState").style.display = "flex";
      document.getElementById("dashContent").style.display = "none";
    } else {
      document.getElementById("emptyState").style.display = "none";
      document.getElementById("dashContent").style.display = "block";
      const to = new Date(); to.setHours(23,59,59,999);
      const from = new Date(); from.setDate(from.getDate() - 30); from.setHours(0,0,0,0);
      document.querySelector(".qf[data-range='30d']")?.classList.add("active");
      applyFilter(from, to);
    }
  } catch (err) {
    document.getElementById("lastSync").textContent = "Load failed";
    showToast("❌ Could not load bets: " + err.message);
  }
}

document.addEventListener("DOMContentLoaded", init);
