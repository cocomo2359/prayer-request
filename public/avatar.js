/* Prayer Wall – Duolingo-style avatar characters, drawn as inline SVG.
 *
 * A character is stored as text, e.g. "c1:23104512": the prefix "c1:" then one digit per part,
 * in the order of PARTS below. Older accounts may still have a single emoji; that is shown as-is.
 * Keep the part counts in step with AVATAR_PARTS in worker/src/index.js.
 */
(() => {
  const INK = '#3c3c3c';
  const MOUTH = '#a3343c';

  const BG = ['#58cc02', '#1cb0f6', '#ff9600', '#ce82ff', '#ff4b4b', '#ffc800', '#2b70c9', '#ff86d0'];
  const SKIN = ['#ffe0c2', '#f6c99b', '#e2a46d', '#c47f4a', '#8d5524', '#5c3a21'];
  const HAIR_COLOR = ['#2c1b10', '#5a3418', '#8b5a2b', '#a33d1c', '#f2c94c', '#e07b39', '#b9b9b9', '#1cb0f6'];
  const OUTFIT = ['#1cb0f6', '#58cc02', '#ff4b4b', '#ce82ff', '#ff9600', '#ffc800', '#4b4b4b', '#ffffff'];

  // [part key, label, number of choices, labels for the choice buttons (null = colour swatches)]
  const PARTS = [
    ['bg', 'Background', BG.length, null],
    ['skin', 'Skin', SKIN.length, null],
    ['hair', 'Hair', 8, ['None', 'Short', 'Spiky', 'Swoop', 'Long', 'Bun', 'Curly', 'Ponytail']],
    ['hairColor', 'Hair colour', HAIR_COLOR.length, null],
    ['eyes', 'Eyes', 5, ['Bright', 'Happy', 'Wink', 'Big', 'Sleepy']],
    ['mouth', 'Mouth', 4, ['Smile', 'Grin', 'Wow', 'Calm']],
    ['outfit', 'Outfit', OUTFIT.length, null],
    ['acc', 'Extra', 6, ['None', 'Glasses', 'Shades', 'Cap', 'Flower', 'Halo']],
  ];
  const SWATCHES = { bg: BG, skin: SKIN, hairColor: HAIR_COLOR, outfit: OUTFIT };
  const RE = new RegExp(`^c1:\\d{${PARTS.length}}$`);

  function decode(value) {
    if (typeof value !== 'string' || !RE.test(value)) return null;
    const d = value.slice(3).split('').map(Number);
    if (d.some((n, i) => n >= PARTS[i][2])) return null;
    return Object.fromEntries(PARTS.map(([k], i) => [k, d[i]]));
  }
  const encode = (c) => 'c1:' + PARTS.map(([k]) => c[k]).join('');
  const random = () => encode(Object.fromEntries(PARTS.map(([k, , n]) => [k, Math.floor(Math.random() * n)])));

  // ---- drawing (viewBox 0 0 100 100, clipped to a circle) ----
  const shade = (hex, amt) => {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => Math.max(0, Math.min(255, Math.round(v * (1 + amt))));
    return '#' + [n >> 16, (n >> 8) & 255, n & 255].map((v) => f(v).toString(16).padStart(2, '0')).join('');
  };

  // With a cap on, only hair that hangs below the cap is drawn.
  function hairBack(style, col, cap) {
    switch (style) {
      case 4: return `<path d="M23 46 C21 18 38 12 50 12 C62 12 79 18 77 46 L80 84 C70 90 30 90 20 84 Z" fill="${col}"/>`;
      case 5: return cap ? '' : `<circle cx="50" cy="13" r="11" fill="${col}"/>`;
      case 6: return [[27, 44], [26, 31], [33, 20], [43, 13], [57, 13], [67, 20], [74, 31], [73, 44]]
        .filter(([, y]) => !cap || y > 35)
        .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="11" fill="${col}"/>`).join('');
      case 7: return `<path d="M70 32 C90 34 92 62 80 78 C78 64 76 50 68 42 Z" fill="${col}"/>`;
      default: return '';
    }
  }
  function hairFront(style, col) {
    const fringe = `<path d="M27 43 C25 22 39 16 50 16 C62 16 76 22 73 43 C69 33 61 28 50 28 C40 28 31 33 27 43Z" fill="${col}"/>`;
    switch (style) {
      case 1: return fringe;
      case 2: return `<path d="M26 43 L27 24 L34 28 L37 13 L44 23 L50 9 L56 23 L63 13 L66 28 L73 24 L74 43 C68 33 60 29 50 29 C40 29 32 33 26 43Z" fill="${col}"/>`;
      case 3: return `<path d="M26 46 C22 23 38 14 52 15 C68 16 78 26 74 45 C72 35 66 30 58 29 C50 37 38 39 26 46Z" fill="${col}"/>`;
      case 4: return `<path d="M27 46 C24 23 39 17 50 17 C61 17 76 23 73 46 C70 34 62 30 54 30 C48 34 36 36 27 46Z" fill="${col}"/>`;
      case 5: case 7: return fringe;
      case 6: return [[34, 27], [42, 22], [50, 21], [58, 22], [66, 27]]
        .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="7.5" fill="${col}"/>`).join('');
      default: return '';
    }
  }
  function eyes(style) {
    const dot = (x) => `<circle cx="${x}" cy="47" r="4.2" fill="${INK}"/><circle cx="${x + 1.4}" cy="45.6" r="1.4" fill="#fff"/>`;
    const arc = (x) => `<path d="M${x - 4.5} 48 Q${x} 42.5 ${x + 4.5} 48" fill="none" stroke="${INK}" stroke-width="2.8" stroke-linecap="round"/>`;
    switch (style) {
      case 1: return arc(40) + arc(60);
      case 2: return dot(40) + arc(60);
      case 3: return [40, 60].map((x) => `<circle cx="${x}" cy="46" r="6.5" fill="#fff" stroke="${INK}" stroke-width="1.5"/><circle cx="${x + 0.5}" cy="47" r="3.6" fill="${INK}"/><circle cx="${x + 1.8}" cy="45.5" r="1.3" fill="#fff"/>`).join('');
      case 4: return [40, 60].map((x) => `<path d="M${x - 4.5} 46 Q${x} 50 ${x + 4.5} 46" fill="none" stroke="${INK}" stroke-width="2.8" stroke-linecap="round"/>`).join('');
      default: return dot(40) + dot(60);
    }
  }
  function mouth(style) {
    switch (style) {
      case 1: return `<path d="M41 57 Q50 70 59 57 Z" fill="${MOUTH}" stroke="${MOUTH}" stroke-width="1.5" stroke-linejoin="round"/><path d="M45 63.5 Q50 66.5 55 63.5 Q50 61.5 45 63.5Z" fill="#ff8a96"/>`;
      case 2: return `<ellipse cx="50" cy="61" rx="3.6" ry="4.2" fill="${MOUTH}"/>`;
      case 3: return `<path d="M45 60 Q50 63 55 60" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>`;
      default: return `<path d="M43 58 Q50 66 57 58" fill="none" stroke="${INK}" stroke-width="2.8" stroke-linecap="round"/>`;
    }
  }
  function accessory(style, c) {
    switch (style) {
      case 1: return `<g fill="rgba(255,255,255,.18)" stroke="${INK}" stroke-width="2.2"><circle cx="40" cy="47" r="7.5"/><circle cx="60" cy="47" r="7.5"/></g><path d="M47.5 46 Q50 44 52.5 46" fill="none" stroke="${INK}" stroke-width="2.2"/>`;
      case 2: return `<g fill="#222"><rect x="31" y="41" width="17" height="11" rx="5"/><rect x="52" y="41" width="17" height="11" rx="5"/></g><path d="M48 45 H52" stroke="#222" stroke-width="2.5"/><path d="M34 44 L40 44" stroke="#fff" stroke-width="1.5" stroke-linecap="round" opacity=".6"/>`;
      case 3: {
        const cap = c.outfit === 7 ? '#ff4b4b' : OUTFIT[c.outfit];
        return `<path d="M25 37 C24 15 76 15 75 37 Z" fill="${cap}"/><path d="M50 34 L86 35 Q89 39 84 40 L50 39 Z" fill="${shade(cap, -0.2)}"/><circle cx="50" cy="16" r="3" fill="${shade(cap, -0.2)}"/>`;
      }
      case 4: return `<g transform="translate(69 25)">${[0, 72, 144, 216, 288].map((a) => `<circle cx="0" cy="-5.5" r="4.5" fill="#ff86d0" transform="rotate(${a})"/>`).join('')}<circle r="3.6" fill="#ffc800"/></g>`;
      case 5: return `<ellipse cx="50" cy="9" rx="17" ry="4.5" fill="none" stroke="#ffd84a" stroke-width="3.5"/>`;
      default: return '';
    }
  }

  let uid = 0;
  function svg(c, label) {
    const id = 'avc' + ++uid;
    const skin = SKIN[c.skin];
    const hair = HAIR_COLOR[c.hairColor];
    const top = OUTFIT[c.outfit];
    return `<svg viewBox="0 0 100 100" role="img" aria-label="${label}" xmlns="http://www.w3.org/2000/svg">
      <defs><clipPath id="${id}"><circle cx="50" cy="50" r="50"/></clipPath></defs>
      <g clip-path="url(#${id})">
        <rect width="100" height="100" fill="${BG[c.bg]}"/>
        <circle cx="78" cy="20" r="26" fill="#fff" opacity=".12"/>
        ${hairBack(c.hair, hair, c.acc === 3)}
        <path d="M16 104 C16 80 32 71 50 71 C68 71 84 80 84 104 Z" fill="${top}" stroke="${shade(top, -0.15)}" stroke-width="1.5"/>
        <path d="M43 71 L50 79 L57 71" fill="none" stroke="${shade(top, -0.25)}" stroke-width="2.5" stroke-linejoin="round"/>
        <rect x="43.5" y="60" width="13" height="13" rx="4" fill="${shade(skin, -0.12)}"/>
        <circle cx="27" cy="49" r="6" fill="${skin}"/><circle cx="73" cy="49" r="6" fill="${skin}"/>
        <ellipse cx="50" cy="45" rx="23" ry="24" fill="${skin}"/>
        ${c.acc === 3 ? '' : hairFront(c.hair, hair)}
        <ellipse cx="34" cy="56" rx="4.5" ry="2.8" fill="#ff7b8f" opacity=".35"/><ellipse cx="66" cy="56" rx="4.5" ry="2.8" fill="#ff7b8f" opacity=".35"/>
        ${eyes(c.eyes)}${mouth(c.mouth)}${accessory(c.acc, c)}
      </g></svg>`;
  }

  const escText = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  /** Markup for an avatar bubble. `value` is a character code or a legacy emoji. */
  function html(value, cls = '', label = 'Avatar') {
    const c = decode(value);
    if (!c) return `<span class="avatar ${cls}">${escText(value || '🙂')}</span>`;
    return `<span class="avatar char ${cls}">${svg(c, escText(label))}</span>`;
  }

  window.Avatar = { PARTS, SWATCHES, decode, encode, random, html };
})();
