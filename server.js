const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
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
// FIX: Use PORT environment variable or default to 3000
const port = process.env.PORT || 3000;

app.use(bodyParser.json({ limit: '10mb' })); // Allow large JSON for key
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// --- Configuration ---
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const KEY_PATH = path.join(DATA_DIR, 'gcp-key.json');

// Ensure data dir exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// Helper: Get Config
function getConfig() {
    if (!fs.existsSync(CONFIG_PATH)) {
        // Default config
        fs.writeFileSync(CONFIG_PATH, JSON.stringify({ password: 'password' }));
    }
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

// Helper: Save Config
function saveConfig(newConfig) {
    const current = getConfig();
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ ...current, ...newConfig }, null, 2));
}

// Helper: Get GCP Client
// We create clients dynamically because the key might be uploaded later
let _clients = {};
function getClients() {
    if (!fs.existsSync(KEY_PATH)) return null;
    
    // Cache clients if key hasn't changed (simplified logic: just return cached if exists)
    if (_clients.instances) return _clients;

    try {
        const keyFile = JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'));
        const projectId = keyFile.project_id;
        const authOptions = { keyFilename: KEY_PATH, projectId };

        _clients = {
            projectId,
            instances: new InstancesClient(authOptions),
            operations: new ZoneOperationsClient(authOptions),
            subnets: new SubnetworksClient(authOptions),
            regionOperations: new RegionOperationsClient(authOptions),
            firewalls: new FirewallsClient(authOptions),
            zones: new ZonesClient(authOptions),
            billing: new CloudBillingClient(authOptions)
        };
        return _clients;
    } catch (e) {
        console.error('Error loading GCP Key:', e);
        return null;
    }
}

// Helper: Reset Clients (when new key uploaded)
function resetClients() {
    _clients = {};
}


// --- Auth Middleware ---
const AUTH_COOKIE_NAME = 'gcp_auth';

app.post('/api/login', (req, res) => {
    const { password } = req.body;
    const config = getConfig();
    if (password === config.password) {
        res.cookie(AUTH_COOKIE_NAME, 'valid', { httpOnly: false, maxAge: 86400000 * 30 }); 
        res.json({ success: true });
    } else {
        res.json({ success: false, error: 'Password Incorrect' });
    }
});

// Protect API
app.use('/api', (req, res, next) => {
    if (req.path === '/login') return next();
    if (req.cookies[AUTH_COOKIE_NAME] === 'valid') {
        next();
    } else {
        res.status(401).json({ error: 'Unauthorized' });
    }
});


// --- System Endpoints ---

// Check Status (Is Key Loaded?)
app.get('/api/status', (req, res) => {
    const clients = getClients();
    if (clients) {
        res.json({ ready: true, projectId: clients.projectId });
    } else {
        res.json({ ready: false });
    }
});

// Upload Key
app.post('/api/setup/key', (req, res) => {
    const { key } = req.body;
    try {
        // Validate JSON
        const keyObj = JSON.parse(key);
        if (!keyObj.project_id || !keyObj.private_key) {
            throw new Error('Invalid Service Account Key JSON');
        }
        
        fs.writeFileSync(KEY_PATH, JSON.stringify(keyObj, null, 2));
        resetClients(); // Force reload
        res.json({ success: true });
    } catch (e) {
        res.status(400).json({ success: false, error: 'Invalid Key: ' + e.message });
    }
});

// Change Password
app.post('/api/setup/password', (req, res) => {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 5) {
        return res.status(400).json({ success: false, error: 'Password too short' });
    }
    saveConfig({ password: newPassword });
    res.json({ success: true });
});


// --- GCP Endpoints ---

// Middleware to ensure GCP Ready
function requireGCP(req, res, next) {
    const clients = getClients();
    if (!clients) return res.status(503).json({ error: 'GCP Key not configured' });
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
                     scope.instances.forEach(inst => {
                        instanceList.push(formatInstance(inst, zoneName));
                     });
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
        zone: zone
    };
}

