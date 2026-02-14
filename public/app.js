const API_BASE = '/api';
let currentAccount = null;
let accounts = [];

// --- UI Helpers ---
function showToast(msg, isError = false) {
    let t = document.getElementById('toast');
    if(!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
    t.className = `fixed top-6 left-1/2 -translate-x-1/2 px-6 py-3 rounded-full shadow-2xl transition-all duration-300 z-[1000] border flex items-center gap-3 min-w-[300px] justify-center text-sm font-bold ${isError ? 'bg-red-500/90 text-white border-red-400' : 'bg-[#1e293b] text-white border-white/10'}`;
    t.innerHTML = `<span>${isError ? '🚨' : '✨'}</span><span>${msg}</span>`;
    setTimeout(() => { t.className += ' opacity-0 -translate-y-12'; setTimeout(()=>t.remove(), 300); }, 3000);
}

function createModal(title, html) {
    const overlay = document.createElement('div');
    overlay.style.cssText = `position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.7);backdrop-filter:blur(5px);display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity 0.2s;`;
    overlay.innerHTML = `
        <div style="background:#1e293b;border:1px solid rgba(255,255,255,0.1);border-radius:16px;width:min(500px,90vw);padding:24px;box-shadow:0 20px 50px rgba(0,0,0,0.5);transform:scale(0.95);transition:transform 0.2s;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
                <h3 style="font-weight:700;color:white;font-size:1.1rem;">${title}</h3>
                <button class="close-btn" style="color:#94a3b8;background:none;border:none;font-size:24px;cursor:pointer;">&times;</button>
            </div>
            <div style="color:#cbd5e1;font-size:0.9rem;">${html}</div>
        </div>`;
    document.body.appendChild(overlay);
    const close = () => { overlay.style.opacity='0'; setTimeout(()=>overlay.remove(),200); };
    overlay.querySelector('.close-btn').onclick = close;
    overlay.onclick = (e) => { if(e.target===overlay) close(); };
    requestAnimationFrame(() => { overlay.style.opacity='1'; overlay.children[0].style.transform='scale(1)'; });
    return { close };
}

function showConfirm(msg) {
    return new Promise((resolve) => {
        const { close } = createModal('Confirm Action', `
            <p style="margin-bottom:20px">${msg}</p>
            <div style="display:flex;justify-content:flex-end;gap:10px;">
                <button id="conf-cancel" class="btn btn-glass">Cancel</button>
                <button id="conf-ok" class="btn btn-primary">Confirm</button>
            </div>`);
        document.getElementById('conf-cancel').onclick = () => { close(); resolve(false); };
        document.getElementById('conf-ok').onclick = () => { close(); resolve(true); };
    });
}

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
    fetch(`${API_BASE}/status`).then(r => {
        if (r.status === 401) { window.location.href = '/login.html'; return; }
        return r.json();
    }).then(data => {
        if (!data) return;
        accounts = data.accounts || [];
        renderAccountList();
        if (accounts.length > 0) {
            switchAccount(accounts[0].id);
        } else {
            document.getElementById('project-id').innerText = 'No Accounts';
        }
    }).catch(() => window.location.href = '/login.html');
});

// --- Account Management ---
function renderAccountList() {
    const el = document.getElementById('account-list');
    if (!el) return;
    el.innerHTML = accounts.map(a => `
        <div class="nav-item ${currentAccount === a.id ? 'active' : ''}" onclick="switchAccount('${a.id}')">
            <span>☁️</span>
            <span class="truncate flex-1">${a.name}</span>
            <button onclick="event.stopPropagation();renameAccount('${a.id}')" class="text-slate-600 hover:text-blue-400 text-xs">✎</button>
            <button onclick="event.stopPropagation();deleteAccount('${a.id}','${a.name}')" class="text-slate-600 hover:text-red-400 text-xs">✕</button>
        </div>
    `).join('');
}

