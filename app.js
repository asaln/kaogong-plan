/* =========================================================
 * 考公备考计划表 · 核心逻辑
 *  - 任务清单（items）持久化到本地，刷新不丢
 *  - 支持云端多端同步（配置一次，全端自动）
 *  - 任务编辑改为多行 textarea，一行一条
 * ========================================================= */
(function () {
'use strict';

/* ---------- 1. 常量 ---------- */
const STORE_KEY = 'kaogong_plan_v3';
const SYNC_FILE = 'plan-sync.json';   // 云端存档文件名
const SAVE_DEBOUNCE = 800;            // 本地防抖
const PUSH_DELAY = 2500;              // 改动后多久上传云端

/* ---------- 2. 数据：优先用外部 data.json，失败回退内联 DATA ---------- */
let DATA = window.DATA_OVERRIDE || window.DATA;
let dataReady = false;

/* ---------- 3. 状态 ---------- */
let state = {};          // 打卡/用时/备注/任务清单
let dayRows = [];        // 每日行（items 为权威任务清单）
let weekRows = [];
let stageDone = {};
let stageDays = {};
let stageOf = {};
let loaded = false;      // 云端数据是否已应用

function loadState() {
  try { state = JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch (e) { state = {}; }
}
function saveState() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
}
function tip(msg) {
  const t = document.getElementById('tip');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(tip._t);
  tip._t = setTimeout(() => t.classList.remove('show'), 1600);
}

/* ---------- 4. 初始化任务清单：本地为主，云端为补充 ---------- */
function hydrateItems() {
  dayRows.forEach(d => {
    const st = state[d.date];
    if (st && Array.isArray(st.items) && st.items.length > 0) {
      // 本地已有任务清单（自己改过的），以本地为准
      d.items = st.items.slice();
    } else {
      // 首次加载，用 DATA 默认清单，并写回 state 便于云端同步
      d.items = d.items || [];
      if (st) st.items = d.items.slice(); else state[d.date] = { items: d.items.slice() };
    }
  });
}

/* ---------- 5. 工具 ---------- */
function dayKey(d) { return d.date; }
function todayKey() {
  const n = new Date();
  return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
}
function b64(s) { return btoa(unescape(encodeURIComponent(s))); }
function debounceSave() {
  clearTimeout(debounceSave._t);
  debounceSave._t = setTimeout(() => { saveState(); syncPush(); }, SAVE_DEBOUNCE);
}

/* ---------- 6. 阶段归属 ---------- */
function buildStages() {
  stageOf = {};
  DATA.stages.forEach(s => {
    const [sy, sm, sd] = s.start.split('.').map(Number);
    const [ey, em, ed] = s.end.split('.').map(Number);
    const ss = new Date(sy, sm - 1, sd), ee = new Date(ey, em - 1, ed);
    for (let d = new Date(ss); d <= ee; d.setDate(d.getDate() + 1)) {
      stageOf[d.toISOString().slice(0, 10)] = s.name;
    }
  });
  stageDays = {}; stageDone = {};
  DATA.stages.forEach(s => {
    const [sy, sm, sd] = s.start.split('.').map(Number);
    const [ey, em, ed] = s.end.split('.').map(Number);
    const days = Math.round((new Date(ey, em - 1, ed) - new Date(sy, sm - 1, sd)) / 86400000) + 1;
    stageDays[s.name] = days; stageDone[s.name] = 0;
  });
}

/* ---------- 7. 统计 ---------- */
function calc() {
  let doneDays = 0, taskDone = 0, taskTotal = 0;
  DATA.stages.forEach(s => { stageDone[s.name] = 0; });
  dayRows.forEach(d => {
    const st = state[d.date] || {};
    const items = d.items || [];
    // 勾选以本地勾选为主；文本项索引对齐 items
    const t = st.tasks || {};
    let c = 0;
    items.forEach((_, i) => { if (t[i]) c++; });
    d.pct = items.length ? Math.round(c / items.length * 100) : 0;
    taskDone += c; taskTotal += items.length;
    if (d.pct >= 100) doneDays++;
    stageDone[d.stage] = (stageDone[d.stage] || 0) + (d.pct >= 100 ? 1 : 0);
  });
  document.getElementById('stDone').textContent = doneDays;
  document.getElementById('stRate').textContent = Math.round(doneDays / dayRows.length * 100) + '%';
  document.getElementById('stTask').textContent = taskDone;
  document.getElementById('stTotal').textContent = taskTotal;
  document.getElementById('stStage').textContent = stageOf[todayKey()] || '阶段四';
  renderStages();
  document.querySelectorAll('#dayTbl tr[data-date]').forEach(tr => {
    const d = dayRows.find(x => x.date === tr.dataset.date); if (!d) return;
    const p = tr.querySelector('.pct'); if (p) p.textContent = d.pct + '%';
    tr.classList.toggle('done-row', d.pct >= 100);
    tr.classList.toggle('part-row', d.pct > 0 && d.pct < 100);
  });
}

/* ---------- 8. 阶段/节点/周计划渲染 ---------- */
function renderStages() {
  const grid = document.getElementById('stageGrid');
  grid.innerHTML = '';
  DATA.stages.forEach(s => {
    const done = stageDone[s.name] || 0, total = stageDays[s.name] || 1;
    const pct = Math.round(done / total * 100);
    grid.insertAdjacentHTML('beforeend',
      `<div class="stage-card"><div class="sn">${s.name}</div><div class="sd">${s.start} ~ ${s.end}（${total}天）</div><div class="sg">🎯 ${s.goal}</div><div class="st">✅ ${s.std}</div><div class="pbar"><div class="pl"><span>${done}/${total} 天</span><span>${pct}%</span></div><div class="track"><div class="fill" style="width:${pct}%"></div></div></div></div>`);
  });
  const bars = document.getElementById('stageBars');
  bars.innerHTML = '';
  DATA.stages.forEach(s => {
    const done = stageDone[s.name] || 0, total = stageDays[s.name] || 1, pct = Math.round(done / total * 100);
    bars.insertAdjacentHTML('beforeend', `<div class="pbar"><div class="pl"><span>${s.name}（${s.start} ~ ${s.end}）</span><span>${pct}%  ${done}/${total}</span></div><div class="track"><div class="fill" style="width:${pct}%"></div></div></div>`);
  });
}

/* ---------- 9. 每日表格渲染（任务清单从 dayRows 取，权威持久化） ---------- */
function renderDays() {
  const q = document.getElementById('qDate').value.trim();
  const fs = document.getElementById('fStage').value, ft = document.getElementById('fType').value, fd = document.getElementById('fDone').value;
  const tb = document.querySelector('#dayTbl tbody');
  const rows = dayRows.filter(d => {
    if (q && !d.date.includes(q)) return false;
    if (fs && d.stage !== fs) return false;
    if (ft && d.dtype !== ft) return false;
    if (fd === 'done' && d.pct < 100) return false;
    if (fd === 'part' && (d.pct <= 0 || d.pct >= 100)) return false;
    if (fd === 'none' && d.pct > 0) return false;
    return true;
  });
  tb.innerHTML = rows.map(d => {
    const st = state[d.date] || {};
    const t = st.tasks || {};
    const items = d.items || [];
    const cbs = items.map((it, i) => {
      const ck = t[i] ? 'checked' : '';
      const dl = t[i] ? 'done' : '';
      return `<li class="${dl}"><input type="checkbox" data-d="${d.date}" data-i="${i}" ${ck}><span>${escapeHtml(it)}</span></li>`;
    }).join('');
    const rowCls = d.pct >= 100 ? 'done-row' : (d.pct > 0 ? 'part-row' : '');
    const tagTxt = d.ms ? `<span class="tag lc">节点</span> ${d.ms}` : (d.tag ? `<span class="tag ${d.tag}">${d.dtype}</span>` : d.dtype);
    return `<tr class="${rowCls}" data-date="${d.date}"><td>${d.date}</td><td>${d.wk}</td><td>${d.stage}</td><td>${tagTxt}</td><td style="font-size:11px;">${d.ms || '—'}</td><td><div class="taskbox"><ul>${cbs}</ul></div></td><td class="pct">${d.pct}%</td><td><input class="mini-note" type="number" min="0" max="12" step="0.5" placeholder="h" data-h="${d.date}" value="${st.hours || ''}"></td><td><input class="mini-note" placeholder="备注" data-n="${d.date}" value="${st.note || ''}"></td><td style="text-align:center;white-space:nowrap;"><button class="mini-note" title="编辑当天任务" onclick="editDay('${d.date}')" style="cursor:pointer;background:#fff;border-color:#90caf9;color:#1565c0;">✎</button> <button class="mini-note" title="删除当天" onclick="delDay('${d.date}')" style="cursor:pointer;background:#fff;border-color:#ef9a9a;color:#c62828;">✕</button> <button class="mini-note" title="恢复当天初始任务" onclick="resetDayTasks('${d.date}')" style="cursor:pointer;background:#fff;border-color:#ef9a9a;color:#c62828;">↺</button></td></tr>`;
  }).join('');
  bindChecks();
  bindInputs();
  bindEditTap();
  ensureCellLabels();
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

/* ---------- 10. 事件绑定 ---------- */
function bindChecks() {
  document.querySelectorAll('#dayTbl input[type=checkbox]').forEach(cb => {
    cb.onchange = () => {
      const d = cb.dataset.d, i = +cb.dataset.i;
      state[d] = state[d] || {}; state[d].tasks = state[d].tasks || {};
      state[d].tasks[i] = cb.checked;
      const li = cb.closest('li'); if (cb.checked) li.classList.add('done'); else li.classList.remove('done');
      calc(); debounceSave(); tip('已保存');
    };
  });
}
function bindInputs() {
  document.querySelectorAll('#dayTbl input[data-h]').forEach(inp => {
    inp.onchange = () => { state[inp.dataset.h] = state[inp.dataset.h] || {}; state[inp.dataset.h].hours = inp.value; calc(); debounceSave(); };
  });
  document.querySelectorAll('#dayTbl input[data-n]').forEach(inp => {
    inp.onchange = () => { state[inp.dataset.n] = state[inp.dataset.n] || {}; state[inp.dataset.n].note = inp.value; calc(); debounceSave(); };
  });
}
// 手机端：点任务文字即进入多行编辑（替代难用的双击/prompt）
function bindEditTap() {
  document.querySelectorAll('#dayTbl tbody .taskbox li span').forEach(sp => {
    if (sp.dataset.tap === '1') return;
    sp.dataset.tap = '1';
    sp.style.cursor = 'pointer';
    sp.title = '点击修改任务（可换行）；留空则删除该项';
    sp.onclick = function () {
      const cb = sp.parentElement.querySelector('input');
      editDay(cb.dataset.d, +cb.dataset.i);
    };
  });
}

/* ---------- 11. 编辑任务：多行 textarea，一行一条，允许换行 ---------- */
function openEditor(dateStr, focusIdx) {
  const row = dayRows.find(x => x.date === dateStr); if (!row) return;
  const ta = document.getElementById('taskEditor');
  const title = document.getElementById('taskEditorTitle');
  ta.value = (row.items || []).join('\n');
  ta.dataset.date = dateStr;
  title.textContent = '编辑 ' + dateStr + ' 的任务（每行一项，回车换行）';
  document.getElementById('taskEditorMask').style.display = 'block';
  document.getElementById('taskEditorBox').style.display = 'block';
  setTimeout(() => {
    ta.focus();
    if (typeof focusIdx === 'number' && row.items[focusIdx] !== undefined) {
      let pos = 0;
      for (let i = 0; i < focusIdx; i++) pos += (row.items[i].length + 1);
      ta.setSelectionRange(pos, pos + row.items[focusIdx].length);
    } else {
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
  }, 50);
}
window.editDay = function (dateStr, focusIdx) { openEditor(dateStr, focusIdx); };
window.closeTaskEditor = function () {
  document.getElementById('taskEditorMask').style.display = 'none';
  document.getElementById('taskEditorBox').style.display = 'none';
};
window.saveTaskEditor = function () {
  const ta = document.getElementById('taskEditor');
  const dateStr = ta.dataset.date;
  const arr = ta.value.split('\n').map(s => s.trim()).filter(Boolean);
  const row = dayRows.find(x => x.date === dateStr); if (!row) { closeTaskEditor(); return; }
  const oldItems = row.items || [];
  const oldTasks = (state[dateStr] && state[dateStr].tasks) || {};
  // 按文字匹配迁移勾选，并保留新清单到 state.items
  const nt = {};
  arr.forEach((txt, ni) => {
    let inh = false;
    for (let j = 0; j < oldItems.length; j++) { if (oldItems[j] === txt && oldTasks[j]) { inh = true; break; } }
    nt[ni] = inh;
  });
  row.items = arr;
  state[dateStr] = state[dateStr] || {};
  state[dateStr].items = arr.slice();   // 关键：持久化任务清单
  state[dateStr].tasks = nt;
  calc(); saveState(); renderDays(); syncPush();
  closeTaskEditor();
  tip('已保存 ' + arr.length + ' 项任务');
};

/* ---------- 12. 新增/删除/恢复 ---------- */
window.delDay = function (dateStr) {
  showConfirm('删除当天', '确定删除 <b>' + dateStr + '</b> 这一天的计划吗？该天打卡记录会一并清除。', () => {
    const idx = dayRows.findIndex(x => x.date === dateStr);
    if (idx < 0) return;
    dayRows.splice(idx, 1);
    delete state[dateStr];
    calc(); saveState(); renderDays(); syncPush();
    tip('已删除 ' + dateStr);
  });
};
window.addNewDay = function () {
  const last = dayRows[dayRows.length - 1];
  const next = new Date(last.date);
  next.setDate(next.getDate() + 1);
  const dateStr = next.toISOString().slice(0, 10);
  const row = { date: dateStr, wk: '待定', dtype: '标准工作日', tag: '', stage: last.stage, ms: '', items: ['（新一天）点击 ✎ 编辑任务清单'], pct: 0 };
  dayRows.push(row);
  state[dateStr] = { items: row.items.slice() };
  calc(); saveState(); renderDays(); syncPush();
  tip('已新增 ' + dateStr);
  editDay(dateStr);
};
window.resetDayTasks = function (dateStr) {
  const src = DATA.days.find(x => x.date === dateStr);
  const row = dayRows.find(x => x.date === dateStr);
  if (!src || !row) return;
  showConfirm('恢复当天初始任务', '确定恢复 <b>' + dateStr + '</b> 的原始任务清单吗？当天打卡进度会尽量保留。', () => {
    const oldItems = row.items;
    const oldTasks = (state[dateStr] && state[dateStr].tasks) || {};
    row.items = src.items.slice();
    state[dateStr] = state[dateStr] || {};
    state[dateStr].items = row.items.slice();
    const nt = {};
    row.items.forEach((txt, i) => {
      let inh = false;
      for (let j = 0; j < oldItems.length; j++) { if (oldItems[j] === txt && oldTasks[j]) { inh = true; break; } }
      nt[i] = inh;
    });
    state[dateStr].tasks = nt;
    calc(); saveState(); renderDays(); syncPush();
    tip('已恢复 ' + dateStr + ' 的初始任务');
  });
};
window.resetAllTasks = function () {
  showConfirm('恢复初始任务', '确定<b>恢复全部 409 天的初始任务清单</b>吗？<br>· 改动过的任务文字将还原成最初版本<br>· 打卡勾选进度、用时、备注会保留', () => {
    DATA.days.forEach(src => {
      const row = dayRows.find(x => x.date === src.date);
      if (!row) return;
      const oldItems = row.items;
      const oldTasks = (state[src.date] && state[src.date].tasks) || {};
      row.items = src.items.slice();
      state[src.date] = state[src.date] || {};
      state[src.date].items = row.items.slice();
      const nt = {};
      row.items.forEach((txt, i) => {
        let inh = false;
        for (let j = 0; j < oldItems.length; j++) { if (oldItems[j] === txt && oldTasks[j]) { inh = true; break; } }
        nt[i] = inh;
      });
      state[src.date].tasks = nt;
    });
    calc(); saveState(); renderDays(); syncPush();
    tip('已恢复全部初始任务清单');
  });
};

/* ---------- 13. 手机端标签 ---------- */
function ensureCellLabels() {
  if (window.innerWidth > 768) return;
  const labels = ['日期', '星期', '阶段', '类型', '节点', '任务', '完成度', '用时', '备注', '操作'];
  document.querySelectorAll('#dayTbl tbody tr').forEach(tr => {
    tr.querySelectorAll('td').forEach((td, i) => { if (!td.dataset.l) td.dataset.l = labels[i] || ''; });
  });
}

/* ---------- 14. 定位到今天 ---------- */
function scrollToToday() {
  const key = todayKey();
  const rows = document.querySelectorAll('#dayTbl tbody tr');
  let target = null;
  rows.forEach(tr => { if ((tr.dataset.date || '') === key) target = tr; });
  if (target) {
    if (typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'center' });
  } else {
    // 兜底：找第一条不晚于今天的行
    let best = null;
    rows.forEach(tr => { if ((tr.dataset.date || '9') <= key) best = tr; });
    if (best && typeof best.scrollIntoView === 'function') best.scrollIntoView({ block: 'center' });
  }
}
window.backToToday = function () { scrollToToday(); tip('已定位到今天'); };

/* ---------- 15. 导入/导出 ---------- */
window.exportData = function () {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = '考公计划进度备份.json'; a.click(); tip('已导出备份');
};
function importData(file) {
  const reader = new FileReader();
  reader.onload = function (ev) {
    let raw;
    try { raw = JSON.parse(ev.target.result); } catch (e) { tip('导入失败：文件不是合法的 JSON'); return; }
    if (!raw || typeof raw !== 'object') { tip('导入失败：文件内容格式不正确'); return; }
    const incoming = (raw.state && typeof raw.state === 'object') ? raw.state : raw;
    let nDay = 0, nTask = 0;
    Object.keys(incoming).forEach(date => {
      const day = incoming[date];
      if (!day || typeof day !== 'object') return;
      state[date] = state[date] || {};
      if (Array.isArray(day.items) && day.items.length) { state[date].items = day.items.slice(); nDay++; }
      if (day.tasks && typeof day.tasks === 'object') {
        const old = state[date].tasks || {};
        const merged = {};
        Object.keys(day.tasks).forEach(i => { merged[i] = day.tasks[i] === true; if (merged[i]) nTask++; });
        Object.keys(old).forEach(i => { if (merged[i] === undefined) merged[i] = old[i] === true; });
        state[date].tasks = merged;
      }
      if (day.hours !== undefined && day.hours !== null && day.hours !== '') state[date].hours = day.hours;
      if (day.note !== undefined && day.note !== null) state[date].note = String(day.note);
    });
    hydrateItems(); calc(); saveState(); renderDays(); syncPush();
    tip('已导入 ' + nDay + ' 天、恢复 ' + nTask + ' 项勾选');
  };
  reader.onerror = function () { tip('导入失败：读取文件出错'); };
  reader.readAsText(file, 'UTF-8');
}
window.clearAll = function () {
  if (confirm('确定清空全部打卡记录？此操作不可恢复！')) {
    localStorage.removeItem(STORE_KEY); state = {};
    hydrateItems(); calc(); saveState(); renderDays(); syncPush();
    tip('已清空全部记录');
  }
};

/* ---------- 16. 周计划 ---------- */
function renderWeek() {
  ensureCellLabels();
  const tb = document.querySelector('#weekTbl tbody');
  tb.innerHTML = weekRows.map(r => `<tr><td>${r.w}</td><td>${r.range}</td><td>${r.duty}</td><td><b>${r.theme}</b></td><td style="font-size:11px;">${r.task}</td><td style="font-size:11px;color:#2e7d32;">${r.std}</td></tr>`).join('');
}

/* ---------- 17. 标签页 ---------- */
window.switchTab = function (name) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tabs button').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  document.getElementById('tabBtn-' + name).classList.add('active');
  if (name === 'daily') setTimeout(scrollToToday, 50);
};

/* ---------- 18. 云端同步（多端） ---------- */
const Sync = (function () {
  let cfg = null, sha = null, timer = null, saving = false, lastCfgStr = '';
  function loadCfg() { try { cfg = JSON.parse(localStorage.getItem('cloudConfig') || 'null'); } catch (e) { cfg = null; } return !!cfg; }
  function b64d(s) { try { return decodeURIComponent(escape(atob(s.replace(/\n/g, '')))); } catch (e) { return ''; } }
  function gh(method, body) {
    if (!cfg) return Promise.reject('no config');
    return fetch(`https://api.github.com/repos/${cfg.user}/${cfg.repo}/contents/${SYNC_FILE}?ref=${cfg.branch}`, {
      method: method,
      headers: { 'Authorization': 'token ' + cfg.token, 'Content-Type': 'application/json', 'Accept': 'application/vnd.github.v3+json' },
      body: body ? JSON.stringify(body) : undefined
    }).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
  function collect() {
    // 只同步需要跨端的内容，data.json 内的大段默认清单不重复存
    const out = {};
    Object.keys(state).forEach(k => {
      const v = state[k];
      if (!v || typeof v !== 'object') return;
      const o = {};
      if (Array.isArray(v.items) && v.items.length) o.items = v.items;
      if (v.tasks && Object.keys(v.tasks).length) o.tasks = v.tasks;
      if (v.hours !== undefined && v.hours !== '') o.hours = v.hours;
      if (v.note !== undefined && v.note !== '') o.note = v.note;
      if (Object.keys(o).length) out[k] = o;
    });
    return out;
  }
  function applyRemote(remote) {
    let n = 0;
    Object.keys(remote).forEach(k => {
      const r = remote[k]; if (!r || typeof r !== 'object') return;
      state[k] = state[k] || {};
      if (Array.isArray(r.items) && r.items.length) { state[k].items = r.items; n++; }
      if (r.tasks && typeof r.tasks === 'object') {
        state[k].tasks = state[k].tasks || {};
        Object.keys(r.tasks).forEach(i => { state[k].tasks[i] = r.tasks[i] === true; });
      }
      if (r.hours !== undefined) state[k].hours = r.hours;
      if (r.note !== undefined) state[k].note = r.note;
    });
    return n;
  }
  function push() {
    if (!cfg || saving) return;
    saving = true;
    const content = b64(JSON.stringify(collect()));
    const body = sha ? { message: 'sync ' + new Date().toISOString(), content: content, sha: sha, branch: cfg.branch }
                     : { message: 'init sync', content: content, branch: cfg.branch };
    gh('PUT', body).then(d => { sha = d.content.sha; console.log('[sync] 已上传'); })
      .catch(e => { if (String(e).indexOf('409') > -1) { sha = null; push(); } else console.warn('[sync] 上传失败', e); })
      .finally(() => { saving = false; });
  }
  function pull() {
    if (!cfg) return;
    gh('GET').then(d => {
      sha = d.sha;
      const remote = JSON.parse(b64d(d.content));
      const n = applyRemote(remote);
      if (n > 0) { console.log('[sync] 拉取 ' + n + ' 天'); hydrateItems(); calc(); renderDays(); }
    }).catch(e => { if (String(e).indexOf('404') === -1) console.warn('[sync] 拉取失败', e); });
  }
  function schedulePush() { clearTimeout(timer); timer = setTimeout(push, PUSH_DELAY); }
  // 对外
  function init() {
    if (!loadCfg()) return;
    pull();
    setTimeout(push, PUSH_DELAY);   // 先拉后推，保证合并
  }
  function getCfg() { return cfg; }
  function setCfg(c) {
    cfg = c; lastCfgStr = JSON.stringify(c);
    try { localStorage.setItem('cloudConfig', JSON.stringify(c)); } catch (e) { }
  }
  return { init, push: schedulePush, pull, getCfg, setCfg };
})();
window.cloudSync = { push: () => Sync.push(), pull: () => Sync.pull() };
window.showCloudConfig = function () {
  const m = document.getElementById('cloudMask'), b = document.getElementById('cloudBox');
  if (!m || !b) { alert('云端配置弹窗元素不存在！'); return; }
  m.style.display = 'block'; b.style.display = 'block';
  const c = Sync.getCfg() || {};
  if (document.getElementById('cloudToken')) document.getElementById('cloudToken').value = c.token || '';
  if (document.getElementById('cloudUser')) document.getElementById('cloudUser').value = c.user || '';
  if (document.getElementById('cloudRepo')) document.getElementById('cloudRepo').value = c.repo || 'kaogong-plan';
  if (document.getElementById('cloudBranch')) document.getElementById('cloudBranch').value = c.branch || 'main';
};
window.closeCloudConfig = function () {
  const m = document.getElementById('cloudMask'), b = document.getElementById('cloudBox');
  if (m) m.style.display = 'none'; if (b) b.style.display = 'none';
};
window.saveCloudConfig = async function () {
  const token = document.getElementById('cloudToken').value.trim();
  const user = document.getElementById('cloudUser').value.trim();
  const repo = document.getElementById('cloudRepo').value.trim();
  const branch = document.getElementById('cloudBranch').value.trim() || 'main';
  const st = document.getElementById('cloudStatus');
  if (!token || !user || !repo) { if (st) st.innerHTML = '<span style="color:#c62828;">✗ 请填写完整信息</span>'; return; }
  Sync.setCfg({ token, user, repo, branch });
  if (st) st.innerHTML = '<span style="color:#2e7d32;">连接测试中…</span>';
  try {
    const res = await fetch(`https://api.github.com/repos/${user}/${repo}`, { headers: { 'Authorization': 'token ' + token, 'Accept': 'application/vnd.github.v3+json' } });
    if (!res.ok) throw new Error('仓库访问失败 HTTP ' + res.status);
    const d = await res.json();
    if (!d.permissions || !d.permissions.push) throw new Error('该 Token 没有此仓库的写权限');
    if (st) st.innerHTML = '<span style="color:#2e7d32;">✓ 连接成功！云端多端同步已开启</span>';
    Sync.pull();
  } catch (e) {
    if (st) st.innerHTML = '<span style="color:#c62828;">✗ ' + e.message + '</span>';
  }
};

/* ---------- 19. 通用确认弹窗 ---------- */
let confirmCb = null;
function showConfirm(title, html, ok) {
  document.getElementById('confirmTitle').innerHTML = title;
  document.getElementById('confirmBody').innerHTML = html;
  document.getElementById('confirmMask').classList.add('show');
  document.getElementById('confirmBox').classList.add('show');
  confirmCb = ok;
}
window.confirmOk = function () { closeConfirm(); if (confirmCb) confirmCb(); };
window.confirmCancel = closeConfirm;
function closeConfirm() {
  document.getElementById('confirmMask').classList.remove('show');
  document.getElementById('confirmBox').classList.remove('show');
  confirmCb = null;
}

/* ---------- 20. 启动 ---------- */
function boot() {
  if (!window.DATA) { console.error('数据未加载，请检查 data.json 是否可访问'); return; }
  DATA = window.DATA;
  dataReady = true;
  loadState();
  weekRows = DATA.weekly.map(w => ({ w: w.w, range: w.range, duty: w.duty, theme: w.theme, task: w.task, std: w.std }));
  dayRows = DATA.days.map(d => ({ date: d.date, wk: d.wk, dtype: d.dtype, tag: d.tag, stage: d.stage, ms: d.ms, items: (d.items || []).slice(), pct: 0 }));
  buildStages();
  hydrateItems();

  // 关键节点
  document.getElementById('msList').innerHTML = '';
  DATA.milestones.forEach(m => {
    document.getElementById('msList').insertAdjacentHTML('beforeend', `<li><span class="md">${m.date}</span><span><span class="mt">${m.title}</span><br><span style="color:#666;">目标：${m.goal} ｜ ${m.note}</span></span></li>`);
  });

  // 阶段筛选
  document.getElementById('fStage').innerHTML = '<option value="">全部阶段</option>';
  DATA.stages.forEach(s => { document.getElementById('fStage').insertAdjacentHTML('beforeend', `<option value="${s.name}">${s.name}</option>`); });

  // 排序
  let daySort = { k: 'date', asc: true };
  document.querySelectorAll('#dayTbl th').forEach(th => {
    th.onclick = () => {
      const k = th.dataset.k; if (!k) return;
      if (daySort.k === k) daySort.asc = !daySort.asc; else { daySort.k = k; daySort.asc = true; }
      dayRows.sort((a, b) => { let va = a[k], vb = b[k]; if (k === 'pct') { va = a.pct; vb = b.pct; } if (va == null) va = ''; if (vb == null) vb = ''; return (va > vb ? 1 : -1) * (daySort.asc ? 1 : -1); });
      renderDays();
    };
  });
  let weekSort = { k: 'w', asc: true };
  document.querySelectorAll('#weekTbl th').forEach(th => {
    th.onclick = () => {
      const k = th.dataset.k; if (!k) return;
      if (weekSort.k === k) weekSort.asc = !weekSort.asc; else { weekSort.k = k; weekSort.asc = true; }
      weekRows.sort((a, b) => { const va = a[k], vb = b[k]; return (va > vb ? 1 : -1) * (weekSort.asc ? 1 : -1); });
      renderWeek();
    };
  });

  // 筛选
  ['qDate', 'fStage', 'fType', 'fDone'].forEach(id => document.getElementById(id).addEventListener('input', renderDays));

  // 导入
  document.getElementById('importFile').addEventListener('change', function (e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!confirm('确定导入「' + file.name + '」的打卡进度吗？')) { e.target.value = ''; return; }
    importData(file); e.target.value = '';
  });

  renderWeek();
  renderDays();
  calc();
  scrollToToday();
  Sync.init();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
})();
