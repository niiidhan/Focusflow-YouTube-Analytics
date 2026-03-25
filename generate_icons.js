// Simple Node script to generate PNG icons from canvas
// Run with: node generate_icons.js
const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const sizes = [16, 48, 128];

function drawIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Background rounded rect
  const r = size * 0.2;
  ctx.fillStyle = '#0f0f11';
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(size - r, 0);
  ctx.quadraticCurveTo(size, 0, size, r);
  ctx.lineTo(size, size - r);
  ctx.quadraticCurveTo(size, size, size - r, size);
  ctx.lineTo(r, size);
  ctx.quadraticCurveTo(0, size, 0, size - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  ctx.fill();

  // YouTube red rounded rect
  const rr = size * 0.14;
  const rrX = size * 0.1, rrY = size * 0.28;
  const rrW = size * 0.8, rrH = size * 0.44;
  ctx.fillStyle = '#FF0000';
  ctx.beginPath();
  ctx.moveTo(rrX + rr, rrY);
  ctx.lineTo(rrX + rrW - rr, rrY);
  ctx.quadraticCurveTo(rrX + rrW, rrY, rrX + rrW, rrY + rr);
  ctx.lineTo(rrX + rrW, rrY + rrH - rr);
  ctx.quadraticCurveTo(rrX + rrW, rrY + rrH, rrX + rrW - rr, rrY + rrH);
  ctx.lineTo(rrX + rr, rrY + rrH);
  ctx.quadraticCurveTo(rrX, rrY + rrH, rrX, rrY + rrH - rr);
  ctx.lineTo(rrX, rrY + rr);
  ctx.quadraticCurveTo(rrX, rrY, rrX + rr, rrY);
  ctx.closePath();
  ctx.fill();

  // White play triangle
  const cx = size / 2, cy = size / 2;
  const th = size * 0.26;
  const tw = size * 0.23;
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.moveTo(cx - tw * 0.4, cy - th / 2);
  ctx.lineTo(cx + tw * 0.8, cy);
  ctx.lineTo(cx - tw * 0.4, cy + th / 2);
  ctx.closePath();
  ctx.fill();

  return canvas.toBuffer('image/png');
}

const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir);

for (const size of sizes) {
  const buf = drawIcon(size);
  fs.writeFileSync(path.join(iconsDir, `icon${size}.png`), buf);
  console.log(`Generated icon${size}.png`);
}
console.log('Done!');
