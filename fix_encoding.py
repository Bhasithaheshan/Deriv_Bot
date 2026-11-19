import re

with open('src/Differs.jsx', 'rb') as f:
    raw = f.read()

content = raw.decode('utf-8', errors='replace')

fixes = {
    '\u00f0\u0178\u008c\u00a1\u00ef\u00b8\u008f': '\U0001f321\ufe0f',
    '\u00f0\u0178\u009f\u00a2': '\U0001f7e2',
    '\u00f0\u0178\u009f\u00a1': '\U0001f7e1',
    '\u00f0\u0178\u009f\u0094': '\U0001f7e4',
    '\u00e2\u009c\u0085': '\u2705',
    '\u00e2\u009a \u00ef\u00b8\u008f': '\u26a0\ufe0f',
    '\u00f0\u0178\u009b\u2019': '\U0001f6d1',
    '\u00f0\u0178\u201d\u008a': '\U0001f4ca',
    '\u00e2\u00b0': '\u23f0',
    '\u00e2\u20ac\u201d': '\u2014',
    '\u00e2\u20ac\u00a6': '\u2026',
    '\u00e2\u2020\u2019': '\u2192',
    '\u00e2\u2020\u00b3': '\u21b3',
    '\u00c2\u00b7': '\u00b7',
    '\u00f0\u0178\u008e\u00af': '\U0001f3af',
    '\u00f0\u0178\u009b ': '\U0001f6e0\ufe0f',
    '\u00f0\u0178\u2019\u20ac': '\U0001f440',
    '\u00e2\u20ac\u201c': '\u2013',
    '\u00e2\u02dc\u2026': '\u2605',
    '\u00e2\u2030\u00a5': '\u2265',
    '\u00e2\u20ac\u201c': '\u2013',
}

for broken, correct in fixes.items():
    count = content.count(broken)
    if count:
        print(f'Fixed {count}x')
        content = content.replace(broken, correct)

with open('src/Differs.jsx', 'w', encoding='utf-8', newline='\n') as f:
    f.write(content)

print('Done!')
