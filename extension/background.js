// localhost 由 manifest content_scripts 自动注入；
// 其他站点（自家产品线上版等）在用户点击图标时靠 activeTab + scripting 按需注入。
async function ensureAndSend(tab, type) {
  if (!tab || tab.id == null) return
  try {
    await chrome.tabs.sendMessage(tab.id, { type })
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] })
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['main.js'], world: 'MAIN' })
      await chrome.tabs.sendMessage(tab.id, { type })
    } catch {
      // chrome:// 等不可注入页面，或快捷键在非 localhost 页面首次使用
      //（activeTab 只在点击图标时授予）：忽略
    }
  }
}

chrome.action.onClicked.addListener((tab) => ensureAndSend(tab, 'changehere:toggle'))

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'toggle-picker') ensureAndSend(tab, 'changehere:toggle')
  if (command === 'locate-source') ensureAndSend(tab, 'changehere:locate')
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
  // 元素可能部分出视口：clamp 到 0 后要把被裁掉的量从宽高里扣掉
  const x0 = rect.x * dpr - pad
  const y0 = rect.y * dpr - pad
  const x = Math.max(0, x0)
  const y = Math.max(0, y0)
  const w = Math.min(bmp.width - x, rect.w * dpr + pad * 2 - (x - x0))
  const h = Math.min(bmp.height - y, rect.h * dpr + pad * 2 - (y - y0))
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
