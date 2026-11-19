import { readFileSync, writeFileSync } from 'fs';

// Read as binary buffer
const buf = readFileSync('src/Differs.jsx');

// The file was written with wrong encoding - UTF-8 bytes read as Latin-1 and re-encoded
// We need to decode as latin-1 (each byte = char code), then encode proper UTF-8
// Actually the file bytes are: UTF-8 sequences that were each treated as separate latin-1 chars
// and then re-encoded as UTF-8 again (double-encoded UTF-8)

// Convert buffer to latin-1 string (byte by byte)
let latin1 = '';
for (let i = 0; i < buf.length; i++) {
  latin1 += String.fromCharCode(buf[i]);
}

// Now decode the latin-1 string as if it were UTF-8 bytes
// This reverses the double-encoding
const fixed = Buffer.from(latin1, 'latin1').toString('utf8');

// Write back as proper UTF-8
writeFileSync('src/Differs.jsx', fixed, { encoding: 'utf8' });

// Verify a few key strings
const check = readFileSync('src/Differs.jsx', 'utf8');
const hasThermometer = check.includes('\u{1F321}');  // 🌡
const hasClock = check.includes('\u23F0');           // ⏰
const hasCheckmark = check.includes('\u2705');       // ✅
const hasChart = check.includes('\u{1F4CA}');        // 📊

console.log('🌡 Thermometer:', hasThermometer ? 'OK' : 'MISSING');
console.log('⏰ Clock:', hasClock ? 'OK' : 'MISSING');
console.log('✅ Checkmark:', hasCheckmark ? 'OK' : 'MISSING');
console.log('📊 Chart:', hasChart ? 'OK' : 'MISSING');
console.log('File size:', check.length, 'chars');
console.log('Done!');