async function renameAccount(id) {
    const acc = accounts.find(a => a.id === id);
    if (!acc) return;
    const { close } = createModal('✏️ Rename Account', `
        <div class="space-y-4">
            <input type="text" id="rename-input" class="glass-input" value="${acc.name}" placeholder="e.g. xxx@gmail.com">
            <button id="btn-rename" class="btn btn-primary w-full justify-center">Save</button>
        </div>
    `);
    document.getElementById('rename-input').focus();
    document.getElementById('rename-input').select();
    const doRename = async () => {
        const name = document.getElementById('rename-input').value.trim();
        if (!name) return showToast('Name cannot be empty', true);
        try {
            const res = await fetch(`${API_BASE}/accounts/${id}`, {
                method: 'PUT', headers: {'Content-Type':'application/json'},
                body: JSON.stringify({ name })
            });
            const data = await res.json();
            if (data.success) { acc.name = name; renderAccountList(); close(); showToast('Renamed'); }
            else showToast(data.error, true);
        } catch(e) { showToast('Error', true); }
    };
    document.getElementById('btn-rename').onclick = doRename;
    document.getElementById('rename-input').onkeydown = (e) => { if (e.key === 'Enter') doRename(); };
}

function switchAccount(id) {
    currentAccount = id;
    const acc = accounts.find(a => a.id === id);
    document.getElementById('project-id').innerText = acc ? acc.projectId : '-';
    renderAccountList();
    loadInstances();
}

function showAddAccount() {
    const { close } = createModal('➕ Add GCP Account', `
        <div class="space-y-4">
            <div>
                <label class="block text-xs font-bold text-slate-400 uppercase mb-1">Account Name</label>
                <input type="text" id="new-acc-name" class="glass-input" placeholder="e.g. My Project">
            </div>
            <div>
                <label class="block text-xs font-bold text-slate-400 uppercase mb-1">Service Account JSON Key</label>
                <textarea id="new-acc-key" class="glass-input h-32 font-mono text-xs" placeholder="Paste JSON key here..."></textarea>
            </div>
            <button id="btn-add-acc" class="btn btn-primary w-full justify-center py-3">Add Account</button>
        </div>
    `);
    document.getElementById('btn-add-acc').onclick = async () => {
        const name = document.getElementById('new-acc-name').value;
        const key = document.getElementById('new-acc-key').value;
        if (!key) return showToast('Key is required', true);
        try {
            const res = await fetch(`${API_BASE}/accounts`, {
                method: 'POST', headers: {'Content-Type':'application/json'},
                body: JSON.stringify({ name, key })
            });
            const data = await res.json();
            if (data.success) {
                showToast('Account Added');
                close();
                location.reload();
            } else showToast(data.error, true);
        } catch(e) { showToast('Network Error', true); }
    };
}

