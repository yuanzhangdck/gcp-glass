const fs = require('fs');

const path = 'gcp-panel/gcp-key.json';
const raw = fs.readFileSync(path, 'utf8');
const data = JSON.parse(raw);

let key = data.private_key;

// 1. Fix headers
key = key.replace('-----BEGIN PRIVATE KEY----- ', '-----BEGIN PRIVATE KEY-----\n');
key = key.replace(' -----END PRIVATE KEY-----', '\n-----END PRIVATE KEY-----\n');

// 2. Fix body: The body seems to have spaces that should be newlines or just removed.
//    OpenSSL usually handles one long line, but spaces might break it.
//    Let's clean the spaces inside the body.
//    We need to be careful not to remove spaces in headers (already handled).
//    Let's extract the body.

const startMarker = '-----BEGIN PRIVATE KEY-----\n';
const endMarker = '\n-----END PRIVATE KEY-----\n';

if (key.includes(startMarker) && key.includes(endMarker)) {
    const start = key.indexOf(startMarker) + startMarker.length;
    const end = key.indexOf(endMarker);
    const body = key.substring(start, end);
    const cleanBody = body.replace(/ /g, ''); // Remove spaces
    data.private_key = startMarker + cleanBody + endMarker;
    
    fs.writeFileSync(path, JSON.stringify(data, null, 2));
    console.log('Fixed private key format.');
} else {
    console.log('Could not parse key structure properly.');
    // Fallback: Just replace all spaces with nothing, then fix headers? 
    // Risky if other fields have spaces.
    // Let's assume the first replace worked for markers.
}
