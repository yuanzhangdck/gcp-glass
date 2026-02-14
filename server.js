const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const {
    InstancesClient,
    ZoneOperationsClient,
    SubnetworksClient,
    RegionOperationsClient,
    FirewallsClient,
    ZonesClient,
} = require('@google-cloud/compute');
const { CloudBillingClient } = require('@google-cloud/billing');
const path = require('path');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;

app.set('trust proxy', true);
app.use(bodyParser.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// --- Configuration ---
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const ACCOUNTS_PATH = path.join(DATA_DIR, 'accounts.json');
const LOG_PATH = path.join(DATA_DIR, 'audit.log');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// --- Audit Log ---
function auditLog(action, detail, req) {
    const raw = req?.headers?.['cf-connecting-ip'] || req?.ip || '-';
    const ip = raw.replace(/^::ffff:/, '');
    const entry = {
        time: new Date().toISOString(),
        ip,
        action,
        detail: typeof detail === 'string' ? detail : JSON.stringify(detail)
    };
    fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + '\n');
}

// --- Config ---
function getConfig() {
    if (!fs.existsSync(CONFIG_PATH)) {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify({ password: 'password' }));
    }
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function saveConfig(newConfig) {
    const current = getConfig();
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ ...current, ...newConfig }, null, 2));
}

// --- Multi-Account Management ---
function loadAccounts() {
    if (!fs.existsSync(ACCOUNTS_PATH)) return [];
    try { return JSON.parse(fs.readFileSync(ACCOUNTS_PATH, 'utf8')); }
    catch { return []; }
}

function saveAccounts(accounts) {
    fs.writeFileSync(ACCOUNTS_PATH, JSON.stringify(accounts, null, 2));
    fs.chmodSync(ACCOUNTS_PATH, 0o600);
}

// Client cache per account
const clientCache = new Map(); // accountId -> { clients, mtime }

function getClientsForAccount(accountId) {
    const accounts = loadAccounts();
    const account = accounts.find(a => a.id === accountId);
    if (!account) return null;

    const keyPath = path.join(DATA_DIR, `key-${accountId}.json`);
    if (!fs.existsSync(keyPath)) return null;

    const mtime = fs.statSync(keyPath).mtimeMs;
    const cached = clientCache.get(accountId);
    if (cached && cached.mtime === mtime) return cached.clients;

    try {
        const keyFile = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
        const projectId = keyFile.project_id;
        const authOptions = { keyFilename: keyPath, projectId };

        const clients = {
            projectId,
            accountId,
            accountName: account.name,
            instances: new InstancesClient(authOptions),
            operations: new ZoneOperationsClient(authOptions),
            subnets: new SubnetworksClient(authOptions),
            regionOperations: new RegionOperationsClient(authOptions),
            firewalls: new FirewallsClient(authOptions),
            zones: new ZonesClient(authOptions),
            billing: new CloudBillingClient(authOptions)
        };
        clientCache.set(accountId, { clients, mtime });
        return clients;
    } catch (e) {
        console.error(`Error loading key for account ${accountId}:`, e);
        return null;
    }
}

// Migrate old single-key setup
(function migrateOldKey() {
    const oldKeyPath = path.join(DATA_DIR, 'gcp-key.json');
    if (fs.existsSync(oldKeyPath) && loadAccounts().length === 0) {
        try {
            const keyData = fs.readFileSync(oldKeyPath, 'utf8');
            const keyObj = JSON.parse(keyData);
            const id = crypto.randomBytes(4).toString('hex');
            const newKeyPath = path.join(DATA_DIR, `key-${id}.json`);
            fs.writeFileSync(newKeyPath, keyData);
            fs.chmodSync(newKeyPath, 0o600);
            saveAccounts([{ id, name: keyObj.project_id || 'Default', projectId: keyObj.project_id }]);
            console.log('Migrated old key to multi-account format');
        } catch (e) { console.error('Migration failed:', e); }
    }
})();


// --- Auth ---
const AUTH_COOKIE_NAME = 'gcp_auth';
const activeSessions = new Set();

app.post('/api/login', (req, res) => {
    const { password } = req.body;
    const config = getConfig();
    if (password === config.password) {
        const token = crypto.randomBytes(32).toString('hex');
        activeSessions.add(token);
        res.cookie(AUTH_COOKIE_NAME, token, { httpOnly: true, maxAge: 86400000 * 7, sameSite: 'strict' });
        auditLog('login', 'success', req);
        res.json({ success: true });
    } else {
        auditLog('login', 'failed', req);
        res.json({ success: false, error: 'Password Incorrect' });
    }
});

app.post('/api/logout', (req, res) => {
    const token = req.cookies[AUTH_COOKIE_NAME];
    if (token) activeSessions.delete(token);
    res.clearCookie(AUTH_COOKIE_NAME);
    auditLog('logout', '', req);
    res.json({ success: true });
});

