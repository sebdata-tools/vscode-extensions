// Draws icon.png (256x256): a dark rounded tile with a small request table. No dependencies.
//   node tools/icon.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'icon.png');
const S = 256, SS = 4; // 4x4 supersampling
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const shapes = [];
const rr = (x, y, w, h, r, color) => shapes.push({ x, y, w, h, r, c: hex(color) });
rr(8, 8, 240, 240, 44, '#1f2a37');           // tile
rr(36, 44, 184, 20, 6, '#3b4a5c');            // header row
const rowsY = [80, 110, 140, 170, 200];
const status = ['#3fb950', '#3fb950', '#d29922', '#3fb950', '#f85149'];
const widths = [112, 86, 122, 64, 100];
rowsY.forEach((y, i) => {
    rr(36, y, 22, 16, 5, status[i]);          // status chip
    rr(68, y + 2, widths[i], 12, 4, '#9fb1c5'); // url bar
    rr(198, y + 2, 22, 12, 4, '#5b6f86');     // size
});
const inside = (s, px, py) => {
    if (px < s.x || py < s.y || px >= s.x + s.w || py >= s.y + s.h) return false;
    const cx = Math.max(s.x + s.r, Math.min(s.x + s.w - s.r, px));
    const cy = Math.max(s.y + s.r, Math.min(s.y + s.h - s.r, py));
    return (px - cx) ** 2 + (py - cy) ** 2 <= s.r ** 2;
};
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
    raw[y * (S * 4 + 1)] = 0;
    for (let x = 0; x < S; x++) {
        let r = 0, g = 0, b = 0, a = 0;
        for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
            const px = x + (sx + 0.5) / SS, py = y + (sy + 0.5) / SS;
            let c = null;
            for (const s of shapes) if (inside(s, px, py)) c = s.c;
            if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
        }
        const o = y * (S * 4 + 1) + 1 + x * 4;
        if (a) { raw[o] = Math.round(r / a); raw[o + 1] = Math.round(g / a); raw[o + 2] = Math.round(b / a); }
        raw[o + 3] = Math.round((a / (SS * SS)) * 255);
    }
}
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const v of buf) c = crcTable[(c ^ v) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
};
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
fs.writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
console.log('wrote', out);
