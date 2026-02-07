const { FirewallsClient } = require('@google-cloud/compute');
const path = require('path');
const fs = require('fs');

const keyPath = path.join(__dirname, 'gcp-key.json');
const keyFile = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
const projectId = keyFile.project_id;

const firewallsClient = new FirewallsClient({ keyFilename: keyPath, projectId });

async function fixFirewall() {
    console.log('Checking Firewalls...');

    // 1. IPv4 Rule
    const fw4Name = 'default-allow-all-ipv4';
    try {
        await firewallsClient.get({ project: projectId, firewall: fw4Name });
        console.log('✅ IPv4 Rule exists.');
    } catch (e) {
        console.log('Creating IPv4 Rule...');
        try {
            await firewallsClient.insert({
                project: projectId,
                firewallResource: {
                    name: fw4Name,
                    network: 'global/networks/default',
                    direction: 'INGRESS',
                    priority: 1000,
                    sourceRanges: ['0.0.0.0/0'],
                    allowed: [{ IPProtocol: 'all' }],
                    description: 'Allow all IPv4 traffic'
                }
            });
            console.log('✅ IPv4 Rule created.');
        } catch (err) { console.error('❌ IPv4 Error:', err.message); }
    }

    // 2. IPv6 Rule
    const fw6Name = 'default-allow-all-ipv6';
    try {
        await firewallsClient.get({ project: projectId, firewall: fw6Name });
        console.log('✅ IPv6 Rule exists.');
    } catch (e) {
        console.log('Creating IPv6 Rule...');
        try {
            await firewallsClient.insert({
                project: projectId,
                firewallResource: {
                    name: fw6Name,
                    network: 'global/networks/default',
                    direction: 'INGRESS',
                    priority: 1000,
                    sourceRanges: ['::/0'],
                    allowed: [{ IPProtocol: 'all' }],
                    description: 'Allow all IPv6 traffic'
                }
            });
            console.log('✅ IPv6 Rule created.');
        } catch (err) { console.error('❌ IPv6 Error:', err.message); }
    }
}

fixFirewall();
