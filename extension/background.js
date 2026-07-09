function send(tab, type) {
  if (!tab || tab.id == null) return
  chrome.tabs.sendMessage(tab.id, { type }).catch(() => {
    // 页面不在 localhost matches 内，或 content script 未注入：忽略
  })
}

chrome.action.onClicked.addListener((tab) => send(tab, 'changehere:toggle'))

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'toggle-picker') send(tab, 'changehere:toggle')
  if (command === 'locate-source') send(tab, 'changehere:locate')
})

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'changehere:capture') {
    captureElement(sender.tab, msg.rect, msg.dpr)
      .then(sendResponse)
      .catch(() => sendResponse(null))
    return true
  }
})

// 截取可见页面 → 按元素 rect（加 8px 上下文边距）裁剪 → 存到下载目录 changehere/
async function captureElement(tab, rect, dpr) {
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' })
  const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob())
  const pad = 8 * dpr
  const x = Math.max(0, rect.x * dpr - pad)
  const y = Math.max(0, rect.y * dpr - pad)
  const w = Math.min(bmp.width - x, rect.w * dpr + pad * 2)
  const h = Math.min(bmp.height - y, rect.h * dpr + pad * 2)
  if (w <= 0 || h <= 0) return null

  const canvas = new OffscreenCanvas(w, h)
  canvas.getContext('2d').drawImage(bmp, x, y, w, h, 0, 0, w, h)
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  const b64 = toBase64(await blob.arrayBuffer())

  const ts = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
  const id = await chrome.downloads.download({
    url: 'data:image/png;base64,' + b64,
    filename: `changehere/ch-${ts}.png`,
    saveAs: false,
    conflictAction: 'uniquify',
  })
  return waitForPath(id)
}

function toBase64(buf) {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  }
  return btoa(s)
}

// downloads.download 返回时文件未必落盘，轮询拿绝对路径
async function waitForPath(id) {
  for (let i = 0; i < 50; i++) {
    const [item] = await chrome.downloads.search({ id })
    if (item && item.state === 'complete' && item.filename) return item.filename
    if (item && item.state === 'interrupted') return null
    await new Promise((r) => setTimeout(r, 100))
  }
  return null
}
