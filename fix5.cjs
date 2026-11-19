const fs = require('fs');

let content = fs.readFileSync('src/Differs.jsx', 'utf8');

// The garbled chars use Windows-1252 codepoints where UTF-8 bytes were misinterpreted
// U+00F0=ð, U+0178=Ÿ (Win1252 0x9F), U+0152=Œ (Win1252 0x8C), U+00A1=¡
// etc.
//
// Win-1252 byte -> Unicode:
// 0x80->U+20AC, 0x82->U+201A, 0x83->U+0192, 0x84->U+201E, 0x85->U+2026
// 0x86->U+2020, 0x87->U+2021, 0x88->U+02C6, 0x89->U+2030, 0x8A->U+0160
// 0x8B->U+2039, 0x8C->U+0152, 0x8E->U+017D, 0x91->U+2018, 0x92->U+2019
// 0x93->U+201C, 0x94->U+201D, 0x95->U+2022, 0x96->U+2013, 0x97->U+2014
// 0x98->U+02DC, 0x99->U+2122, 0x9A->U+0161, 0x9B->U+203A, 0x9C->U+0153
// 0x9E->U+017E, 0x9F->U+0178
// 0x80-0xBF Latin-1 control/supplement are stored as-is in Win-1252

// So our mapping must use the Win-1252 interpretations
// Let's build the reverse: for each UTF-8 byte, what Win-1252 char appears

function win1252char(byte) {
  const map = {
    0x80: '\u20AC', 0x82: '\u201A', 0x83: '\u0192', 0x84: '\u201E',
    0x85: '\u2026', 0x86: '\u2020', 0x87: '\u2021', 0x88: '\u02C6',
    0x89: '\u2030', 0x8A: '\u0160', 0x8B: '\u2039', 0x8C: '\u0152',
    0x8E: '\u017D', 0x91: '\u2018', 0x92: '\u2019', 0x93: '\u201C',
    0x94: '\u201D', 0x95: '\u2022', 0x96: '\u2013', 0x97: '\u2014',
    0x98: '\u02DC', 0x99: '\u2122', 0x9A: '\u0161', 0x9B: '\u203A',
    0x9C: '\u0153', 0x9E: '\u017E', 0x9F: '\u0178',
  };
  if(map[byte]) return map[byte];
  return String.fromCharCode(byte); // Latin-1: 0x00-0xFF direct
}

function bytesToWin1252Str(bytes) {
  return bytes.map(b => win1252char(b)).join('');
}

const emojiMap = [
  // 🌡️ U+1F321 U+FE0F  -> UTF8: F0 9F 8C A1 EF B8 8F
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
  // ─ U+2500 (box drawing) -> UTF8: E2 94 80
  [[0xE2,0x94,0x80], '─'],
  // " U+201C -> UTF8: E2 80 9C
  [[0xE2,0x80,0x9C], '\u201C'],
  // " U+201D -> UTF8: E2 80 9D
  [[0xE2,0x80,0x9D], '\u201D'],
  // ☆ U+2606 -> UTF8: E2 98 86
  [[0xE2,0x98,0x86], '☆'],
  // ☑ U+2611 -> UTF8: E2 98 91
  [[0xE2,0x98,0x91], '☑'],
  // ✗ U+2717 -> UTF8: E2 9C 97
  [[0xE2,0x9C,0x97], '✗'],
  // variation selector U+FE0F -> UTF8: EF B8 8F
  [[0xEF,0xB8,0x8F], '\uFE0F'],
];

// Sort longest first
emojiMap.sort((a,b) => b[0].length - a[0].length);

let totalFixes = 0;

for(const [bytes, correct] of emojiMap) {
  const garbled = bytesToWin1252Str(bytes);
  const count = content.split(garbled).length - 1;
  if(count > 0) {
    content = content.split(garbled).join(correct);
    console.log(`Fixed ${count}x ${correct}`);
    totalFixes += count;
  }
}

console.log(`\nTotal: ${totalFixes} fixes`);
fs.writeFileSync('src/Differs.jsx', content, {encoding:'utf8'});
console.log('Saved!');

// Verify line 209
const v = fs.readFileSync('src/Differs.jsx', 'utf8');
const vlines = v.split('\n');
console.log('\nLine 209:', vlines[208].trim().substring(0,70));
console.log('Line 274:', vlines[273].trim().substring(0,70));
