// 生成扩展图标：圆角靛蓝底 + 白色取景十字（选取器隐喻）
// node scripts/gen-icons.mjs
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const outDir = join(dirname(fileURLToPath(import.meta.url)), '../extension/icons')
mkdirSync(outDir, { recursive: true })

const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y)
      const o = y * (size * 4 + 1) + 1 + x * 4
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8  // bit depth
  ihdr[9] = 6  // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function drawIcon(size) {
  const c = (size - 1) / 2
  const corner = size * 0.22
  const th = Math.max(1, size / 14)      // 十字线半厚
  const arm = size * 0.36                 // 十字臂长
  const gap = size * 0.10                 // 中心留空
  const dot = size * 0.07                 // 中心点半径
  return (x, y) => {
    // 圆角矩形裁剪
    const ix = Math.min(x, size - 1 - x)
    const iy = Math.min(y, size - 1 - y)
    if (ix < corner && iy < corner) {
      const dx = corner - ix, dy = corner - iy
      if (dx * dx + dy * dy > corner * corner) return [0, 0, 0, 0]
    }
    const ax = Math.abs(x - c), ay = Math.abs(y - c)
    const onV = ax <= th && ay >= gap && ay <= arm
    const onH = ay <= th && ax >= gap && ax <= arm
    const onDot = ax * ax + ay * ay <= dot * dot
    if (onV || onH || onDot) return [255, 255, 255, 255]
    return [99, 102, 241, 255] // indigo #6366f1
  }
}

for (const size of [16, 48, 128]) {
  writeFileSync(join(outDir, `icon${size}.png`), png(size, drawIcon(size)))
  console.log(`icon${size}.png`)
}
