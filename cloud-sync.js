(function(){
'use strict';

let cloudCfg = null;
let cloudSha = null;
const KEY = 'cloudConfig';
const CD = 1500; // 防抖延迟 1.5 秒
let timer = null;
let saving = false;

// ===== 读取配置 =====
function loadCfg(){
  try { cloudCfg = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch(e) {}
  return !!cloudCfg;
}

// ===== 收集所有本地进度数据 =====
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

// ===== base64 编码 =====
function b64(s){ return btoa(unescape(encodeURIComponent(s))); }

// ===== GitHub API 封装 =====
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

// ===== 上传到云端 =====
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

// ===== 从云端拉取 =====
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
        console.log('[cloud] 拉取了 ' + changed + ' 项，刷新页面…');
        if (typeof renderDays === 'function') renderDays();
        if (typeof renderStages === 'function') renderStages();
      } else {
        console.log('[cloud] 已是最新');
      }
    })
    .catch(e => console.warn('[cloud] 拉取失败', e));
}

// ===== 防抖上传 =====
function schedulePush(){
  clearTimeout(timer);
  timer = setTimeout(push, CD);
}

// ===== 暴露给控制台 =====
window.cloudSync = { push, pull, forceSync: push };

// ===== 拦截 localStorage 写入自动同步 =====
const _origSet = localStorage.setItem.bind(localStorage);
localStorage.setItem = function(k, v){
  _origSet(k, v);
  if (k === KEY) { cloudCfg = JSON.parse(v); return; }
  schedulePush();
};

// ===== 页面加载完成：读配置 → 拉取 =====
function init(){
  if (!loadCfg()){ console.log('[cloud] 未配置云端，跳过同步'); return; }
  pull();
}

if (document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

})();
