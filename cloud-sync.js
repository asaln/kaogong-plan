(function(){
'use strict';

let cloudCfg = null;
let cloudSha = null;
const KEY = 'cloudConfig';
const CD = 1500;
let timer = null;
let saving = false;

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

function b64(s){ return btoa(unescape(encodeURIComponent(s))); }

function gh(method, path, body){
  if (!cloudCfg) return Promise.reject('no config');
  return fetch(
    `https://api.github.com/repos/${cloudCfg.user}/${cloudCfg.repo}/contents/${path}?ref=${cloudCfg.branch}`,
    {
      method: method,
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
    ? { message: 'sync ' + new Date().toISOString(), content: content, sha: cloudSha, branch: cloudCfg.branch }
    : { message: 'init progress', content: content, branch: cloudCfg.branch };
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
  gh('GET', 'progress.json')
    .then(d => {
      cloudSha = d.sha;
      const remote = JSON.parse(decodeURIComponent(escape(atob(d.content.replace(/\n/g, '')))));
      let changed = 0;
      for (const k in remote){
        if (k === KEY) continue;
        const v = (typeof remote[k] === 'string') ? remote[k] : JSON.stringify(remote[k]);
        if (localStorage.getItem(k) !== v){ localStorage.setItem(k, v); changed++; }
      }
      if (changed > 0){
        console.log('[cloud] 拉取了 ' + changed + ' 项');
        if (typeof renderDays === 'function') renderDays();
        if (typeof renderStages === 'function') renderStages();
      }
    })
    .catch(e => console.warn('[cloud] 拉取失败', e));
}

function schedulePush(){
  clearTimeout(timer);
  timer = setTimeout(push, CD);
}

// ===== 弹窗 =====
window.showCloudConfig = function() {
  console.log('[cloud] showCloudConfig called');
  var m = document.getElementById('cloudMask');
  var b = document.getElementById('cloudBox');
  console.log('[cloud] mask:', m, 'box:', b);
  if (!m || !b) { alert('弹窗元素不存在！mask=' + !!m + ' box=' + !!b); return; }
  m.style.display = 'block';
  b.style.display = 'block';
  if (cloudCfg) {
    var t = document.getElementById('cloudToken');
    var u = document.getElementById('cloudUser');
    var r = document.getElementById('cloudRepo');
    var br = document.getElementById('cloudBranch');
    if (t) t.value = cloudCfg.token || '';
    if (u) u.value = cloudCfg.user || '';
    if (r) r.value = cloudCfg.repo || '';
    if (br) br.value = cloudCfg.branch || 'main';
  }
};

window.closeCloudConfig = function() {
  var m = document.getElementById('cloudMask');
  var b = document.getElementById('cloudBox');
  if (m) m.style.display = 'none';
  if (b) b.style.display = 'none';
};

window.saveCloudConfig = async function() {
  var token = document.getElementById('cloudToken').value.trim();
  var user  = document.getElementById('cloudUser').value.trim();
  var repo  = document.getElementById('cloudRepo').value.trim();
  var branch= document.getElementById('cloudBranch').value.trim() || 'main';
  var st = document.getElementById('cloudStatus');

  if (!token || !user || !repo) {
    if (st) st.innerHTML = '<span style="color:#c62828;">✗ 请填写完整信息</span>';
    return;
  }

  cloudCfg = { token: token, user: user, repo: repo, branch: branch };
  try { localStorage.setItem(KEY, JSON.stringify(cloudCfg)); } catch(e) {}

  if (st) st.innerHTML = '<span style="color:#2e7d32;">测试中...</span>';

  try {
    var res = await fetch(
      'https://api.github.com/repos/' + user + '/' + repo + '/contents/progress.json?ref=' + branch,
      { headers: { 'Authorization': 'token ' + token, 'Accept': 'application/vnd.github.v3+json' } }
    );
    if (res.status === 200) {
      var d = await res.json();
      cloudSha = d.sha;
      var p = JSON.parse(atob(d.content.replace(/\n/g,'')));
      if (st) st.innerHTML = '<span style="color:#2e7d32;">✓ 连接成功！云端有 ' + Object.keys(p).length + ' 条记录</span>';
      loadCfg();
      pull();
    } else if (res.status === 404) {
      if (st) st.innerHTML = '<span style="color:#2e7d32;">✓ 连接成功！首次使用，打卡后将自动创建文件</span>';
    } else {
      throw new Error('HTTP ' + res.status);
    }
  } catch(e) {
    if (st) st.innerHTML = '<span style="color:#c62828;">✗ 连接失败：' + e.message + '</span>';
  }
};

window.cloudSync = { push: push, pull: pull, forceSync: push };

const _origSet = localStorage.setItem.bind(localStorage);
localStorage.setItem = function(k, v){
  _origSet(k, v);
  if (k === KEY) { cloudCfg = JSON.parse(v); return; }
  schedulePush();
};

function init(){
  if (!loadCfg()){ console.log('[cloud] 未配置云端'); return; }
  pull();
}

if (document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

})();
