// 改这里 ChangeHere content script：
// - 选取模式：高亮元素，点击后把源码位置 + 组件链 + 样式/props 快照 + 截图路径
//   以 markdown 形式复制到剪贴板
// - 反向定位：粘贴 file:line，高亮页面上来自该行的所有元素
(() => {
  // localhost 走 manifest 自动注入，其他站点走 background 按需注入，防止重复执行
  if (window.__changehereLoaded) return
  window.__changehereLoaded = true

  let active = false
  let overlay = null
  let card = null
  let current = null
  let styleEl = null
  let locateBox = null
  let hits = []
  let childStack = [] // ↑ 选父级时记录来路，↓ 原路返回
  let recordingTrace = false

  const CSS = `
.ch-overlay{position:fixed;z-index:2147483646;pointer-events:none;display:none;
  background:rgba(99,102,241,.12);outline:1.5px solid #818cf8;outline-offset:-1px;
  border-radius:3px;transition:left .06s ease-out,top .06s ease-out,width .06s ease-out,height .06s ease-out;}
.ch-card{position:fixed;z-index:2147483647;pointer-events:none;display:none;
  background:rgba(24,24,37,.92);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
  border:1px solid rgba(255,255,255,.09);border-radius:10px;padding:7px 11px;
  box-shadow:0 8px 24px rgba(0,0,0,.35);max-width:min(60vw,560px);}
.ch-row1{display:flex;align-items:center;gap:7px;white-space:nowrap;
  font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;}
.ch-comp{background:rgba(129,140,248,.18);color:#a5b4fc;font-weight:600;
  border-radius:6px;padding:0 7px;}
.ch-file{color:#d4d4d8;overflow:hidden;text-overflow:ellipsis;}
.ch-file.ch-warn{color:#fbbf24;}
.ch-row2{margin-top:3px;font:10.5px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;
  color:#8b8b96;white-space:nowrap;}
.ch-kbd{display:inline-block;background:rgba(255,255,255,.08);border-radius:4px;
  padding:0 4px;color:#b4b4bc;font-family:ui-monospace,Menlo,monospace;font-size:10px;}
.ch-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);
  z-index:2147483647;display:flex;align-items:center;gap:8px;pointer-events:none;
  background:rgba(24,24,37,.92);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
  border:1px solid rgba(255,255,255,.09);border-radius:10px;padding:9px 16px;
  box-shadow:0 8px 24px rgba(0,0,0,.35);color:#e4e4e7;
  font:13px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;
  animation:ch-pop .18s ease-out;}
.ch-toast.ch-out{opacity:0;transform:translate(-50%,6px);transition:all .25s;}
.ch-toast .ch-ok{color:#4ade80;font-weight:700;}
.ch-toast .ch-err{color:#f87171;font-weight:700;}
@keyframes ch-pop{from{opacity:0;transform:translate(-50%,8px)}to{opacity:1;transform:translate(-50%,0)}}
.ch-active *{cursor:crosshair!important;}
.ch-locate{position:fixed;top:18px;left:50%;transform:translateX(-50%);z-index:2147483647;
  background:rgba(24,24,37,.95);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
  border:1px solid rgba(255,255,255,.09);border-radius:12px;padding:10px 12px;
  box-shadow:0 8px 24px rgba(0,0,0,.35);width:min(480px,86vw);animation:ch-pop .18s ease-out;}
.ch-locate input{width:100%;box-sizing:border-box;background:rgba(255,255,255,.07);
  border:1px solid rgba(255,255,255,.12);border-radius:7px;padding:6px 9px;
  color:#e4e4e7;font:12.5px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;outline:none;}
.ch-locate input:focus{border-color:#818cf8;}
.ch-locate .ch-row2{margin-top:6px;}
.ch-hit{outline:2px solid #f472b6!important;outline-offset:2px;
  animation:ch-pulse 1.2s ease-in-out infinite;}
@keyframes ch-pulse{0%,100%{outline-color:#f472b6}50%{outline-color:rgba(244,114,182,.2)}}
`

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg) return
    if (msg.type === 'changehere:toggle') {
      if (recordingTrace) stopTrace('manual')
      else active ? deactivate() : activate()
    }
    if (msg.type === 'changehere:locate') locateBox ? closeLocate() : openLocate()
  })

  function el(tag, cls, text) {
    const n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }

  function ensureStyle() {
    if (!styleEl || !styleEl.isConnected) {
      styleEl = el('style')
      styleEl.textContent = CSS
      document.documentElement.append(styleEl)
    }
  }

  // ---------- 选取模式 ----------

  function activate() {
    closeLocate()
    active = true
    ensureStyle()
    overlay = el('div', 'ch-overlay')
    card = el('div', 'ch-card')
    document.documentElement.append(overlay, card)
    document.documentElement.classList.add('ch-active')
    document.addEventListener('mousemove', onMove, true)
    document.addEventListener('click', onClick, true)
    document.addEventListener('mousedown', swallow, true)
    document.addEventListener('mouseup', swallow, true)
    document.addEventListener('keydown', onKey, true)
    toast('改这里：点击元素复制信息', 'Esc 退出')
  }

  function deactivate() {
    active = false
    overlay?.remove()
    card?.remove()
    overlay = card = current = null
    document.documentElement.classList.remove('ch-active')
    document.removeEventListener('mousemove', onMove, true)
    document.removeEventListener('click', onClick, true)
    document.removeEventListener('mousedown', swallow, true)
    document.removeEventListener('mouseup', swallow, true)
    document.removeEventListener('keydown', onKey, true)
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopImmediatePropagation()
      deactivate()
    } else if (e.key === 'ArrowUp' && current) {
      e.preventDefault()
      e.stopImmediatePropagation()
      const p = current.parentElement
      if (p && p !== document.body && p !== document.documentElement) {
        childStack.push(current)
        setCurrent(p)
      }
    } else if (e.key === 'ArrowDown' && childStack.length) {
      e.preventDefault()
      e.stopImmediatePropagation()
      setCurrent(childStack.pop())
    } else if (e.key.toLowerCase() === 'r' && current) {
      e.preventDefault()
      e.stopImmediatePropagation()
      startTrace(current)
    }
  }

  function startTrace(target) {
    const recorder = window.__changehereTrace
    if (!recorder || recorder.isRecording()) {
      toast('轨迹录制器不可用', null, 'err')
      return
    }
    deactivate()
    recordingTrace = true
    document.addEventListener('keydown', onTraceKey, true)
    const id = recorder.start({ target, onStop: finishTrace })
    if (!id) {
      recordingTrace = false
      document.removeEventListener('keydown', onTraceKey, true)
      toast('无法开始轨迹录制', null, 'err')
      return
    }
    toast('正在录制交互轨迹（最长 10 秒）', 'R 停止 · Esc 取消')
  }

  function onTraceKey(e) {
    if (e.key.toLowerCase() === 'r') {
      e.preventDefault()
      e.stopImmediatePropagation()
      stopTrace('manual')
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopImmediatePropagation()
      stopTrace('cancelled')
    }
  }

  function stopTrace(reason) {
    window.__changehereTrace?.stop(reason)
  }

  function finishTrace(trace) {
    recordingTrace = false
    document.removeEventListener('keydown', onTraceKey, true)
    if (trace.stopReason === 'cancelled') {
      toast('已取消轨迹录制')
      return
    }
    try {
      chrome.runtime.sendMessage(
        { type: 'changehere:trace', payload: trace },
        () => void chrome.runtime.lastError
      )
    } catch {}
    toast(`已记录 ${trace.records.length} 条源码锚定轨迹`, null, 'ok')
  }

  function swallow(e) {
    e.preventDefault()
    e.stopImmediatePropagation()
  }

  function onMove(e) {
    const target = e.target
    if (!(target instanceof Element)) return
    // 自家 UI（toast/定位框等）不可被选取
    if (target.closest('.ch-overlay,.ch-card,.ch-toast,.ch-locate')) return
    if (target === current) return
    childStack = []
    setCurrent(target)
  }

  function setCurrent(target) {
    current = target
    const r = target.getBoundingClientRect()
    overlay.style.display = 'block'
    overlay.style.left = r.left + 'px'
    overlay.style.top = r.top + 'px'
    overlay.style.width = r.width + 'px'
    overlay.style.height = r.height + 'px'

    const info = sourceOf(target)
    card.replaceChildren()
    const row1 = el('div', 'ch-row1')
    row1.append(
      el('span', 'ch-comp', `<${info?.comp || target.tagName.toLowerCase()}>`),
      info
        ? el('span', 'ch-file', `${info.file}:${info.line}`)
        : el('span', 'ch-file ch-warn',
            envOf() === 'vite-dev' ? '未接入 vite-plugin-changehere' : '生产模式 · 输出检索线索')
    )
    const row2 = el('div', 'ch-row2')
    row2.append(
      `${Math.round(r.width)}×${Math.round(r.height)}　点击复制　`,
      el('span', 'ch-kbd', 'Alt+点击'),
      ' 截图　',
      el('span', 'ch-kbd', '↑↓'),
      ' 层级　',
      el('span', 'ch-kbd', 'Esc'),
      ' 退出'
    )
    card.append(row1, row2)

    card.style.display = 'block'
    const ch = card.getBoundingClientRect()
    const top = r.top > ch.height + 12 ? r.top - ch.height - 8 : r.bottom + 8
    card.style.left = Math.max(6, Math.min(r.left, innerWidth - ch.width - 6)) + 'px'
    card.style.top = Math.max(6, top) + 'px'
  }

  async function onClick(e) {
    swallow(e)
    if (!current) return
    const target = current
    const rect = target.getBoundingClientRect()
    const wantShot = e.altKey // 截图会走下载（可能弹另存为），只在 Alt+点击 时做
    deactivate()

    let shotPromise = Promise.resolve(null)
    if (wantShot) {
      // 等两帧确保高亮框已消失，截图不带遮罩（rAF 可能被节流，超时兜底）
      await new Promise((resolve) => {
        let done = false
        const fin = () => { if (!done) { done = true; resolve() } }
        requestAnimationFrame(() => requestAnimationFrame(fin))
        setTimeout(fin, 150)
      })
      shotPromise = requestCapture(rect)
    }
    const [fiber, shot] = await Promise.all([fiberInfo(target), shotPromise])

    const md = buildMarkdown(target, rect, fiber, shot)
    copy(md).then(
      () => toast('已复制元素信息' + (shot ? '（截图已存）' : ''), null, 'ok'),
      () => toast('复制失败', null, 'err')
    )
    // 同步推给本地 MCP bridge（经 background，规避页面 CSP），没起 server 就静默丢弃
    try {
      chrome.runtime.sendMessage(
        { type: 'changehere:selection', payload: { markdown: md, url: location.href } },
        () => void chrome.runtime.lastError
      )
    } catch {}
  }

  // ---------- 数据采集 ----------

  // 解析 data-ch="Comp@src/App.tsx:12:5"
  function parseCh(v) {
    const m = /^(.*?)@(.*):(\d+):(\d+)$/.exec(v)
    return m ? { comp: m[1], file: m[2], line: +m[3], col: +m[4] } : null
  }

  function sourceOf(node) {
    const host = node.closest('[data-ch]')
    return host ? parseCh(host.getAttribute('data-ch')) : null
  }

  // 沿 DOM 向上收集组件链（按组件名去重）
  function chainOf(node) {
    const chain = []
    let host = node.closest('[data-ch]')
    while (host) {
      const info = parseCh(host.getAttribute('data-ch'))
      if (info && info.comp && chain[chain.length - 1]?.comp !== info.comp) {
        chain.push(info)
      }
      host = host.parentElement?.closest('[data-ch]') ?? null
    }
    return chain
  }

  function cssPath(target) {
    const parts = []
    let node = target
    while (node instanceof Element && parts.length < 4) {
      let part = node.tagName.toLowerCase()
      if (node.id) {
        parts.unshift(part + '#' + node.id)
        break
      }
      const cls = [...node.classList].slice(0, 3).join('.')
      if (cls) part += '.' + cls
      parts.unshift(part)
      node = node.parentElement
    }
    return parts.join(' > ')
  }

  const STYLE_KEYS = [
    'display', 'position', 'padding', 'margin', 'border', 'border-radius',
    'background-color', 'color', 'font-size', 'font-weight', 'line-height',
    'text-align', 'flex-direction', 'justify-content', 'align-items', 'gap',
    'opacity', 'overflow',
  ]
  const STYLE_DEFAULTS = {
    position: 'static', padding: '0px', margin: '0px', 'border-radius': '0px',
    opacity: '1', overflow: 'visible', 'text-align': 'start', 'font-weight': '400',
  }

  function styleSnapshot(target) {
    const cs = getComputedStyle(target)
    const flexy = cs.display.includes('flex') || cs.display.includes('grid')
    const out = []
    for (const k of STYLE_KEYS) {
      const v = cs.getPropertyValue(k)
      if (!v || v === 'normal' || v === STYLE_DEFAULTS[k]) continue
      if (k === 'border' && v.startsWith('0px')) continue
      if (!flexy && ['flex-direction', 'justify-content', 'align-items', 'gap'].includes(k)) continue
      out.push(`${k}: ${v}`)
    }
    return out.join('; ')
  }

  // 页面环境：已注入 data-ch / vite dev 但没装插件 / 生产构建
  function envOf() {
    if (document.querySelector('[data-ch]')) return 'tagged'
    if (document.querySelector('script[src*="/@vite/client"]')) return 'vite-dev'
    return 'prod'
  }

  // 生产页面拿不到源码位置时，提取能在源码里 grep 到的稳定锚点
  const ATTR_CLUES = ['data-testid', 'data-test', 'data-cy', 'aria-label', 'name', 'placeholder', 'alt', 'role', 'href']

  // CSS-in-JS / CSS Modules 哈希类对 grep 无用，滤掉
  function looksHashed(cls) {
    if (/^(css|sc|jss|jsx|emotion|svelte|chakra)-/.test(cls)) return true
    const tail = cls.split(/[-_]/).pop()
    return /^[0-9a-zA-Z]{5,}$/.test(tail) && /\d/.test(tail) && /[a-zA-Z]/.test(tail)
  }

  function grepClues(target) {
    const clues = []
    const ownText = [...target.childNodes]
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent.trim())
      .join(' ')
      .trim()
    if (ownText) clues.push(`文本: "${ownText.slice(0, 60)}"`)
    if (target.id) clues.push(`id: \`${target.id}\``)
    for (const a of ATTR_CLUES) {
      const v = target.getAttribute(a)
      if (v) clues.push(`${a}: \`${v.slice(0, 80)}\``)
    }
    const classes = [...target.classList]
    const real = classes.filter((c) => !looksHashed(c))
    const hashed = classes.length - real.length
    if (real.length) {
      clues.push(`类名: \`${real.join(' ')}\`${hashed ? `（另滤除 ${hashed} 个哈希类）` : ''}`)
    }
    // 最近的带锚点祖先，帮 agent 缩小范围
    let node = target.parentElement
    for (let i = 0; node && i < 8; i++, node = node.parentElement) {
      const testid = node.getAttribute('data-testid')
      const anchor = testid ? `[data-testid="${testid}"]` : node.id ? `#${node.id}` : null
      if (anchor) {
        clues.push(`锚点祖先: \`<${node.tagName.toLowerCase()}>\` \`${anchor}\``)
        break
      }
    }
    return clues
  }

  // 通过 MAIN world 的 main.js 读 React fiber（isolated world 读不到）
  function fiberInfo(target) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => finish(null), 300)
      function finish(v) {
        clearTimeout(timer)
        window.removeEventListener('changehere:res', onRes)
        target.removeAttribute('data-ch-picked')
        resolve(v)
      }
      function onRes(e) {
        try { finish(JSON.parse(e.detail)) } catch { finish(null) }
      }
      window.addEventListener('changehere:res', onRes)
      target.setAttribute('data-ch-picked', '')
      window.dispatchEvent(new Event('changehere:req'))
    })
  }

  // 请 background 截图裁剪并保存，返回绝对路径；插件不可用/超时返回 null
  function requestCapture(rect) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 2500)
      try {
        chrome.runtime.sendMessage(
          {
            type: 'changehere:capture',
            rect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
            dpr: devicePixelRatio,
          },
          (res) => {
            void chrome.runtime.lastError
            clearTimeout(timer)
            resolve(res || null)
          }
        )
      } catch {
        clearTimeout(timer)
        resolve(null)
      }
    })
  }

  function buildMarkdown(target, rect, fiber, shot) {
    const src = sourceOf(target)
    const chain = chainOf(target)
    const text = (target.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120)
    const styles = styleSnapshot(target)

    const lines = ['## 前端元素修改请求', '']
    lines.push(`**页面**: ${location.href}`)
    if (src) {
      lines.push(`**源码位置**: ${src.file}:${src.line}:${src.col}${src.comp ? `（组件 <${src.comp}>）` : ''}`)
    } else {
      const env = envOf()
      lines.push(
        env === 'vite-dev'
          ? '**源码位置**: 未知（vite dev 页面，未接入 vite-plugin-changehere）'
          : env === 'tagged'
            ? '**源码位置**: 未知（页面已接入插件，但该元素无 data-ch，可能来自第三方组件库）'
            : '**源码位置**: 未知（生产构建）'
      )
      const clues = grepClues(target)
      if (clues.length) {
        lines.push('**检索线索**（供 agent 在源码里 grep）:')
        for (const c of clues) lines.push('- ' + c)
      }
    }
    if (chain.length > 1) {
      lines.push(
        '**组件链**: ' +
          chain.map((c) => `${c.comp} (${c.file}:${c.line})`).join(' ← ')
      )
    }
    lines.push(`**元素**: \`<${target.tagName.toLowerCase()}>\` \`${cssPath(target)}\``)
    if (text) lines.push(`**文本**: ${text}`)
    lines.push(`**尺寸**: ${Math.round(rect.width)}×${Math.round(rect.height)}`)
    if (styles) lines.push(`**当前样式**: \`${styles}\``)
    if (fiber && fiber.props) {
      let json = JSON.stringify(fiber.props, null, 2)
      if (json.length > 1200) json = json.slice(0, 1200) + '\n…'
      const minified = /^[a-zA-Z$_][a-zA-Z0-9$_]{0,2}$/.test(fiber.component)
      lines.push(
        `**组件 props**（<${fiber.component}>${minified ? '，组件名已被构建压缩，以 props 为准' : ''}）:`,
        '```json', json, '```'
      )
    }
    if (shot) lines.push(`**截图**: ${shot}`)
    lines.push('', '**修改意图**: （在此填写你想怎么改）')
    return lines.join('\n')
  }

  // ---------- 反向定位 ----------

  function openLocate() {
    if (active) deactivate()
    ensureStyle()
    locateBox = el('div', 'ch-locate')
    const input = el('input')
    input.placeholder = '粘贴源码位置，如 src/App.jsx:9（可整行粘贴）'
    const hint = el('div', 'ch-row2', 'Enter 定位 · Esc 关闭')
    locateBox.append(input, hint)
    document.documentElement.append(locateBox)
    input.focus()
    input.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Escape') closeLocate()
      if (e.key === 'Enter') {
        const res = runLocate(input.value.trim())
        hint.textContent =
          res == null ? '没解析出文件路径，试试 src/xxx.jsx:12 格式'
          : res.matched.length === 0 ? '0 个匹配（确认 dev server 在跑、文件路径正确）'
          : res.fallback ? `行号未命中（可能已漂移），按文件匹配 ${res.matched.length} 个，已滚到最近的 :${res.nearest}`
          : `${res.matched.length} 个匹配 · Esc 关闭`
      }
    })
  }

  function closeLocate() {
    locateBox?.remove()
    locateBox = null
    clearHits()
  }

  function clearHits() {
    for (const h of hits) h.classList.remove('ch-hit')
    hits = []
  }

  // 匹配来自 file[:line] 的元素；行号 miss（agent 改动后常见漂移）时退化为整文件
  function matchElements(file, line) {
    const inFile = []
    for (const node of document.querySelectorAll('[data-ch]')) {
      const info = parseCh(node.getAttribute('data-ch'))
      if (!info) continue
      const fileOk =
        info.file === file || info.file.endsWith('/' + file) || file.endsWith('/' + info.file)
      if (fileOk) inFile.push({ node, line: info.line })
    }
    let matched = line == null ? inFile : inFile.filter((m) => m.line === line)
    let fallback = false
    let nearest = null
    let scroll = null
    if (line != null && !matched.length && inFile.length) {
      fallback = true
      matched = inFile
      const best = inFile.reduce((a, b) =>
        Math.abs(b.line - line) < Math.abs(a.line - line) ? b : a
      )
      scroll = best.node
      nearest = best.line
    }
    return { matched, fallback, nearest, scroll: scroll ?? matched[0]?.node ?? null }
  }

  // 从任意文本里抠出 文件路径[:行号]，容忍整行 markdown 粘贴
  function runLocate(q) {
    clearHits()
    const m = /([^\s:*`（()]+\.[jt]sx?)(?::(\d+))?/.exec(q)
    if (!m) return null
    const res = matchElements(m[1].replace(/^\.\//, ''), m[2] ? +m[2] : null)
    for (const { node } of res.matched) {
      node.classList.add('ch-hit')
      hits.push(node)
    }
    res.scroll?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    return res
  }

  // ---------- MCP bridge：agent 推送的高亮 ----------

  let lastRemoteAt = ''

  function requestPendingHighlights() {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({ type: 'changehere:highlight-pending' }, (value) => {
          const error = chrome.runtime.lastError
          if (error) reject(new Error(error.message))
          else resolve(Array.isArray(value) ? value : [])
        })
      } catch (error) {
        reject(error)
      }
    })
  }

  function applyRemoteHighlight(cmd) {
    ensureStyle()
    clearHits()
    const res = matchElements(cmd.file, cmd.line ?? null)
    for (const { node } of res.matched) {
      node.classList.add('ch-hit')
      hits.push(node)
    }
    res.scroll?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    const loc = cmd.file + (cmd.line ? ':' + cmd.line : '')
    toast(
      `agent 高亮 ${loc} → ${res.matched.length} 个匹配${res.fallback ? '（行号漂移，退化整文件）' : ''}`,
      null,
      res.matched.length ? 'ok' : 'err'
    )
    if (hits.length) setTimeout(clearHits, 8000)
  }

  // 只在本地 dev 页轮询（生产站多半没 data-ch，且要避开严格 CSP 的 connect-src）
  function startHighlightPoll() {
    let delay = 3000
    async function tick() {
      if (document.visibilityState === 'visible') {
        try {
          const cmds = await requestPendingHighlights()
          delay = 3000
          const fresh = cmds.filter((c) => c.at > lastRemoteAt)
          if (fresh.length) {
            lastRemoteAt = fresh[fresh.length - 1].at
            applyRemoteHighlight(fresh[fresh.length - 1])
          }
        } catch {
          delay = Math.min(delay * 2, 30000) // server 没起，指数退避
        }
      }
      setTimeout(tick, delay)
    }
    setTimeout(tick, 1500)
  }

  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) startHighlightPoll()

  // ---------- 通用 ----------

  function copy(text) {
    if (navigator.clipboard?.writeText) {
      return navigator.clipboard.writeText(text)
    }
    return new Promise((resolve, reject) => {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.cssText = 'position:fixed;opacity:0;'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      ok ? resolve() : reject(new Error('execCommand failed'))
    })
  }

  function toast(msg, kbdHint, icon) {
    ensureStyle()
    const t = el('div', 'ch-toast')
    if (icon === 'ok') t.append(el('span', 'ch-ok', '✓'))
    if (icon === 'err') t.append(el('span', 'ch-err', '✗'))
    t.append(msg)
    if (kbdHint) {
      t.append('　')
      t.append(el('span', 'ch-kbd', kbdHint))
    }
    document.documentElement.append(t)
    setTimeout(() => {
      t.classList.add('ch-out')
      setTimeout(() => t.remove(), 300)
    }, 2200)
  }
})()
