(function(){
'use strict';
/* 考公计划表 · 云端同步模块
   每个浏览器首次使用时点 ☁ 云端同步 配置一次即可（Token 存在本机 localStorage，不硬编码）。
   Token 建议用 GitHub Fine-grained token，仅授权当前仓库 Contents:Read and Write。 */

let cloudCfg = null;
let cloudSha = null;
const KEY = 'cloudConfig';
const CD = 1500;
let timer = null;
let saving = false;
let isPulling = false;

function loadCfg(){
  try { cloudCfg = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch(e) {}
  return !!cloudCfg;
}

function collect(){
  const out = {};
  for (let i = 0; i < localStorage.length; i++){
    const k = localStorage.key(i);
    if (!k || k === KEY) continue;
    try { out[k] = JSON.parse(localStorage.getItem(k)); }
    catch(e){ out[k] = localStorage.getItem(k); }
  }
  return out;
}
const b64 = s => btoa(unescape(encodeURIComponent(s)));

function gh(method, path, body){
  if (!cloudCfg) return Promise.reject('no config');
  return fetch(
    `https://api.github.com/repos/${cloudCfg.user}/${cloudCfg.repo}/contents/${path}?ref=${cloudCfg.branch}`,
    {
      method,
      headers: {
        'Authorization': 'token ' + cloudCfg.token,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json'
      },
      body: body ? JSON.stringify(body) : undefined
    }
  ).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
}

function push(){
  if (!cloudCfg || !cloudCfg.token || saving) return;
  saving = true;
  const content = b64(JSON.stringify(collect()));
  const body = cloudSha
    ? { message: 'sync ' + new Date().toISOString(), content, sha: cloudSha, branch: cloudCfg.branch }
    : { message: 'init progress', content, branch: cloudCfg.branch };
  gh('PUT', 'progress.json', body)
    .then(d => { cloudSha = d.content.sha; console.log('[cloud] 已上传'); })
    .catch(e => {
      if (String(e).indexOf('409') > -1){ cloudSha = null; push(); }
      else console.warn('[cloud] 上传失败', e);
    })
    .finally(() => { saving = false; });
}

function pull(){
  if (!cloudCfg) return;
  isPulling = true;
  gh('GET', 'progress.json')
    .then(d => {
      cloudSha = d.sha;
      const remote = JSON.parse(decodeURIComponent(escape(atob(d.content.replace(/\n/g,'')))));
      let changed = 0;
      for (const k in remote){
        if (k === KEY) continue;
        const v = (typeof remote[k] === 'string') ? remote[k] : JSON.stringify(remote[k]);
        if (localStorage.getItem(k) !== v){ _origSet(k, v); changed++; }
      }
      if (changed > 0){
        console.log('[cloud] 拉取了 ' + changed + ' 项');
        if (typeof renderDays === 'function') renderDays();
        if (typeof renderStages === 'function') renderStages();
      }
      setTimeout(()=>{ isPulling = false; }, 500);
    })
    .catch(e => { console.warn('[cloud] 拉取失败', e); isPulling = false; });
}

function schedulePush(){
  clearTimeout(timer);
  timer = setTimeout(push, CD);
}

/* 云端配置弹窗 */
window.showCloudConfig = function(){
  const m = document.getElementById('cloudMask');
  const b = document.getElementById('cloudBox');
  if (!m || !b){ alert('弹窗元素不存在！'); return; }
  m.style.display = 'block'; b.style.display = 'block';
  if (cloudCfg){
    const t = document.getElementById('cloudToken');
    const u = document.getElementById('cloudUser');
    const r = document.getElementById('cloudRepo');
    const br = document.getElementById('cloudBranch');
    if (t) t.value = cloudCfg.token || '';
    if (u) u.value = cloudCfg.user || '';
    if (r) r.value = cloudCfg.repo || '';
    if (br) br.value = cloudCfg.branch || 'main';
  }
};
window.closeCloudConfig = function(){
  const m = document.getElementById('cloudMask');
  const b = document.getElementById('cloudBox');
  if (m) m.style.display = 'none';
  if (b) b.style.display = 'none';
};
window.pullCloud = function(){ pull(); };
window.pushCloud = function(){ push(); };

window.saveCloudConfig = async function(){
  const token = document.getElementById('cloudToken').value.trim();
  const user  = document.getElementById('cloudUser').value.trim();
  const repo  = document.getElementById('cloudRepo').value.trim();
  const branch= document.getElementById('cloudBranch').value.trim() || 'main';
  const st = document.getElementById('cloudStatus');
  if (!token || !user || !repo){
    if (st) st.innerHTML = '<span style="color:#c62828;">✗ 请填写完整信息</span>';
    return;
  }
  cloudCfg = { token, user, repo, branch };
  try { localStorage.setItem(KEY, JSON.stringify(cloudCfg)); } catch(e){}
  if (st) st.innerHTML = '<span style="color:#2e7d32;">测试中...</span>';
  try {
    const res = await fetch(
      `https://api.github.com/repos/${user}/${repo}/contents/progress.json?ref=${branch}`,
      { headers: { 'Authorization': 'token ' + token, 'Accept': 'application/vnd.github.v3+json' } }
    );
    if (res.status === 200){
      const d = await res.json();
      cloudSha = d.sha;
      const p = JSON.parse(atob(d.content.replace(/\n/g,'')));
      if (st) st.innerHTML = '<span style="color:#2e7d32;">✓ 连接成功！云端有 ' + Object.keys(p).length + ' 条记录</span>';
      isPulling = true;
      gh('GET', 'progress.json').then(dd => {
        cloudSha = dd.sha;
        const remote = JSON.parse(decodeURIComponent(escape(atob(dd.content.replace(/\n/g,'')))));
        for (const k in remote){ if (k !== KEY) _origSet(k, typeof remote[k]==='string'?remote[k]:JSON.stringify(remote[k])); }
        if (typeof renderDays === 'function') renderDays();
        if (typeof renderStages === 'function') renderStages();
        setTimeout(()=>{ isPulling = false; }, 500);
      });
    } else if (res.status === 404){
      if (st) st.innerHTML = '<span style="color:#2e7d32;">✓ 连接成功！首次使用，打卡后将自动创建 progress.json</span>';
    } else throw new Error('HTTP ' + res.status);
  } catch(e){
    if (st) st.innerHTML = '<span style="color:#c62828;">✗ 连接失败：' + e.message + '</span>';
  }
};

window.cloudSync = { push, pull, forceSync: push };

/* 劫持 localStorage.setItem：本地写入后自动上传（云端拉取期间不触发） */
const _origSet = localStorage.setItem.bind(localStorage);
localStorage.setItem = function(k, v){
  _origSet(k, v);
  if (k === KEY){ cloudCfg = JSON.parse(v); return; }
  if (isPulling) return;
  schedulePush();
};

function init(){
  if (!loadCfg()){ console.log('[cloud] 未配置云端，跳过同步'); return; }
  pull();
  setTimeout(push, 3000);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
})();