// Actions (Start/Stop/Delete)
app.post('/api/instances/:action', requireGCP, async (req, res) => {
    const { action } = req.params;
    const { zone, name } = req.body;
    const { instances, operations, projectId } = req.gcp;

    if (!['start', 'stop', 'delete'].includes(action)) {
        return res.status(404).json({ success: false, error: 'Unknown action' });
    }

    try {
        const [op] = await instances[action]({ project: projectId, zone, instance: name });
        res.json({ success: true, message: `${action} sent`, operation: op.name });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Create
app.post('/api/instances/create', requireGCP, async (req, res) => {
    const { zone: zoneOrRegion, name, machineType, image, diskSize, password, enableIPv6 } = req.body;
    const { instances, projectId } = req.gcp;

    if (!name || typeof name !== 'string') {
        return res.status(400).json({ success: false, error: 'Missing instance name' });
    }

    let zone = normalizeLocation(zoneOrRegion);
    if (!zone) return res.status(400).json({ success: false, error: 'Missing zone/region' });
    if (zone === 'all') return res.status(400).json({ success: false, error: 'Invalid zone/region' });

    // Allow passing a region (e.g. "us-central1") instead of a zone (e.g. "us-central1-a").
    // If region is provided, pick a UP zone in that region automatically.
    if (isRegionName(zone)) {
        try {
            zone = await pickZoneForRegion(req.gcp, zone);
        } catch (e) {
            return res.status(400).json({ success: false, error: e.message });
        }
    } else if (!isZoneName(zone)) {
        return res.status(400).json({ success: false, error: `Invalid zone/region: ${zone}` });
    }

    // Firewall Check (Async)
    ensureFirewallRules(req.gcp).catch(console.error);

    // Image Mapping
    const imageMap = {
        'debian-11': 'projects/debian-cloud/global/images/family/debian-11',
        'debian-12': 'projects/debian-cloud/global/images/family/debian-12',
        'ubuntu-2004': 'projects/ubuntu-os-cloud/global/images/family/ubuntu-2004-lts',
        'ubuntu-2204': 'projects/ubuntu-os-cloud/global/images/family/ubuntu-2204-lts',
        'centos-7': 'projects/centos-cloud/global/images/family/centos-7'
    };
    const sourceImage = imageMap[image] || imageMap['debian-11'];

    // Metadata (Startup Script)
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

    // Network
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
        const [op] = await instances.insert({
            project: projectId,
            zone,
            instanceResource: {
                name,
                machineType: `zones/${zone}/machineTypes/${machineType || 'e2-micro'}`,
                disks: [{ boot: true, initializeParams: { sourceImage, diskSizeGb: diskSize || '10' } }],
                networkInterfaces: [networkInterface],
                metadata
            }
        });
        res.json({ success: true, operation: op.name });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Change IP
app.post('/api/instances/changeip', requireGCP, async (req, res) => {
    const { zone, name, ipType } = req.body;
    const { instances, operations, projectId } = req.gcp;

    try {
        const [inst] = await instances.get({ project: projectId, zone, instance: name });
        const nic = inst.networkInterfaces[0];

        if (ipType === 'ipv6') {
             // Toggle Stack Type
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
             res.json({ success: true, operation: opAdd.name });
        } else {
            // IPv4
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
            res.json({ success: true, operation: opAdd.name });
        }
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Enable IPv6 (Add v6 Button)
app.post('/api/instances/ipv6', requireGCP, async (req, res) => {
    // Reusing create/change logic effectively, but simpler: just update stack type to Dual
    // Use the Change IP logic but skip the "Disable" part if it's currently v4 only.
    // ... Implementation can be similar to Change IP v6 step 2 ...
    // For brevity, let's just reuse the logic or client call.
    // ...
    res.status(501).json({error: "Implemented via Change IP logic"}); 
});


// --- Helpers ---

function normalizeLocation(v) {
    if (v === undefined || v === null) return '';
    // Accept plain names ("us-central1-a"), or resource paths ("zones/us-central1-a"),
    // or full URLs; always reduce to the final segment.
    return String(v).trim().split('/').filter(Boolean).pop();
}

function isZoneName(v) {
    // Examples: us-central1-a, europe-west2-b, northamerica-northeast1-c
    return /^[a-z0-9]+(?:-[a-z0-9]+)*-[a-z]$/.test(v);
}

function isRegionName(v) {
    // Examples: us-central1, europe-west2, northamerica-northeast1
    return /^[a-z0-9]+(?:-[a-z0-9]+)*[0-9]$/.test(v);
}

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
    if (found.length === 0) {
        throw new Error(`No available zones found in region: ${region}`);
    }
    return found[0];
}

async function ensureSubnetIPv6(gcp, zone) {
    const { subnets, regionOperations, projectId } = gcp;
    const region = zoneToRegion(zone);
    const subnetName = 'default';
    
    const [subnet] = await subnets.get({ project: projectId, region, subnetwork: subnetName });
    if (subnet.stackType !== 'IPV4_IPV6') {
        const [op] = await subnets.patch({
            project: projectId, region, subnetwork: subnetName,
            subnetworkResource: {
                stackType: 'IPV4_IPV6', ipv6AccessType: 'EXTERNAL', fingerprint: subnet.fingerprint
            }
        });
        await regionOperations.wait({ project: projectId, region, operation: op.name });
    }
}

async function ensureFirewallRules(gcp) {
    const { firewalls, projectId } = gcp;
    // ... Same firewall logic as before ...
    const fw4Name = 'default-allow-all-ipv4';
    try { await firewalls.get({ project: projectId, firewall: fw4Name }); } 
    catch { 
        try { await firewalls.insert({ project: projectId, firewallResource: {
            name: fw4Name, network: 'global/networks/default', direction: 'INGRESS', priority: 1000,
            sourceRanges: ['0.0.0.0/0'], allowed: [{ IPProtocol: 'all' }]
        }}); } catch {} 
    }
    const fw6Name = 'default-allow-all-ipv6';
    try { await firewalls.get({ project: projectId, firewall: fw6Name }); } 
    catch { 
        try { await firewalls.insert({ project: projectId, firewallResource: {
            name: fw6Name, network: 'global/networks/default', direction: 'INGRESS', priority: 1000,
            sourceRanges: ['::/0'], allowed: [{ IPProtocol: 'all' }]
        }}); } catch {} 
    }
}

app.listen(port, () => {
    console.log(`GCP Panel running at http://localhost:${port}`);
});