app.use('/api', (req, res, next) => {
    if (req.path === '/login') return next();
    const token = req.cookies[AUTH_COOKIE_NAME];
    if (token && activeSessions.has(token)) { next(); }
    else { res.status(401).json({ error: 'Unauthorized' }); }
});


// --- Account CRUD ---
app.get('/api/accounts', (req, res) => {
    const accounts = loadAccounts();
    res.json({ success: true, accounts: accounts.map(a => ({ id: a.id, name: a.name, projectId: a.projectId })) });
});

app.post('/api/accounts', (req, res) => {
    const { name, key } = req.body;
    try {
        const keyObj = JSON.parse(key);
        if (!keyObj.project_id || !keyObj.private_key) throw new Error('Invalid Service Account Key');

        const id = crypto.randomBytes(4).toString('hex');
        const keyPath = path.join(DATA_DIR, `key-${id}.json`);
        fs.writeFileSync(keyPath, JSON.stringify(keyObj, null, 2));
        fs.chmodSync(keyPath, 0o600);

        const accounts = loadAccounts();
        accounts.push({ id, name: name || keyObj.project_id, projectId: keyObj.project_id });
        saveAccounts(accounts);

        auditLog('add_account', { id, name: name || keyObj.project_id }, req);
        res.json({ success: true, id });
    } catch (e) {
        res.status(400).json({ success: false, error: e.message });
    }
});

app.delete('/api/accounts/:id', (req, res) => {
    const { id } = req.params;
    const accounts = loadAccounts();
    const idx = accounts.findIndex(a => a.id === id);
    if (idx === -1) return res.status(404).json({ success: false, error: 'Account not found' });

    const removed = accounts.splice(idx, 1)[0];
    saveAccounts(accounts);
    clientCache.delete(id);

    const keyPath = path.join(DATA_DIR, `key-${id}.json`);
    try { fs.unlinkSync(keyPath); } catch {}

    auditLog('delete_account', { id, name: removed.name }, req);
    res.json({ success: true });
});

app.put('/api/accounts/:id', (req, res) => {
    const { id } = req.params;
    const { name } = req.body;
    const accounts = loadAccounts();
    const account = accounts.find(a => a.id === id);
    if (!account) return res.status(404).json({ success: false, error: 'Account not found' });
    if (name) account.name = name;
    saveAccounts(accounts);
    res.json({ success: true });
});

// Status
app.get('/api/status', (req, res) => {
    const accounts = loadAccounts();
    res.json({ ready: accounts.length > 0, accounts: accounts.map(a => ({ id: a.id, name: a.name, projectId: a.projectId })) });
});

// Change Password
app.post('/api/setup/password', (req, res) => {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 5) {
        return res.status(400).json({ success: false, error: 'Password too short' });
    }
    saveConfig({ password: newPassword });
    auditLog('change_password', '', req);
    res.json({ success: true });
});

// Audit Logs
app.get('/api/logs', (req, res) => {
    if (!fs.existsSync(LOG_PATH)) return res.json({ logs: [] });
    const lines = fs.readFileSync(LOG_PATH, 'utf8').trim().split('\n').filter(Boolean);
    const logs = lines.slice(-100).reverse().map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    res.json({ logs });
});


// --- GCP Endpoints (account-aware) ---

function requireGCP(req, res, next) {
    const accountId = req.query.account || req.body?.account;
    if (!accountId) return res.status(400).json({ error: 'No account specified' });
    const clients = getClientsForAccount(accountId);
    if (!clients) return res.status(503).json({ error: 'Account key not configured' });
    req.gcp = clients;
    next();
}

app.get('/api/instances', requireGCP, async (req, res) => {
    const { instances, projectId } = req.gcp;
    const zone = req.query.zone || 'us-central1-a';
    try {
        let instanceList = [];
        if (zone === 'all') {
            const iterable = instances.aggregatedListAsync({ project: projectId });
            for await (const [zonePath, scope] of iterable) {
                if (scope.instances && scope.instances.length > 0) {
                    const zoneName = zonePath.split('/').pop();
                    scope.instances.forEach(inst => { instanceList.push(formatInstance(inst, zoneName)); });
                }
            }
        } else {
            const [list] = await instances.list({ project: projectId, zone });
            instanceList = list.map(inst => formatInstance(inst, zone));
        }
        res.json({ success: true, instances: instanceList });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: error.message });
    }
});

