/** Generates branded illustrative SVG images for DEMO menu items (no third-party imagery). */

const glyphs: Record<string, string> = {
  coffee: `
    <ellipse cx="300" cy="300" rx="150" ry="34" fill="none" stroke="url(#s)" stroke-width="6"/>
    <path d="M205 190 h170 v60 a85 85 0 0 1 -170 0 z" fill="url(#c)" stroke="url(#s)" stroke-width="6"/>
    <path d="M375 205 a32 32 0 0 1 0 64" fill="none" stroke="url(#s)" stroke-width="10" stroke-linecap="round"/>
    <ellipse cx="290" cy="192" rx="85" ry="14" fill="#2a1a12" stroke="url(#s)" stroke-width="4"/>
    <path d="M270 120 q-14 -22 0 -44 M300 125 q-14 -24 0 -50 M330 120 q-14 -22 0 -44" fill="none" stroke="#c9c3e6" stroke-opacity=".55" stroke-width="5" stroke-linecap="round"/>`,
  hot: `
    <path d="M215 160 h150 v120 a40 40 0 0 1 -40 40 h-70 a40 40 0 0 1 -40 -40 z" fill="url(#c)" stroke="url(#s)" stroke-width="6"/>
    <path d="M365 185 a36 36 0 0 1 0 72" fill="none" stroke="url(#s)" stroke-width="10" stroke-linecap="round"/>
    <path d="M250 160 v-25 M250 135 l-14 -10" stroke="#c9c3e6" stroke-width="3"/><rect x="226" y="98" width="24" height="28" rx="3" fill="#8b5cf6"/>
    <path d="M280 120 q-12 -20 0 -40 M315 120 q-12 -20 0 -40" fill="none" stroke="#c9c3e6" stroke-opacity=".5" stroke-width="5" stroke-linecap="round"/>`,
  cold: `
    <path d="M230 120 h140 l-18 210 a20 20 0 0 1 -20 18 h-64 a20 20 0 0 1 -20 -18 z" fill="url(#c)" fill-opacity=".85" stroke="url(#s)" stroke-width="6"/>
    <rect x="258" y="170" width="34" height="34" rx="6" fill="#fff" fill-opacity=".25" transform="rotate(12 275 187)"/>
    <rect x="300" y="200" width="30" height="30" rx="6" fill="#fff" fill-opacity=".22" transform="rotate(-10 315 215)"/>
    <path d="M320 80 l-30 260" stroke="#e9e5ff" stroke-width="9" stroke-linecap="round"/>`,
  breakfast: `
    <ellipse cx="300" cy="235" rx="175" ry="120" fill="url(#c)" stroke="url(#s)" stroke-width="6"/>
    <ellipse cx="300" cy="235" rx="130" ry="86" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="4"/>
    <path d="M250 200 q40 -50 90 -10 q40 30 -10 70 q-60 40 -90 0 q-20 -30 10 -60z" fill="#f5f3ff"/>
    <circle cx="295" cy="225" r="26" fill="#fbbf24"/>`,
  main: `
    <ellipse cx="300" cy="235" rx="175" ry="120" fill="url(#c)" stroke="url(#s)" stroke-width="6"/>
    <path d="M220 215 h160 l-14 40 h-132 z" fill="#d6a36a"/><path d="M226 205 q74 -60 148 0 z" fill="#e8c08a"/>
    <path d="M222 214 q78 18 156 0" stroke="#7bd88f" stroke-width="10" fill="none" stroke-linecap="round"/>
    <path d="M110 140 v190 M95 140 v50 a15 15 0 0 0 30 0 v-50 M490 140 q22 40 0 90 v100" stroke="url(#s)" stroke-width="7" fill="none" stroke-linecap="round"/>`,
  snacks: `
    <path d="M160 200 h280 a140 120 0 0 1 -280 0 z" fill="url(#c)" stroke="url(#s)" stroke-width="6"/>
    <g fill="#f2c46d" stroke="#b7862f" stroke-width="2">
      <rect x="230" y="140" width="16" height="80" rx="4" transform="rotate(-18 238 180)"/>
      <rect x="270" y="125" width="16" height="90" rx="4" transform="rotate(8 278 170)"/>
      <rect x="310" y="135" width="16" height="85" rx="4" transform="rotate(-6 318 178)"/>
      <rect x="345" y="145" width="16" height="75" rx="4" transform="rotate(20 353 182)"/>
    </g>`,
  desserts: `
    <ellipse cx="300" cy="300" rx="170" ry="36" fill="none" stroke="url(#s)" stroke-width="6"/>
    <path d="M190 285 l40 -150 l190 60 v90 z" fill="url(#c)" stroke="url(#s)" stroke-width="6" stroke-linejoin="round"/>
    <path d="M230 135 l190 60 l-30 -60 q-80 -40 -160 0z" fill="#f5f3ff" fill-opacity=".9"/>
    <circle cx="330" cy="140" r="16" fill="#e11d48"/>`,
};

const palettes: Record<string, [string, string]> = {
  coffee: ['#6b3f22', '#c08552'],
  hot: ['#7c2d12', '#f59e0b'],
  cold: ['#1d4ed8', '#a78bfa'],
  breakfast: ['#3f3f46', '#a1a1aa'],
  main: ['#27272a', '#71717a'],
  snacks: ['#78350f', '#f59e0b'],
  desserts: ['#831843', '#f472b6'],
};

function hash(s: string) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return Math.abs(h);
}

export function demoImageSvg(categoryKey: string, name: string): string {
  const glyph = glyphs[categoryKey] ?? glyphs.main;
  const [c1, c2] = palettes[categoryKey] ?? palettes.main;
  const h = hash(name);
  const glowHue = 255 + (h % 45);
  const gx = 25 + (h % 50);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 450" width="600" height="450">
  <defs>
    <radialGradient id="bg" cx="${gx}%" cy="30%" r="80%">
      <stop offset="0" stop-color="hsl(${glowHue} 70% 30%)"/><stop offset=".55" stop-color="#0d1126"/><stop offset="1" stop-color="#05050a"/>
    </radialGradient>
    <linearGradient id="c" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c2}"/><stop offset="1" stop-color="${c1}"/></linearGradient>
    <linearGradient id="s" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e5e7eb"/><stop offset="1" stop-color="#8b8fa3"/></linearGradient>
  </defs>
  <rect width="600" height="450" fill="url(#bg)"/>
  <circle cx="${100 + (h % 400)}" cy="${60 + (h % 80)}" r="120" fill="hsl(${glowHue} 90% 60%)" opacity=".10"/>
  <g transform="translate(0 30)">${glyph}</g>
  <text x="580" y="436" text-anchor="end" font-family="sans-serif" font-size="13" fill="#ffffff" fill-opacity=".35" letter-spacing="2">DEMO IMAGE</text>
</svg>`;
}
