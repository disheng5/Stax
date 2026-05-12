// scripts/gen-images.js — 用 Canvas-less 方式生成占位 PNG（仅依赖 Node 内置 zlib）
// 输出：tabBar 图标 6 张 / 默认头像 1 张 / 空状态插画 1 张 / 小程序图标 1 张
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

// ===== 极简 PNG 编码器（RGBA） =====
function crc32(buf) {
  const table = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff]
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0)
  const typ = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typ, data])), 0)
  return Buffer.concat([len, typ, data, crc])
}
function encodePNG(width, height, rgbaPixels) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  // 每行前加 0 filter
  const raw = Buffer.alloc(height * (1 + width * 4))
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0
    rgbaPixels.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const idat = zlib.deflateSync(raw)
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

// ===== 像素绘制工具 =====
function makeCanvas(w, h, bg = [0, 0, 0, 0]) {
  const buf = Buffer.alloc(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    buf[i * 4 + 0] = bg[0]
    buf[i * 4 + 1] = bg[1]
    buf[i * 4 + 2] = bg[2]
    buf[i * 4 + 3] = bg[3]
  }
  return { w, h, buf }
}
function setPx(c, x, y, [r, g, b, a]) {
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return
  const i = (y * c.w + x) * 4
  c.buf[i] = r; c.buf[i + 1] = g; c.buf[i + 2] = b; c.buf[i + 3] = a
}
function fillCircle(c, cx, cy, r, color) {
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      const d = Math.sqrt(x * x + y * y)
      if (d <= r) {
        // 抗锯齿 1px 边
        let a = color[3]
        if (d > r - 1) a = Math.round(color[3] * (r - d))
        setPx(c, Math.round(cx + x), Math.round(cy + y), [color[0], color[1], color[2], a])
      }
    }
  }
}
function fillRect(c, x0, y0, w, h, color) {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) setPx(c, x, y, color)
}
function strokeRect(c, x0, y0, w, h, color, lw = 1) {
  for (let i = 0; i < lw; i++) {
    fillRect(c, x0 + i, y0 + i, w - i * 2, 1, color)
    fillRect(c, x0 + i, y0 + h - i - 1, w - i * 2, 1, color)
    fillRect(c, x0 + i, y0 + i, 1, h - i * 2, color)
    fillRect(c, x0 + w - i - 1, y0 + i, 1, h - i * 2, color)
  }
}

// ===== 主题色 =====
const GREEN = [11, 110, 79, 255]
const GOLD  = [201, 169, 97, 255]
const RED   = [200, 16, 46, 255]
const GREY  = [136, 136, 136, 255]
const BG    = [245, 242, 234, 255]
const WHITE = [255, 255, 255, 255]

// ===== 图标绘制 =====

// 牌桌（家）图标：圆角矩形 + 圆形=筹码
function drawHome(active) {
  const c = makeCanvas(81, 81)
  const color = active ? GREEN : GREY
  // 桌面
  for (let y = 20; y < 56; y++)
    for (let x = 14; x < 67; x++) {
      const dxL = Math.max(0, 22 - x), dxR = Math.max(0, x - 58)
      const dyT = Math.max(0, 25 - y), dyB = Math.max(0, y - 50)
      const d = Math.sqrt((dxL || dxR) ** 2 + (dyT || dyB) ** 2)
      if (d < 8) setPx(c, x, y, color)
    }
  // 中央筹码
  fillCircle(c, 40, 40, 8, WHITE)
  fillCircle(c, 40, 40, 6, color)
  return encodePNG(c.w, c.h, c.buf)
}

// 学习（书本）图标
function drawLearn(active) {
  const c = makeCanvas(81, 81)
  const color = active ? GREEN : GREY
  // 左半页
  fillRect(c, 16, 22, 24, 38, color)
  // 右半页
  fillRect(c, 41, 22, 24, 38, color)
  // 中缝
  fillRect(c, 39, 22, 3, 38, BG)
  // 书签
  fillRect(c, 56, 22, 4, 12, GOLD)
  return encodePNG(c.w, c.h, c.buf)
}

