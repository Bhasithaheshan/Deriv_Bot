const fs = require('fs');

// Read the file as utf-8
let content = fs.readFileSync('src/Differs.jsx', 'utf8');

console.log('File length:', content.length);
console.log('Has BOM:', content.charCodeAt(0) === 0xFEFF);

// Show the problematic bytes around heatmap
const heatIdx = content.indexOf('Digit Heatmap');
if(heatIdx >= 0) {
  const slice = content.substring(heatIdx - 20, heatIdx + 60);
  console.log('\nAround "Digit Heatmap":');
  for(let i=0; i<slice.length; i++) {
    const code = slice.charCodeAt(i);
    if(code > 127) process.stdout.write(`[U+${code.toString(16).toUpperCase()}]`);
    else process.stdout.write(slice[i]);
  }
  console.log('\n');
}

// The garbled chars are UTF-8 sequences misread as Win-1252/Latin-1
// Check: does the file decode fine as UTF-8 already?
// The issue is the source has LITERAL garbled chars stored as UTF-8 of those garbled codepoints

// replacements: garbled -> correct
const replacements = [
  // thermometer 🌡️  (U+1F321 U+FE0F) - garbled as 4-byte UTF-8 each byte treated as latin1 char
  ['\u00f0\u009f\u008c\u00a1\u00ef\u00b8\u008f', '\u{1F321}\uFE0F'],
  // 🟢 (U+1F7E2)
  ['\u00f0\u009f\u009f\u00a2', '\u{1F7E2}'],
  // 🟡 (U+1F7E1)  
  ['\u00f0\u009f\u009f\u00a1', '\u{1F7E1}'],
  // 🔴 (U+1F534)
  ['\u00f0\u009f\u0094\u00b4', '\u{1F534}'],
  // ✅ (U+2705)
  ['\u00e2\u009c\u0085', '\u2705'],
  // ⚠️ (U+26A0 U+FE0F)
  ['\u00e2\u009a\u00a0\u00ef\u00b8\u008f', '\u26A0\uFE0F'],
  // 🛑 (U+1F6D1)
  ['\u00f0\u009f\u009b\u0091', '\u{1F6D1}'],
  // 📊 (U+1F4CA)
  ['\u00f0\u009f\u0094\u008a', '\u{1F4CA}'],
  // ⏰ (U+23F0)
  ['\u00e2\u008f\u00b0', '\u23F0'],
  // — (U+2014 em dash)
  ['\u00e2\u0080\u0094', '\u2014'],
  // … (U+2026)
  ['\u00e2\u0080\u00a6', '\u2026'],
  // → (U+2192)
  ['\u00e2\u0086\u0092', '\u2192'],
  // ↳ (U+21B3)
  ['\u00e2\u0086\u00b3', '\u21B3'],
  // · (U+00B7 middle dot)
  ['\u00c2\u00b7', '\u00B7'],
  // 🎯 (U+1F3AF)
  ['\u00f0\u009f\u008e\u00af', '\u{1F3AF}'],
  // 🛠️ (U+1F6E0 U+FE0F)
  ['\u00f0\u009f\u009b\u00a0\u00ef\u00b8\u008f', '\u{1F6E0}\uFE0F'],
  // 🛠 (without variation selector)
  ['\u00f0\u009f\u009b\u00a0', '\u{1F6E0}'],
  // 👀 (U+1F440)
  ['\u00f0\u009f\u0091\u0080', '\u{1F440}'],
  // – (U+2013 en dash)
  ['\u00e2\u0080\u0093', '\u2013'],
  // ★ (U+2605)
  ['\u00e2\u0098\u0085', '\u2605'],
  // ≥ (U+2265)
  ['\u00e2\u0089\u00a5', '\u2265'],
  // ✓ (U+2713)
  ['\u00e2\u009c\u0093', '\u2713'],
  // ● (U+25CF)
  ['\u00e2\u0097\u008f', '\u25CF'],
  // ■ (U+25A0)
  ['\u00e2\u0096\u00a0', '\u25A0'],
  // ▶ (U+25B6)
  ['\u00e2\u0096\u00b6', '\u25B6'],
  // × (U+00D7 multiplication)
  ['\u00c3\u0097', '\u00D7'],
];

let fixCount = 0;
for(const [broken, correct] of replacements) {
  const count = content.split(broken).length - 1;
  if(count > 0) {
    content = content.split(broken).join(correct);
    console.log(`Fixed ${count}x: U+${broken.charCodeAt(0).toString(16)} sequence -> ${correct}`);
    fixCount += count;
  }
}

console.log(`\nTotal fixes: ${fixCount}`);

// Remove BOM if present
if(content.charCodeAt(0) === 0xFEFF) content = content.substring(1);

fs.writeFileSync('src/Differs.jsx', content, {encoding:'utf8'});
console.log('Written!');

// Verify
const v = fs.readFileSync('src/Differs.jsx', 'utf8');
const heatIdx2 = v.indexOf('Digit Heatmap');
if(heatIdx2 >= 0) {
  console.log('\nVerify around Heatmap:');
  console.log(v.substring(heatIdx2-10, heatIdx2+50));
}
