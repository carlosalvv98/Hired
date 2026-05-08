// Deterministic per-company colors. Lookup first, hash fallback.
const KNOWN = {
  Stripe:    ['#635bff', '#fff'],
  Anthropic: ['#cc785c', '#fff'],
  Figma:     ['#1a1a1a', '#fff'],
  Notion:    ['#ffffff', '#000'],
  Linear:    ['#5e6ad2', '#fff'],
  Vercel:    ['#000000', '#fff'],
  Airbnb:    ['#FF5A5F', '#fff'],
  Canva:     ['#00C4CC', '#fff'],
  OpenAI:    ['#10a37f', '#fff'],
  Datadog:   ['#632ca6', '#fff'],
  Supabase:  ['#3ECF8E', '#0a0a0a'],
  Plaid:     ['#000000', '#fff'],
  Ramp:      ['#FFCC2D', '#000'],
  Brex:      ['#fcd853', '#000'],
  Replit:    ['#F26207', '#fff'],
  Mercury:   ['#0F172A', '#fff'],
  Coinbase:  ['#1652f0', '#fff'],
  Discord:   ['#5865f2', '#fff'],
  Rippling:  ['#feca36', '#000'],
};

const PALETTE = [
  ['#4f46e5', '#fff'],
  ['#0f766e', '#fff'],
  ['#9333ea', '#fff'],
  ['#dc2626', '#fff'],
  ['#0891b2', '#fff'],
  ['#65a30d', '#fff'],
  ['#ea580c', '#fff'],
  ['#1f2937', '#fff'],
];

export function logoColors(name) {
  if (!name) return ['#1a1a1a', '#fff'];
  if (KNOWN[name]) return KNOWN[name];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xfffffff;
  return PALETTE[h % PALETTE.length];
}
