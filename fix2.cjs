const fs = require('fs');

// Read as raw bytes
const buf = fs.readFileSync('src/Differs.jsx');

// The content was: proper UTF-8 source
// Then PowerShell read it as UTF-8 chars, then wrote with wrong encoding
// Result: each original UTF-8 byte became a separate char, all re-encoded as UTF-8

// Strategy: treat each char in the current file as a byte value (latin-1 interpretation)
// then re-decode that byte sequence as UTF-8

// Current file bytes -> latin-1 string
const latin1str = buf.toString('latin1');
// latin-1 string bytes -> reinterpret as UTF-8
const decoded = Buffer.from(latin1str, 'latin1').toString('utf8');

// Check if we have good emoji now
const hasTherm = decoded.includes('\u{1F321}') || decoded.includes('\uD83C\uDF21');
console.log('Sample around heatmap:');
const idx = decoded.indexOf('Heatmap');
if(idx>0) console.log(JSON.stringify(decoded.substring(idx-10, idx+40)));

fs.writeFileSync('src/Differs.jsx', decoded, {encoding:'utf8'});
console.log('Written. Size:', decoded.length);

// Re-read and verify
const verify = fs.readFileSync('src/Differs.jsx', 'utf8');
const idx2 = verify.indexOf('Heatmap');
if(idx2>0) console.log('Verified:', JSON.stringify(verify.substring(idx2-10, idx2+40)));