async function deleteAccount(id, name) {
    if (!await showConfirm(`Delete account "${name}"?`)) return;
    try {
        const res = await fetch(`${API_BASE}/accounts/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) { showToast('Account Deleted'); location.reload(); }
        else showToast(data.error, true);
    } catch(e) { showToast('Error', true); }
}

// --- Auth ---
async function logout() {
    await fetch(`${API_BASE}/logout`, { method: 'POST' });
    window.location.href = '/login.html';
}

async function changePwd() {
    const newPassword = document.getElementById('new-pwd').value;
    if (!newPassword || newPassword.length < 5) return showToast('Min 5 chars', true);
    try {
        const res = await fetch(`${API_BASE}/setup/password`, {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ newPassword })
        });
        const data = await res.json();
        if(data.success) { showToast('Password Updated!'); setTimeout(()=>logout(), 1500); }
        else showToast(data.error, true);
    } catch(e) { showToast('Network Error', true); }
}

// --- Instance Cache ---
const CACHE_TTL = 30 * 60 * 1000; // 30 min

function getCachedInstances(accountId) {
    try {
        const raw = localStorage.getItem(`instances_${accountId}`);
        if (!raw) return null;
        const { data, ts } = JSON.parse(raw);
        if (Date.now() - ts > CACHE_TTL) { localStorage.removeItem(`instances_${accountId}`); return null; }
        return data;
    } catch { return null; }
}

function setCachedInstances(accountId, data) {
    localStorage.setItem(`instances_${accountId}`, JSON.stringify({ data, ts: Date.now() }));
}

// --- Instances ---
async function loadInstances(forceRefresh = false) {
    if (!currentAccount) return;
    const tbody = document.getElementById('list-body');

    if (!forceRefresh) {
        const cached = getCachedInstances(currentAccount);
        if (cached) { renderInstances(cached); return; }
    }

    tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-slate-500"><div class="inline-block animate-spin mr-2">⟳</div>Loading all zones...</td></tr>`;
    try {
        const res = await fetch(`${API_BASE}/instances?zone=all&account=${currentAccount}`);
        if (res.status === 401) { window.location.href = '/login.html'; return; }
        const data = await res.json();
        if (data.success) {
            setCachedInstances(currentAccount, data.instances);
            renderInstances(data.instances);
        }
    } catch(e) { console.error(e); tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-red-400">Error loading data</td></tr>`; }
}

function renderInstances(list) {
    document.getElementById('count').innerText = list.length;
    const tbody = document.getElementById('list-body');
    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-slate-500">No active instances found.</td></tr>`;
        return;
    }
    const shortIPv6 = (ip) => {
        const parts = ip.split(':').map(p => p.replace(/^0+/, '') || '0');
        let best = -1, bestLen = 0, cur = -1, curLen = 0;
        for (let i = 0; i < parts.length; i++) {
            if (parts[i] === '0') { if (cur < 0) cur = i; curLen = i - cur + 1; }
            else { if (curLen > bestLen) { best = cur; bestLen = curLen; } cur = -1; curLen = 0; }
        }
        if (curLen > bestLen) { best = cur; bestLen = curLen; }
        if (bestLen > 1) { parts.splice(best, bestLen, ''); if (best === 0) parts.unshift(''); if (best + bestLen >= 8) parts.push(''); }
        return parts.join(':');
    };
    tbody.innerHTML = list.map(vm => {
        const created = vm.creationTime !== '-' ? new Date(vm.creationTime).toLocaleDateString() : '-';
        return `
        <tr class="hover:bg-white/5 transition group">
            <td class="p-4 text-white font-medium align-middle">
                <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded bg-blue-500/20 flex items-center justify-center text-blue-400 font-bold text-xs">VM</div>
                    <div>
                        <div>${vm.name}</div>
                        <div class="text-[10px] text-slate-500">${vm.machineType}</div>
                    </div>
                </div>
            </td>
            <td class="p-4 text-slate-400 text-xs">${vm.zone}</td>
            <td class="p-4"><span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${vm.status==='RUNNING'?'bg-green-500/20 text-green-400':'bg-slate-500/20 text-slate-400'}">${vm.status}</span></td>
            <td class="p-4 text-xs font-mono text-slate-300">
                <div onclick="copyText('${vm.externalIp}')" class="cursor-pointer hover:text-white transition" title="Copy">${vm.externalIp}</div>
                ${vm.ipv6!=='None'?`<div onclick="copyText('${shortIPv6(vm.ipv6)}')" class="cursor-pointer hover:text-white transition text-xs font-mono text-slate-300 mt-1">${shortIPv6(vm.ipv6)}</div>`:''}
            </td>
            <td class="p-4 text-xs text-slate-500">
                <div>${vm.diskSizeGb} GB</div>
                <div class="text-[10px]">${created}</div>
            </td>
            <td class="p-4 text-right">
                <div class="flex items-center justify-end gap-2">
                    ${vm.status==='RUNNING' ?
                        `<button onclick="action('stop','${vm.name}','${vm.zone}')" class="px-2 py-1 rounded bg-red-500/10 text-red-400 text-xs hover:bg-red-500/20">Stop</button>` :
                        `<button onclick="action('start','${vm.name}','${vm.zone}')" class="px-2 py-1 rounded bg-green-500/10 text-green-400 text-xs hover:bg-green-500/20">Start</button>`
                    }
                    <button onclick="changeIp('${vm.name}','${vm.zone}','ipv4')" class="px-2 py-1 rounded bg-blue-500/10 text-blue-400 text-xs hover:bg-blue-500/20 inline-flex items-center gap-1" title="Swap IPv4"><svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>v4</button>
                    <button onclick="changeIp('${vm.name}','${vm.zone}','ipv6')" class="px-2 py-1 rounded bg-purple-500/10 text-purple-400 text-xs hover:bg-purple-500/20 inline-flex items-center gap-1" title="Swap IPv6"><svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>v6</button>
                    <button onclick="action('delete','${vm.name}','${vm.zone}')" class="px-2 py-1 rounded hover:bg-red-500/20 text-slate-500 hover:text-red-400">🗑️</button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

async function createInstance() {
    const btn = event.target;
    const name = document.getElementById('vm-name').value;
    const pass = document.getElementById('vm-pass').value;
    if(!name || !pass) return showToast('Name & Password required', true);
    if(!currentAccount) return showToast('Select an account first', true);
    btn.disabled = true; btn.innerText = 'Deploying...';
    const payload = {
        name, password: pass, account: currentAccount,
        zone: document.getElementById('vm-zone').value,
        machineType: document.getElementById('vm-type').value,
        image: document.getElementById('vm-image').value,
        diskSize: '20',
        enableIPv6: document.getElementById('ipv6-toggle').checked
    };
    try {
        const res = await fetch(`${API_BASE}/instances/create`, {
            method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload)
        });
        const data = await res.json();
        if(data.success) {
            createModal('🚀 Deployed', `
                <div class="text-center space-y-4">
                    <p class="text-green-400 font-bold">Instance Created!</p>
                    <div class="bg-black/30 p-3 rounded text-left text-sm font-mono">
                        <div class="text-slate-400">User: root</div>
                        <div class="text-white">Pass: ${pass}</div>
                    </div>
                    <p class="text-xs text-slate-500">Check IP in list after 1 min.</p>
                </div>`);
            setTimeout(() => pollRefresh(3), 1000);
        } else showToast(data.error, true);
    } catch(e) { showToast('Network Error', true); }
    finally { btn.disabled = false; btn.innerText = 'Deploy Instance'; }
}

async function action(act, name, zone) {
    if(!await showConfirm(`${act} instance ${name}?`)) return;
    try {
        const res = await fetch(`${API_BASE}/instances/${act}`, {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ name, zone, account: currentAccount })
        });
        const data = await res.json();
        if(data.success) { showToast(`${act} sent`); pollRefresh(3); }
    } catch(e) { showToast('Error', true); }
}

async function changeIp(name, zone, type) {
    if(!await showConfirm(`Change ${type.toUpperCase()} for ${name}?`)) return;
    showToast(`Swapping ${type}...`);
    try {
        const res = await fetch(`${API_BASE}/instances/changeip`, {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ name, zone, ipType: type, account: currentAccount })
        });
        const data = await res.json();
        if(data.success) { showToast('IP Swapped'); pollRefresh(3); }
        else showToast(data.error, true);
    } catch(e) { showToast('Error', true); }
}

// Poll refresh: refresh multiple times to catch state changes
async function pollRefresh(times, interval = 3000) {
    for (let i = 0; i < times; i++) {
        await new Promise(r => setTimeout(r, interval));
        await loadInstances(true);
    }
}

async function showLogs() {
    try {
        const res = await fetch(`${API_BASE}/logs`);
        const data = await res.json();
        const rows = data.logs.map(l =>
            `<tr class="border-b border-white/5"><td class="p-2 text-[11px] text-slate-500 whitespace-nowrap">${new Date(l.time).toLocaleString()}</td><td class="p-2 text-[11px] text-slate-400">${l.ip}</td><td class="p-2 text-[11px] font-medium text-white">${l.action}</td><td class="p-2 text-[11px] text-slate-400 max-w-[200px] truncate">${l.detail}</td></tr>`
        ).join('');
        createModal('📋 Audit Logs', `
            <div style="max-height:400px;overflow-y:auto;">
                <table class="w-full text-left"><thead><tr class="text-[10px] uppercase text-slate-500 border-b border-white/10"><th class="p-2">Time</th><th class="p-2">IP</th><th class="p-2">Action</th><th class="p-2">Detail</th></tr></thead>
                <tbody>${rows || '<tr><td colspan="4" class="p-4 text-center text-slate-500">No logs yet</td></tr>'}</tbody></table>
            </div>`);
    } catch(e) { showToast('Failed to load logs', true); }
}

function copyText(txt) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(() => showToast('Copied')).catch(() => fallbackCopy(txt));
    } else { fallbackCopy(txt); }
}

function fallbackCopy(txt) {
    const ta = document.createElement("textarea");
    ta.value = txt;
    ta.style.cssText = "position:fixed;left:-9999px;top:0";
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    try { document.execCommand('copy') ? showToast('Copied') : showToast('Copy failed', true); }
    catch { showToast('Copy error', true); }
    document.body.removeChild(ta);
}
