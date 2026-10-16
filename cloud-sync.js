(function(){
'use strict';

/* ===== 配置：在这里填你自己的信息 ===== */
const CONFIG = {
  token:  "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",
  user:   "asaln",
  repo:   "kaogong-plan",
  branch: "main",
  path:   "progress.json"
};
/* ===================================== */

const KEY = 'kaogong_plan_cloud_v1';
const CD  = 1500;                 // 本地改动后多久上传
let timer = null, saving = false, lastSha = null;

/* ---- 自动把配置写入 localStorage ---- */
function applyConfig(){
  localStorage.setItem('cloudConfig', JSON.stringify({
    token: CONFIG.token, user: CONFIG.user,
    repo: CONFIG.repo, branch: CONFIG.branch
  }));
}

/* ---- 读：本地存了什么就同步什么 ---- */
function collect(){
  const out = {};
  for (let i = 0; i < localStorage.length; i++){
    const k = localStorage.key(i);
    if (!k) continue;
    try { out[k] = JSON.parse(localStorage.getItem(k)); }
    catch(e){ out[k] = localStorage.getItem(k); }
  }
  return out;
}

/* ---- 写：把云端数据写回 localStorage ---- */
function applyRemote(obj){
  let changed = 0;
  for (const k in obj){
    const v = (typeof obj[k] === 'string') ? obj[k] : JSON.stringify(obj[k]);
    if (localStorage.getItem(k) !== v){ localStorage.setItem(k, v); changed++; }
  }
  return changed;
}

/* ---- GitHub REST 封装 ---- */
function gh(method, body){
  return fetch(
    `https://api.github.com/repos/${CONFIG.user}/${CONFIG.repo}/contents/${CONFIG.path}?ref=${CONFIG.branch}`,
    {
      method: method,
      headers: {
        'Authorization': 'token ' + CONFIG.token,
        'Content-Type':  'application/json',
        'Accept':        'application/vnd.github.v3+json'
      },
      body: body ? JSON.stringify(body) : undefined
    }
  ).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
}

function b64(s){ return btoa(unescape(encodeURIComponent(s))); }

/* ---- 上传 ---- */
function push(){
  if (saving) return;
  saving = true;
  const content = b64(JSON.stringify(collect(), null, 0));
  const body = lastSha
    ? { message: 'chore: sync progress', content: content, sha: lastSha, branch: CONFIG.branch }
    : { message: 'chore: init progress', content: content, branch: CONFIG.branch };
  gh('PUT', body)
    .then(d => { lastSha = d.content.sha; console.log('[cloud] 已上传'); })
    .catch(e => {
      if (String(e).indexOf('409') > -1){ lastSha = null; push(); }   // 冲突，重试
      else console.warn('[cloud] 上传失败', e);
    })
    .finally(() => { saving = false; });
}

/* ---- 下载 ---- */
function pull(){
  gh('GET')
    .then(d => {
      lastSha = d.sha;
      const remote = JSON.parse(decodeURIComponent(escape(atob(d.content.replace(/\n/g, '')))));
      const n = applyRemote(remote);
      if (n > 0){
        console.log('[cloud] 拉取并写入 ' + n + ' 项，正在刷新…');
        if (typeof renderDays === 'function') renderDays();
        if (typeof renderStages === 'function') renderStages();
      } else {
        console.log('[cloud] 已是最新');
      }
    })
    .catch(e => console.warn('[cloud] 拉取失败', e));
}

/* ---- 调度：本地有改动就稍后上传 ---- */
function schedulePush(){
  clearTimeout(timer);
  timer = setTimeout(push, CD);
}

/* ---- 初始化 ---- */
function init(){
  applyConfig();
  pull();                        // 打开页面先拉一次
  schedulePush();                // 立刻把自己这边的数据也传上去
}

/* ---- 暴露给控制台手动调用 ---- */
window.cloudSync = { push, pull, forceSync: push };

/* ---- 监听：别的标签页改动也上传 ---- */
window.addEventListener('storage', schedulePush);

/* ---- 页面加载完成后启动 ---- */
if (document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

})();
