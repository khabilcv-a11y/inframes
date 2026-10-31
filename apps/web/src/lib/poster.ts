import QRCode from 'qrcode';

export interface PosterInput { organisation: string; title: string; description?: string | null; link: string; hashtags?: string | null; lang: 'en' | 'ml' | 'hi' }

const LINES = {
  en: { scan: 'Scan to get your frame', steps: ['1. Scan the code', '2. Add your photo and name', '3. Share it everywhere'] },
  ml: { scan: 'നിങ്ങളുടെ ഫ്രെയിം ലഭിക്കാൻ സ്കാൻ ചെയ്യൂ', steps: ['1. കോഡ് സ്കാൻ ചെയ്യൂ', '2. ഫോട്ടോയും പേരും ചേർക്കൂ', '3. എല്ലായിടത്തും പങ്കിടൂ'] },
  hi: { scan: 'अपना फ़्रेम पाने के लिए स्कैन करें', steps: ['1. कोड स्कैन करें', '2. फ़ोटो और नाम जोड़ें', '3. हर जगह शेयर करें'] }
} as const;

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = []; let line = '';
  for (const w of text.split(/\s+/)) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t;
  }
  if (line) out.push(line);
  return out;
}

/** A4 poster, drawn on a canvas so Malayalam and Hindi render properly, then placed in a PDF.
 *  Carries only the organiser's wording: no InFrame name, logo or URL. */
export async function makePosterPdf(p: PosterInput): Promise<Blob> {
  const W = 2480, H = 3508; // A4 at 300 dpi
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d')!;
  const L = LINES[p.lang];
  await Promise.all(['700 80px "Space Grotesk"', '500 40px "Inter"', '700 40px "Noto Sans Malayalam"', '700 40px "Mukta"'].map((f) => document.fonts.load(f, p.title + L.scan + 'അ अ').catch(() => undefined)));

  x.fillStyle = '#FFFFFF'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#16161A'; x.fillRect(0, 0, W, 520);
  x.fillStyle = '#E8553D'; x.fillRect(0, 520, W, 24);

  x.textAlign = 'center'; x.textBaseline = 'alphabetic';
  x.fillStyle = '#FFFFFF'; x.font = '700 110px "Space Grotesk", "Noto Sans Malayalam", "Mukta", sans-serif';
  x.fillText(p.organisation.toUpperCase(), W / 2, 320, W - 240);

  x.fillStyle = '#16161A'; x.font = '700 190px "Space Grotesk", "Noto Sans Malayalam", "Mukta", sans-serif';
  let y = 860; const tl = wrapLines(x, p.title, W - 360).slice(0, 3);
  for (const l of tl) { x.fillText(l, W / 2, y); y += 215; }

  if (p.description) {
    x.fillStyle = '#55555e'; x.font = '500 84px "Inter", "Noto Sans Malayalam", "Mukta", sans-serif';
    for (const l of wrapLines(x, p.description, W - 420).slice(0, 2)) { y += 40; x.fillText(l, W / 2, y + 60); y += 70; }
  }

  // QR with viewfinder corners
  const qrSize = y > 1450 ? 940 : 1080, qx = (W - qrSize) / 2, qy = Math.max(y + 110, 1440);
  const qrUrl = await QRCode.toDataURL(p.link, { margin: 1, width: qrSize, errorCorrectionLevel: 'H', color: { dark: '#16161A', light: '#FFFFFF' } });
  const img = new Image(); await new Promise((r, j) => { img.onload = r; img.onerror = j; img.src = qrUrl; });
  x.drawImage(img, qx, qy, qrSize, qrSize);
  x.strokeStyle = '#E8553D'; x.lineWidth = 28; x.lineCap = 'round'; const g = 70, a = 170;
  for (const [cx, cy, sx, sy] of [[qx - g, qy - g, 1, 1], [qx + qrSize + g, qy - g, -1, 1], [qx - g, qy + qrSize + g, 1, -1], [qx + qrSize + g, qy + qrSize + g, -1, -1]] as const) {
    x.beginPath(); x.moveTo(cx, cy + sy * a); x.lineTo(cx, cy); x.lineTo(cx + sx * a, cy); x.stroke();
  }

  x.fillStyle = '#16161A'; x.font = '700 130px "Space Grotesk", "Noto Sans Malayalam", "Mukta", sans-serif';
  x.fillText(L.scan, W / 2, qy + qrSize + 230, W - 240);
  x.fillStyle = '#E8553D'; x.font = '600 76px "Inter", sans-serif';
  x.fillText(p.link.replace(/^https?:\/\//, ''), W / 2, qy + qrSize + 345, W - 240);

  x.fillStyle = '#16161A'; x.font = '500 78px "Inter", "Noto Sans Malayalam", "Mukta", sans-serif';
  let sy = qy + qrSize + 460;
  for (const s of L.steps) { x.fillText(s, W / 2, sy); sy += 100; }
  if (p.hashtags) { x.fillStyle = '#E8553D'; x.font = '700 84px "Space Grotesk", sans-serif'; x.fillText(p.hashtags, W / 2, Math.min(H - 90, sy + 70), W - 240); }

  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  pdf.addImage(c.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297);
  return pdf.output('blob');
}
