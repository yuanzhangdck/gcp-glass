const { InstancesClient } = require('@google-cloud/compute');
const client = new InstancesClient();
console.log(Object.getOwnPropertyNames(Object.getPrototypeOf(client)));
