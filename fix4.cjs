const fs = require('fs');

let content = fs.readFileSync('src/Differs.jsx', 'utf8');

// The garbled chars are Unicode Private Use / mojibake characters
// Each original UTF-8 emoji byte was treated as a latin-1 codepoint
// and stored as its own Unicode character.
// 
// E.g. 🌡️ = UTF-8 bytes: F0 9F 8C A1 EF B8 8F
// Each byte became a char: U+00F0 U+009F U+008C U+00A1 U+00EF U+00B8 U+008F
//
// To fix: find sequences of these "byte-codepoint" chars and re-assemble as proper chars.

// Build mapping: garbled char sequence string -> correct emoji/char
// Garbled = each UTF-8 byte as a Unicode codepoint U+00xx

function bytesToGarbled(bytes) {
  return bytes.map(b => String.fromCharCode(b)).join('');
}

function bytesToCorrect(bytes) {
  return Buffer.from(bytes).toString('utf8');
}

const emojiMap = [
  // 🌡️ U+1F321 U+FE0F  -> UTF8: F0 9F 8C A1  +  EF B8 8F
  [[0xF0,0x9F,0x8C,0xA1,0xEF,0xB8,0x8F], '🌡️'],
  // 🌡 U+1F321 -> UTF8: F0 9F 8C A1
  [[0xF0,0x9F,0x8C,0xA1], '🌡'],
  // 🟢 U+1F7E2 -> UTF8: F0 9F 9F A2
  [[0xF0,0x9F,0x9F,0xA2], '🟢'],
  // 🟡 U+1F7E1 -> UTF8: F0 9F 9F A1
  [[0xF0,0x9F,0x9F,0xA1], '🟡'],
  // 🔴 U+1F534 -> UTF8: F0 9F 94 B4
  [[0xF0,0x9F,0x94,0xB4], '🔴'],
  // ✅ U+2705 -> UTF8: E2 9C 85
  [[0xE2,0x9C,0x85], '✅'],
  // ⚠️ U+26A0 U+FE0F -> UTF8: E2 9A A0 EF B8 8F
  [[0xE2,0x9A,0xA0,0xEF,0xB8,0x8F], '⚠️'],
  // ⚠ U+26A0 -> UTF8: E2 9A A0
  [[0xE2,0x9A,0xA0], '⚠'],
  // 🛑 U+1F6D1 -> UTF8: F0 9F 9B 91
  [[0xF0,0x9F,0x9B,0x91], '🛑'],
  // 📊 U+1F4CA -> UTF8: F0 9F 93 8A
  [[0xF0,0x9F,0x93,0x8A], '📊'],
  // ⏰ U+23F0 -> UTF8: E2 8F B0
  [[0xE2,0x8F,0xB0], '⏰'],
  // — U+2014 -> UTF8: E2 80 94
  [[0xE2,0x80,0x94], '—'],
  // … U+2026 -> UTF8: E2 80 A6
  [[0xE2,0x80,0xA6], '…'],
  // → U+2192 -> UTF8: E2 86 92
  [[0xE2,0x86,0x92], '→'],
  // ↳ U+21B3 -> UTF8: E2 86 B3
  [[0xE2,0x86,0xB3], '↳'],
  // · U+00B7 -> UTF8: C2 B7
  [[0xC2,0xB7], '·'],
  // 🎯 U+1F3AF -> UTF8: F0 9F 8E AF
  [[0xF0,0x9F,0x8E,0xAF], '🎯'],
  // 🛠️ U+1F6E0 U+FE0F -> UTF8: F0 9F 9B A0 EF B8 8F
  [[0xF0,0x9F,0x9B,0xA0,0xEF,0xB8,0x8F], '🛠️'],
  // 🛠 U+1F6E0 -> UTF8: F0 9F 9B A0
  [[0xF0,0x9F,0x9B,0xA0], '🛠'],
  // 👀 U+1F440 -> UTF8: F0 9F 91 80
  [[0xF0,0x9F,0x91,0x80], '👀'],
  // – U+2013 -> UTF8: E2 80 93
  [[0xE2,0x80,0x93], '–'],
  // ★ U+2605 -> UTF8: E2 98 85
  [[0xE2,0x98,0x85], '★'],
  // ≥ U+2265 -> UTF8: E2 89 A5
  [[0xE2,0x89,0xA5], '≥'],
  // ✓ U+2713 -> UTF8: E2 9C 93
  [[0xE2,0x9C,0x93], '✓'],
  // ● U+25CF -> UTF8: E2 97 8F
  [[0xE2,0x97,0x8F], '●'],
  // ■ U+25A0 -> UTF8: E2 96 A0
  [[0xE2,0x96,0xA0], '■'],
  // ▶ U+25B6 -> UTF8: E2 96 B6
  [[0xE2,0x96,0xB6], '▶'],
  // × U+00D7 -> UTF8: C3 97
  [[0xC3,0x97], '×'],
  // variation selector U+FE0F -> UTF8: EF B8 8F
  [[0xEF,0xB8,0x8F], '\uFE0F'],
  // ─ U+2500 (box drawing) -> UTF8: E2 94 80
  [[0xE2,0x94,0x80], '─'],
  // " U+201C -> UTF8: E2 80 9C
  [[0xE2,0x80,0x9C], '\u201C'],
  // " U+201D -> UTF8: E2 80 9D
  [[0xE2,0x80,0x9D], '\u201D'],
  // ☆ U+2606 -> UTF8: E2 98 86
  [[0xE2,0x98,0x86], '☆'],
];

let totalFixes = 0;

// Sort by longest sequence first to avoid partial matches
emojiMap.sort((a,b) => b[0].length - a[0].length);

for(const [bytes, correct] of emojiMap) {
  const garbled = bytesToGarbled(bytes);
  const count = content.split(garbled).length - 1;
  if(count > 0) {
    content = content.split(garbled).join(correct);
    console.log(`Fixed ${count}x ${correct} (${bytes.map(b=>b.toString(16)).join(' ')})`);
    totalFixes += count;
  }
}

console.log(`\nTotal: ${totalFixes} fixes`);

// Remove BOM if present
if(content.charCodeAt(0) === 0xFEFF) {
  content = content.substring(1);
  console.log('Removed BOM');
}

fs.writeFileSync('src/Differs.jsx', content, {encoding:'utf8'});
console.log('Saved!');

// Verify
const v = fs.readFileSync('src/Differs.jsx', 'utf8');
const lines = v.split('\n');
for(let i=0;i<lines.length;i++){
  if(lines[i].includes('Digit Heatmap') && lines[i].includes('ticks')) {
    console.log('\nHeatmap line:', lines[i].substring(20,80));
    break;
  }
}
for(let i=0;i<lines.length;i++){
  if(lines[i].includes('Good time to trade')) {
    console.log('Status line OK:', lines[i].substring(50,100));
    break;
  }
}