function formatInstance(inst, zone) {
    return {
        name: inst.name,
        status: inst.status,
        machineType: inst.machineType.split('/').pop(),
        internalIp: inst.networkInterfaces?.[0]?.networkIP || 'N/A',
        externalIp: inst.networkInterfaces?.[0]?.accessConfigs?.[0]?.natIP || 'None',
        ipv6: inst.networkInterfaces?.[0]?.ipv6AccessConfigs?.[0]?.externalIpv6 || 'None',
        zone,
        diskSizeGb: inst.disks?.[0]?.diskSizeGb || '-',
        creationTime: inst.creationTimestamp || '-',
        tags: inst.tags?.items || []
    };
}

async function withRetry(fn, retries = 2) {
    for (let i = 0; i <= retries; i++) {
        try { return await fn(); }
        catch (e) { if (i === retries) throw e; await new Promise(r => setTimeout(r, 1000 * (i + 1))); }
    }
}

app.post('/api/instances/create', requireGCP, async (req, res) => {
    const { zone: zoneOrRegion, name, machineType, image, diskSize, password, enableIPv6 } = req.body;
    const { instances, projectId } = req.gcp;

    if (!name || typeof name !== 'string') return res.status(400).json({ success: false, error: 'Missing instance name' });

    let zone = normalizeLocation(zoneOrRegion);
    if (!zone) return res.status(400).json({ success: false, error: 'Missing zone/region' });
    if (zone === 'all') return res.status(400).json({ success: false, error: 'Invalid zone/region' });

    if (isRegionName(zone)) {
        try { zone = await pickZoneForRegion(req.gcp, zone); }
        catch (e) { return res.status(400).json({ success: false, error: e.message }); }
    } else if (!isZoneName(zone)) {
        return res.status(400).json({ success: false, error: `Invalid zone/region: ${zone}` });
    }

    ensureFirewallRules(req.gcp).catch(console.error);

    const imageMap = {
        'debian-11': 'projects/debian-cloud/global/images/family/debian-11',
        'debian-12': 'projects/debian-cloud/global/images/family/debian-12',
        'ubuntu-2004': 'projects/ubuntu-os-cloud/global/images/family/ubuntu-2004-lts',
        'ubuntu-2204': 'projects/ubuntu-os-cloud/global/images/family/ubuntu-2204-lts',
        'centos-7': 'projects/centos-cloud/global/images/family/centos-7'
    };
    const sourceImage = imageMap[image] || imageMap['debian-11'];

    let metadata = undefined;
    if (password) {
        const script = `#! /bin/bash
echo "root:${password}" | chpasswd
sed -i 's/PermitRootLogin no/PermitRootLogin yes/g' /etc/ssh/sshd_config
sed -i 's/PasswordAuthentication no/PasswordAuthentication yes/g' /etc/ssh/sshd_config
sed -i 's/#PermitRootLogin/PermitRootLogin/g' /etc/ssh/sshd_config
sed -i 's/#PasswordAuthentication/PasswordAuthentication/g' /etc/ssh/sshd_config
service sshd restart
systemctl restart ssh`;
        metadata = { items: [{ key: 'startup-script', value: script }] };
    }

    const region = zoneToRegion(zone);
    const networkInterface = {
        network: 'global/networks/default',
        subnetwork: `projects/${projectId}/regions/${region}/subnetworks/default`,
        accessConfigs: [{ type: 'ONE_TO_ONE_NAT', name: 'External NAT' }],
    };

    if (enableIPv6) {
        try { await ensureSubnetIPv6(req.gcp, zone); }
        catch (e) { return res.status(500).json({ success: false, error: 'Subnet v6 failed: ' + e.message }); }
        networkInterface.stackType = 'IPV4_IPV6';
        networkInterface.ipv6AccessConfigs = [{ type: 'DIRECT_IPV6', name: 'External IPv6', networkTier: 'PREMIUM' }];
    }

    try {
        const [op] = await withRetry(() => instances.insert({
            project: projectId, zone,
            instanceResource: {
                name,
                machineType: `zones/${zone}/machineTypes/${machineType || 'e2-micro'}`,
                disks: [{ boot: true, initializeParams: { sourceImage, diskSizeGb: diskSize || '10' } }],
                networkInterfaces: [networkInterface],
                metadata
            }
        }));
        auditLog('create_instance', { name, zone, machineType, account: req.gcp.accountName }, req);
        res.json({ success: true, operation: op.name });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/instances/changeip', requireGCP, async (req, res) => {
    const { zone, name, ipType } = req.body;
    const { instances, operations, projectId } = req.gcp;

    try {
        const [inst] = await instances.get({ project: projectId, zone, instance: name });
        const nic = inst.networkInterfaces[0];

        if (ipType === 'ipv6') {
            const [opDel] = await instances.updateNetworkInterface({
                project: projectId, zone, instance: name, networkInterface: nic.name,
                networkInterfaceResource: { stackType: 'IPV4_ONLY', fingerprint: nic.fingerprint }
            });
            await operations.wait({ project: projectId, zone, operation: opDel.name });
            const [freshInst] = await instances.get({ project: projectId, zone, instance: name });
            const freshNic = freshInst.networkInterfaces[0];
            const [opAdd] = await instances.updateNetworkInterface({
                project: projectId, zone, instance: name, networkInterface: nic.name,
                networkInterfaceResource: {
                    stackType: 'IPV4_IPV6', ipv6AccessType: 'EXTERNAL', fingerprint: freshNic.fingerprint,
                    ipv6AccessConfigs: [{ type: 'DIRECT_IPV6', name: 'External IPv6', networkTier: 'PREMIUM' }]
                }
            });
            auditLog('change_ip', { name, zone, type: 'ipv6', account: req.gcp.accountName }, req);
            res.json({ success: true, operation: opAdd.name });
        } else {
            if (nic.accessConfigs && nic.accessConfigs.length > 0) {
                const [opDel] = await instances.deleteAccessConfig({
                    project: projectId, zone, instance: name, networkInterface: nic.name, accessConfig: nic.accessConfigs[0].name
                });
                await operations.wait({ project: projectId, zone, operation: opDel.name });
            }
            await new Promise(r => setTimeout(r, 3000));
            const [opAdd] = await instances.addAccessConfig({
                project: projectId, zone, instance: name, networkInterface: nic.name,
                accessConfigResource: { name: 'External NAT', type: 'ONE_TO_ONE_NAT' }
            });
            auditLog('change_ip', { name, zone, type: 'ipv4', account: req.gcp.accountName }, req);
            res.json({ success: true, operation: opAdd.name });
        }
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/instances/ipv6', requireGCP, async (req, res) => {
    res.status(501).json({ error: "Implemented via Change IP logic" });
});

app.post('/api/instances/:action', requireGCP, async (req, res) => {
    const { action } = req.params;
    const { zone, name } = req.body;
    const { instances, projectId } = req.gcp;

    if (!['start', 'stop', 'delete'].includes(action)) {
        return res.status(404).json({ success: false, error: 'Unknown action' });
    }

    try {
        const [op] = await withRetry(() => instances[action]({ project: projectId, zone, instance: name }));
        auditLog(`instance_${action}`, { name, zone, account: req.gcp.accountName }, req);
        res.json({ success: true, message: `${action} sent`, operation: op.name });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});


// --- Helpers ---

function normalizeLocation(v) {
    if (v === undefined || v === null) return '';
    return String(v).trim().split('/').filter(Boolean).pop();
}

function isZoneName(v) { return /^[a-z0-9]+(?:-[a-z0-9]+)*-[a-z]$/.test(v); }
function isRegionName(v) { return /^[a-z0-9]+(?:-[a-z0-9]+)*[0-9]$/.test(v); }

function zoneToRegion(zone) {
    const idx = zone.lastIndexOf('-');
    if (idx <= 0) throw new Error(`Invalid zone: ${zone}`);
    return zone.substring(0, idx);
}

async function pickZoneForRegion(gcp, region) {
    const { zones, projectId } = gcp;
    const found = [];
    const iterable = zones.listAsync({ project: projectId });
    for await (const z of iterable) {
        const zRegion = normalizeLocation(z.region);
        if (zRegion !== region) continue;
        if (z.status && String(z.status).toUpperCase() !== 'UP') continue;
        if (z.name) found.push(z.name);
    }
    found.sort();
    if (found.length === 0) throw new Error(`No available zones found in region: ${region}`);
    return found[0];
}

async function ensureSubnetIPv6(gcp, zone) {
    const { subnets, regionOperations, projectId } = gcp;
    const region = zoneToRegion(zone);
    const [subnet] = await subnets.get({ project: projectId, region, subnetwork: 'default' });
    if (subnet.stackType !== 'IPV4_IPV6') {
        const [op] = await subnets.patch({
            project: projectId, region, subnetwork: 'default',
            subnetworkResource: { stackType: 'IPV4_IPV6', ipv6AccessType: 'EXTERNAL', fingerprint: subnet.fingerprint }
        });
        await regionOperations.wait({ project: projectId, region, operation: op.name });
    }
}

async function ensureFirewallRules(gcp) {
    const { firewalls, projectId } = gcp;
    for (const [name, range] of [['default-allow-all-ipv4', '0.0.0.0/0'], ['default-allow-all-ipv6', '::/0']]) {
        try { await firewalls.get({ project: projectId, firewall: name }); }
        catch {
            try { await firewalls.insert({ project: projectId, firewallResource: {
                name, network: 'global/networks/default', direction: 'INGRESS', priority: 1000,
                sourceRanges: [range], allowed: [{ IPProtocol: 'all' }]
            }}); } catch {}
        }
    }
}

app.listen(port, () => {
    console.log(`GCP Panel running at http://localhost:${port}`);
});
