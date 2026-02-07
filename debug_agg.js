const { InstancesClient } = require('@google-cloud/compute');
const path = require('path');
const fs = require('fs');

const keyPath = path.join(__dirname, 'gcp-key.json');
const keyFile = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
const projectId = keyFile.project_id;

const client = new InstancesClient({ keyFilename: keyPath, projectId });

async function test() {
    console.log('Testing aggregatedListAsync...');
    try {
        const iterable = client.aggregatedListAsync({ project: projectId });
        for await (const [zone, scope] of iterable) {
            if (scope && scope.instances && scope.instances.length > 0) {
                console.log(`Zone: ${zone}`);
                console.log(`Instances: ${scope.instances.length}`);
            }
        }
    } catch (e) {
        console.error(e);
    }
}
test();