// 我的（人形）图标
function drawMe(active) {
  const c = makeCanvas(81, 81)
  const color = active ? GREEN : GREY
  fillCircle(c, 40, 30, 12, color)
  // 身体（半圆）
  for (let y = 42; y < 64; y++)
    for (let x = 18; x < 63; x++) {
      const dx = x - 40, dy = y - 64
      const d = Math.sqrt(dx * dx + dy * dy * 0.5)
      if (d < 22) setPx(c, x, y, color)
    }
  return encodePNG(c.w, c.h, c.buf)
}

// 默认头像（圆形 + 单色背景）
function drawAvatar() {
  const c = makeCanvas(120, 120, BG)
  fillCircle(c, 60, 60, 58, GREEN)
  fillCircle(c, 60, 50, 18, WHITE)
  for (let y = 70; y < 100; y++)
    for (let x = 30; x < 90; x++) {
      const dx = x - 60, dy = y - 100
      if (Math.sqrt(dx * dx + dy * dy * 0.6) < 30) setPx(c, x, y, WHITE)
    }
  return encodePNG(c.w, c.h, c.buf)
}

// 空状态插画（240x240 三个筹码叠加）
function drawEmpty() {
  const c = makeCanvas(240, 240, [0, 0, 0, 0])
  fillCircle(c, 90, 130, 50, [...GREEN.slice(0, 3), 80])
  fillCircle(c, 150, 130, 50, [...GOLD.slice(0, 3), 80])
  fillCircle(c, 120, 100, 50, [...RED.slice(0, 3), 80])
  fillCircle(c, 90, 130, 30, GREEN)
  fillCircle(c, 150, 130, 30, GOLD)
  fillCircle(c, 120, 100, 30, RED)
  return encodePNG(c.w, c.h, c.buf)
}

// 小程序图标（144×144 牌桌绿底 + 白色 S）
function drawAppIcon() {
  const c = makeCanvas(144, 144, GREEN)
  // 简易 S：上下两个 c 形
  for (let y = 30; y < 70; y++)
    for (let x = 40; x < 110; x++) {
      const dxL = x - 60, dyT = y - 50
      if (Math.sqrt(dxL * dxL + dyT * dyT) < 28 && x < 90) setPx(c, x, y, WHITE)
    }
  for (let y = 70; y < 115; y++)
    for (let x = 40; x < 110; x++) {
      const dxR = x - 84, dyB = y - 92
      if (Math.sqrt(dxR * dxR + dyB * dyB) < 28 && x > 50) setPx(c, x, y, WHITE)
    }
  // 中段
  fillRect(c, 50, 64, 50, 12, GREEN)
  return encodePNG(c.w, c.h, c.buf)
}

// ===== 输出 =====
const out = path.join(__dirname, '..', 'miniprogram', 'images')
fs.mkdirSync(out, { recursive: true })
const files = {
  'tab-home.png':         drawHome(false),
  'tab-home-active.png':  drawHome(true),
  'tab-learn.png':        drawLearn(false),
  'tab-learn-active.png': drawLearn(true),
  'tab-me.png':           drawMe(false),
  'tab-me-active.png':    drawMe(true),
  'default-avatar.png':   drawAvatar(),
  'empty.png':            drawEmpty()
}
for (const [name, buf] of Object.entries(files)) {
  fs.writeFileSync(path.join(out, name), buf)
  console.log('  ✓', name, '(' + buf.length + ' bytes)')
}
// 小程序图标到 docs/
const docs = path.join(__dirname, '..', 'docs')
fs.mkdirSync(docs, { recursive: true })
fs.writeFileSync(path.join(docs, 'app-icon-144.png'), drawAppIcon())
console.log('  ✓ docs/app-icon-144.png')
