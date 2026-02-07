const API_BASE = '/api';

// --- UI Helpers ---
function showToast(msg, isError = false) {
    let t = document.getElementById('toast');
    if(!t) {
        t = document.createElement('div');
        t.id = 'toast';
        t.className = 'toast hidden';
        document.body.appendChild(t);
    }
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
        </div>
    `;
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
            </div>
        `);
        document.getElementById('conf-cancel').onclick = () => { close(); resolve(false); };
        document.getElementById('conf-ok').onclick = () => { close(); resolve(true); };
    });
}

// --- App Logic ---
document.addEventListener('DOMContentLoaded', () => {
    if (!document.cookie.includes('gcp_auth=valid')) {
        window.location.href = '/login.html';
        return;
    }
    checkStatus();
});

async function checkStatus() {
    try {
        const res = await fetch(`${API_BASE}/status`);
        const data = await res.json();
        if (data.ready) {
            document.getElementById('project-id').innerText = data.projectId;
            loadInstances();
        } else {
            document.getElementById('project-id').innerText = 'NO KEY';
            toggleSettings();
        }
    } catch(e) {}
}

async function saveKey() {
    const key = document.getElementById('gcp-key').value;
    try {
        const res = await fetch(`${API_BASE}/setup/key`, {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ key })
        });
        const data = await res.json();
        if(data.success) {
            showToast('Key Saved');
            setTimeout(()=>location.reload(), 1000);
        } else showToast(data.error, true);
    } catch(e) { showToast('Network Error', true); }
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
        if(data.success) { 
            showToast('Password Updated! Please re-login.'); 
            setTimeout(()=>window.location.href='/login.html', 1500); 
        }
        else showToast(data.error, true);
    } catch(e) { showToast('Network Error', true); }
}

async function loadInstances() {
    const tbody = document.getElementById('list-body');
    tbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-slate-500"><div class="inline-block animate-spin mr-2">⟳</div>Loading all zones...</td></tr>`;
    
    try {
        const res = await fetch(`${API_BASE}/instances?zone=all`);
        const data = await res.json();
        
        if(data.success) {
            document.getElementById('count').innerText = data.instances.length;
            if(data.instances.length === 0) {
                tbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-slate-500">No active instances found.</td></tr>`;
                return;
            }
            tbody.innerHTML = data.instances.map(vm => `
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
                        ${vm.ipv6!=='None'?`<div class="text-[10px] text-slate-500 mt-1">${vm.ipv6}</div>`:''}
                    </td>
                    <td class="p-4 text-right">
                        <div class="flex items-center justify-end gap-2">
                            ${vm.status==='RUNNING' ? 
                                `<button onclick="action('stop','${vm.name}','${vm.zone}')" class="px-2 py-1 rounded bg-red-500/10 text-red-400 text-xs hover:bg-red-500/20">Stop</button>` : 
                                `<button onclick="action('start','${vm.name}','${vm.zone}')" class="px-2 py-1 rounded bg-green-500/10 text-green-400 text-xs hover:bg-green-500/20">Start</button>`
                            }
                            <button onclick="changeIp('${vm.name}','${vm.zone}','ipv4')" class="px-2 py-1 rounded bg-blue-500/10 text-blue-400 text-xs hover:bg-blue-500/20" title="Swap IP">🔄 v4</button>
                            <button onclick="changeIp('${vm.name}','${vm.zone}','ipv6')" class="px-2 py-1 rounded bg-purple-500/10 text-purple-400 text-xs hover:bg-purple-500/20" title="Swap IPv6">🔄 v6</button>
                            <button onclick="action('delete','${vm.name}','${vm.zone}')" class="px-2 py-1 rounded hover:bg-red-500/20 text-slate-500 hover:text-red-400">🗑️</button>
                        </div>
                    </td>
                </tr>
            `).join('');
        }
    } catch(e) { console.error(e); tbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-red-400">Error loading data</td></tr>`; }
}

async function createInstance() {
    const btn = event.target;
    const name = document.getElementById('vm-name').value;
    const pass = document.getElementById('vm-pass').value;
    
    if(!name || !pass) return showToast('Name & Password required', true);
    
    btn.disabled = true; btn.innerText = 'Deploying...';
    
    const payload = {
        name,
        password: pass,
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
                </div>
            `);
            setTimeout(loadInstances, 3000);
        } else showToast(data.error, true);
    } catch(e) { showToast('Network Error', true); }
    finally { btn.disabled = false; btn.innerText = 'Deploy Instance'; }
}

async function action(act, name, zone) {
    if(!await showConfirm(`${act} instance ${name}?`)) return;
    try {
        const res = await fetch(`${API_BASE}/instances/${act}`, {
            method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ name, zone })
        });
        const data = await res.json();
        if(data.success) { showToast(`${act} sent`); setTimeout(loadInstances, 2000); }
    } catch(e) { showToast('Error', true); }
}

async function changeIp(name, zone, type) {
    if(!await showConfirm(`Change ${type.toUpperCase()} for ${name}?`)) return;
    showToast(`Swapping ${type}...`);
    try {
        const res = await fetch(`${API_BASE}/instances/changeip`, {
            method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ name, zone, ipType: type })
        });
        const data = await res.json();
        if(data.success) { showToast('IP Swapped'); setTimeout(loadInstances, 5000); }
        else showToast(data.error, true);
    } catch(e) { showToast('Error', true); }
}

function copyText(txt) {
    navigator.clipboard.writeText(txt).then(()=>showToast('Copied'));
}
