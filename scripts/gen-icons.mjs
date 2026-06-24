// Generates PWA PNG icons with no external dependencies (pure Node PNG encoder).
// Produces a simple "usage dashboard" glyph: indigo tile with three usage bars.
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  const idat = deflateSync(raw, { level: 9 })
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

function setPx(buf, w, x, y, [r, g, b, a]) {
  if (x < 0 || y < 0 || x >= w) return
  const i = (y * w + x) * 4
  // simple alpha-over composite onto existing pixel
  const ia = a / 255
  buf[i] = Math.round(r * ia + buf[i] * (1 - ia))
  buf[i + 1] = Math.round(g * ia + buf[i + 1] * (1 - ia))
  buf[i + 2] = Math.round(b * ia + buf[i + 2] * (1 - ia))
  buf[i + 3] = Math.max(buf[i + 3], a)
}

function inRoundRect(x, y, rx, ry, rw, rh, r) {
  if (x < rx || y < ry || x >= rx + rw || y >= ry + rh) return false
  const cx = Math.min(Math.max(x, rx + r), rx + rw - r)
  const cy = Math.min(Math.max(y, ry + r), ry + rh - r)
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= r * r
}

function fillRoundRect(buf, w, h, rx, ry, rw, rh, r, color) {
  const x0 = Math.max(0, Math.floor(rx))
  const y0 = Math.max(0, Math.floor(ry))
  const x1 = Math.min(w, Math.ceil(rx + rw))
  const y1 = Math.min(h, Math.ceil(ry + rh))
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) if (inRoundRect(x, y, rx, ry, rw, rh, r)) setPx(buf, w, x, y, color)
}

function makeIcon(size, maskable) {
  const buf = Buffer.alloc(size * size * 4, 0) // transparent
  const indigo = [79, 70, 229, 255]
  // Tile: full-bleed for maskable, padded rounded square otherwise.
  if (maskable) {
    fillRoundRect(buf, size, size, 0, 0, size, size, 0, indigo)
  } else {
    const pad = Math.round(size * 0.06)
    fillRoundRect(buf, size, size, pad, pad, size - 2 * pad, size - 2 * pad, size * 0.22, indigo)
  }
  // Three usage bars inside the safe area.
  const inset = maskable ? size * 0.26 : size * 0.24
  const innerW = size - 2 * inset
  const barH = size * 0.085
  const gap = size * 0.075
  const r = barH / 2
  const startY = (size - (barH * 3 + gap * 2)) / 2
  const bars = [
    { frac: 0.72, color: [199, 210, 254, 255] },
    { frac: 0.45, color: [165, 243, 252, 255] },
    { frac: 0.9, color: [129, 140, 248, 255] },
  ]
  bars.forEach((bar, i) => {
    const y = startY + i * (barH + gap)
    // track
    fillRoundRect(buf, size, size, inset, y, innerW, barH, r, [255, 255, 255, 40])
    // fill
    fillRoundRect(buf, size, size, inset, y, innerW * bar.frac, barH, r, bar.color)
  })
  return encodePNG(size, size, buf)
}

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(join(OUT_DIR, 'icon-192.png'), makeIcon(192, false))
writeFileSync(join(OUT_DIR, 'icon-512.png'), makeIcon(512, false))
writeFileSync(join(OUT_DIR, 'icon-512-maskable.png'), makeIcon(512, true))
console.log('Wrote icons to', OUT_DIR)
