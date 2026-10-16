// cloud-sync.js - 云端同步模块（GitHub）
(function(){
'use strict';

let cloudCfg = null;
let cloudSha = null;
const KEY = 'cloudConfig';

try { cloudCfg = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch(e) {}

// ===== 弹窗控制 =====
window.showCloudConfig = function() {
  const m = document.getElementById('cloudMask');
  const b = document.getElementById('cloudBox');
  m.style.display = 'block';
  b.style.display = 'block';
  if (cloudCfg) {
    document.getElementById('cloudToken').value = cloudCfg.token || '';
    document.getElementById('cloudUser').value = cloudCfg.user || '';
    document.getElementById('cloudRepo').value = cloudCfg.repo || '';
    document.getElementById('cloudBranch').value = cloudCfg.branch || 'main';
  }
};

window.closeCloudConfig = function() {
  document.getElementById('cloudMask').style.display = 'none';
  document.getElementById('cloudBox').style.display = 'none';
};

function setStatus(msg, ok) {
  const el = document.getElementById('cloudStatus');
  el.innerHTML = '<span style="color:' + (ok ? '#2e7d32' : '#c62828') + ';">' + msg + '</span>';
}

// ===== 保存并测试 =====
window.saveCloudConfig = async function() {
  const token = document.getElementById('cloudToken').value.trim();
  const user  = document.getElementById('cloudUser').value.trim();
  const repo  = document.getElementById('cloudRepo').value.trim();
  const branch= document.getElementById('cloudBranch').value.trim() || 'main';

  if (!token || !user || !repo) {
    setStatus('✗ 请填写完整信息', false);
    return;
  }

  cloudCfg = { token, user, repo, branch };
  try { localStorage.setItem(KEY, JSON.stringify(cloudCfg)); } catch(e) {}

  setStatus('测试中...', true);

  try {
    const res = await fetch(
      `https://api.github.com/repos/${user}/${repo}/contents/progress.json?ref=${branch}`,
      { headers: { 'Authorization': 'token ' + token, 'Accept': 'application/vnd.github.v3+json' } }
    );
    if (res.status === 200) {
      const d = await res.json();
      cloudSha = d.sha;
      const p = JSON.parse(atob(d.content.replace(/\n/g,'')));
      setStatus('✓ 连接成功！云端有 ' + Object.keys(p).length + ' 条记录', true);
      if (confirm('检测到云端已有数据，是否加载并覆盖本地？')) {
        Object.keys(p).forEach(k => { localStorage.setItem(k, p[k]); });
        location.reload();
      }
    } else if (res.status === 404) {
      setStatus('✓ 连接成功！首次使用，打卡后将自动创建文件', true);
    } else {
      throw new Error('HTTP ' + res.status);
    }
  } catch(e) {
    setStatus('✗ 连接失败：' + e.message, false);
  }
};

// ===== 同步到云端 =====
async function syncToCloud() {
  if (!cloudCfg || !cloudCfg.token) return false;
  try {
    // 收集所有进度数据（排除云端配置自身）
    const progress = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k === KEY) continue;
      progress[k] = localStorage.getItem(k);
    }

    const content = btoa(unescape(encodeURIComponent(JSON.stringify(progress))));

    // 先尝试获取 sha
    let sha = cloudSha;
    if (!sha) {
      try {
        const r = await fetch(
          `https://api.github.com/repos/${cloudCfg.user}/${cloudCfg.repo}/contents/progress.json?ref=${cloudCfg.branch}`,
          { headers: { 'Authorization': 'token ' + cloudCfg.token, 'Accept': 'application/vnd.github.v3+json' } }
        );
        if (r.status === 200) { const d = await r.json(); sha = d.sha; }
      } catch(e) {}
    }

    const body = { message: 'sync ' + new Date().toISOString(), content: content, branch: cloudCfg.branch };
    if (sha) body.sha = sha;

    const res = await fetch(
      `https://api.github.com/repos/${cloudCfg.user}/${cloudCfg.repo}/contents/progress.json`,
      {
        method: 'PUT',
        headers: {
          'Authorization': 'token ' + cloudCfg.token,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      }
    );

    if (res.ok) {
      const d = await res.json();
      cloudSha = d.content.sha;
      return true;
    }
    return false;
  } catch(e) {
    console.error('syncToCloud error:', e);
    return false;
  }
}

// ===== 页面加载时拉取云端 =====
window.addEventListener('load', async function() {
  if (!cloudCfg || !cloudCfg.token) return;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${cloudCfg.user}/${cloudCfg.repo}/contents/progress.json?ref=${cloudCfg.branch}`,
      { headers: { 'Authorization': 'token ' + cloudCfg.token, 'Accept': 'application/vnd.github.v3+json' } }
    );
    if (res.status === 200) {
      const data = await res.json();
      cloudSha = data.sha;
      const progress = JSON.parse(atob(data.content.replace(/\n/g,'')));
      let updated = 0;
      Object.keys(progress).forEach(k => {
        if (k === KEY) return;
        if (localStorage.getItem(k) !== progress[k]) {
          localStorage.setItem(k, progress[k]);
          updated++;
        }
      });
      if (updated > 0) {
        console.log('☁ 云端同步：更新了 ' + updated + ' 条进度');
        if (typeof updateStats === 'function') updateStats();
        // 刷新表格显示
        if (typeof render === 'function') render();
      }
    }
  } catch(e) {
    console.log('☁ 自动拉取跳过:', e.message);
  }
});

// ===== 拦截 localStorage.setItem 自动同步 =====
const _origSet = localStorage.setItem.bind(localStorage);
let _syncTimer = null;
localStorage.setItem = function(k, v) {
  _origSet(k, v);
  if (k === KEY) return;
  // 防抖：停止操作 1.5 秒后才同步
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(function() {
    syncToCloud().then(function(ok) {
      if (ok) console.log('☁ 已同步到云端');
    });
  }, 1500);
};

})();