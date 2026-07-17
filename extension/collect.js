// ChangeHere Context Router：按用户选定的意图采集对应的上下文包。
// isolated world；顶层不触碰 document，纯逻辑经 internals 暴露给 node --test。
(() => {
  if (window.__changehereCollect) return

  // ---------- 通用工具 ----------

  function short(value, limit = 160) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim()
    return text.length > limit ? text.slice(0, limit) + '…' : text
  }

  function parseCh(value) {
    const m = /^(.*?)@(.*):(\d+):(\d+)$/.exec(value || '')
    return m ? { comp: m[1], file: m[2], line: +m[3], col: +m[4] } : null
  }

  function sourceLoc(el) {
    const host = el?.closest?.('[data-ch]')
    const info = host ? parseCh(host.getAttribute('data-ch')) : null
    return info ? `${info.file}:${info.line}` : null
  }

  function summary(el) {
    if (!(el instanceof Element)) return null
    const out = { tag: el.tagName.toLowerCase() }
    if (el.id) out.id = short(el.id, 80)
    const classes = [...el.classList].slice(0, 4)
    if (classes.length) out.classes = classes
    const text = short(el.textContent, 60)
    if (text) out.text = text
    const source = sourceLoc(el)
    if (source) out.source = source
    return out
  }

  function roundRect(rect) {
    return { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) }
  }

  // skip[k] 是默认值（字符串或数组）：等于默认值的省略，压缩输出
  function pickStyles(cs, keys, skip = {}) {
    const out = {}
    for (const key of keys) {
      const value = cs.getPropertyValue(key)
      if (!value) continue
      const def = skip[key]
      if (def != null && (Array.isArray(def) ? def.includes(value) : def === value)) continue
      out[key] = short(value, 120)
    }
    return out
  }

  // ---------- 样式包 ----------

  const LAYOUT_KEYS = [
    'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index', 'float', 'flex',
    'flex-direction', 'justify-content', 'align-items', 'align-self', 'order', 'gap',
    'grid-template-columns', 'grid-column', 'grid-row', 'transform', 'overflow',
    'min-width', 'max-width', 'min-height', 'max-height', 'vertical-align',
  ]
  const LAYOUT_SKIP = {
    position: 'static', top: 'auto', right: 'auto', bottom: 'auto', left: 'auto',
    'z-index': 'auto', float: 'none', flex: '0 1 auto', 'flex-direction': 'row',
    'justify-content': 'normal', 'align-items': 'normal', 'align-self': 'auto', order: '0',
    gap: 'normal', 'grid-template-columns': 'none', 'grid-column': ['auto', 'auto / auto'],
    'grid-row': ['auto', 'auto / auto'], transform: 'none', overflow: 'visible',
    'min-width': ['auto', '0px'], 'max-width': 'none',
    'min-height': ['auto', '0px'], 'max-height': 'none', 'vertical-align': 'baseline',
  }
  const TEXT_KEYS = ['color', 'font-size', 'font-weight', 'line-height', 'font-family', 'text-align', 'white-space', 'text-overflow']
  const TEXT_SKIP = { 'font-weight': '400', 'line-height': 'normal', 'text-align': 'start', 'white-space': 'normal', 'text-overflow': 'clip' }

  function matchedCssRules(target) {
    const out = { rules: [], truncated: 0, opaqueSheets: 0 }
    const visit = (ruleList, from, condition) => {
      for (const rule of ruleList) {
        if (rule.selectorText && rule.style) {
          let hit = false
          try { hit = target.matches(rule.selectorText) } catch {}
          if (!hit) continue
          if (out.rules.length >= 12) { out.truncated++; continue }
          const entry = { selector: short(rule.selectorText, 120), css: short(rule.style.cssText, 400), from }
          if (condition) entry.condition = condition
          out.rules.push(entry)
        } else if (rule.cssRules) {
          visit(rule.cssRules, from, short(rule.conditionText || condition || '', 80) || undefined)
        }
      }
    }
    for (const sheet of document.styleSheets) {
      let list
      try { list = sheet.cssRules } catch { out.opaqueSheets++; continue } // 跨域样式表不可读
      if (!list) continue
      const from = sheet.href
        ? short(sheet.href.split('/').pop().split('?')[0], 60)
        : short(sheet.ownerNode?.getAttribute?.('data-vite-dev-id')?.split('/').slice(-2).join('/') || '<style>', 60)
      visit(list, from, undefined)
    }
    return out
  }

  function cssVariablesUsed(target, ruleEntries) {
    const cs = getComputedStyle(target)
    const names = new Set()
    for (const text of [target.getAttribute('style') || '', ...ruleEntries.map((r) => r.css)]) {
      for (const m of text.matchAll(/var\(\s*(--[\w-]+)/g)) names.add(m[1])
    }
    const out = {}
    for (const name of [...names].slice(0, 12)) {
      out[name] = short(cs.getPropertyValue(name).trim(), 80) || '(未定义)'
    }
    return out
  }

  function parentContext(target) {
    const parent = target.parentElement
    if (!parent || parent === document.documentElement) return null
    const cs = getComputedStyle(parent)
    const layout = { display: cs.display }
    if (cs.display.includes('flex')) {
      Object.assign(layout, { 'flex-direction': cs.flexDirection, 'justify-content': cs.justifyContent, 'align-items': cs.alignItems, gap: cs.gap })
    }
    if (cs.display.includes('grid')) {
      Object.assign(layout, { 'grid-template-columns': short(cs.gridTemplateColumns, 80), gap: cs.gap })
    }
    if (cs.padding !== '0px') layout.padding = cs.padding
    return {
      ...summary(parent),
      rect: roundRect(parent.getBoundingClientRect()),
      layout,
      childCount: parent.children.length,
      targetIndex: [...parent.children].indexOf(target),
    }
  }

  function siblingContext(target) {
    const out = {}
    if (target.previousElementSibling) {
      out.prev = { ...summary(target.previousElementSibling), rect: roundRect(target.previousElementSibling.getBoundingClientRect()) }
    }
    if (target.nextElementSibling) {
      out.next = { ...summary(target.nextElementSibling), rect: roundRect(target.nextElementSibling.getBoundingClientRect()) }
    }
    return out
  }

  function nearestAncestor(target, predicate) {
    for (let node = target.parentElement; node && node !== document.documentElement; node = node.parentElement) {
      const found = predicate(getComputedStyle(node))
      if (found) return { ...summary(node), ...found }
    }
    return null
  }

  function collectStyle(target) {
    const cs = getComputedStyle(target)
    const box = { 'box-sizing': cs.boxSizing, margin: cs.margin, padding: cs.padding }
    if (cs.borderWidth !== '0px') box.border = cs.border
    if (cs.borderRadius !== '0px') box['border-radius'] = cs.borderRadius
    const matched = matchedCssRules(target)
    const out = {
      box,
      layout: pickStyles(cs, LAYOUT_KEYS, LAYOUT_SKIP),
      typography: pickStyles(cs, TEXT_KEYS, TEXT_SKIP),
      background: pickStyles(cs, ['background-color', 'background-image', 'opacity', 'box-shadow'], {
        'background-color': 'rgba(0, 0, 0, 0)', 'background-image': 'none', opacity: '1', 'box-shadow': 'none',
      }),
      matchedRules: matched.rules,
      parent: parentContext(target),
      siblings: siblingContext(target),
    }
    if (matched.truncated) out.rulesTruncated = matched.truncated
    if (matched.opaqueSheets) out.opaqueSheets = matched.opaqueSheets
    const inline = target.getAttribute('style')
    if (inline) out.inlineStyle = short(inline, 200)
    const variables = cssVariablesUsed(target, matched.rules)
    if (Object.keys(variables).length) out.cssVariables = variables
    const positioned = nearestAncestor(target, (acs) =>
      acs.position !== 'static' ? { position: acs.position, 'z-index': acs.zIndex } : null)
    if (positioned) out.positionedAncestor = positioned
    const clipping = nearestAncestor(target, (acs) =>
      acs.overflow !== 'visible' || acs.overflowX !== 'visible' || acs.overflowY !== 'visible'
        ? { overflow: `${acs.overflowX} ${acs.overflowY}` } : null)
    if (clipping) out.clippingAncestor = clipping
    return out
  }

  // ---------- 交互包 ----------

  function collectInteraction(target) {
    const cs = getComputedStyle(target)
    const out = { cursor: cs.cursor }
    const blockers = []
    if (target.disabled === true || target.getAttribute('aria-disabled') === 'true') blockers.push('disabled')
    if (cs.pointerEvents === 'none') blockers.push('pointer-events: none')
    // 遮挡检测：元素中心命中的最上层元素既非自己也非父子 → 被盖住，「点不动」的头号嫌疑
    const rect = target.getBoundingClientRect()
    const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    if (top && top !== target && !target.contains(top) && !top.contains(target) &&
        !top.closest('.ch-overlay,.ch-card,.ch-toast,.ch-locate,.ch-intent')) {
      const tcs = getComputedStyle(top)
      out.coveredBy = { ...summary(top), position: tcs.position, 'z-index': tcs.zIndex }
      blockers.push('被其他元素遮挡')
    }
    if (blockers.length) out.blockers = blockers
    const tabindex = target.getAttribute('tabindex')
    if (tabindex != null) out.tabindex = tabindex
    const inlineAttrs = [...target.attributes].filter((a) => /^on/i.test(a.name)).map((a) => a.name)
    if (inlineAttrs.length) out.inlineHandlerAttrs = inlineAttrs.slice(0, 8)
    const link = target.closest('a[href]')
    if (link) out.link = short(link.getAttribute('href'), 120)
    const form = target.closest('form')
    if (form) {
      out.form = summary(form)
      // button 默认 type=submit 会触发表单提交刷新，是「点了行为不对」的经典坑
      if (target instanceof HTMLButtonElement ||
          (target instanceof HTMLInputElement && ['submit', 'button', 'reset'].includes(target.type))) {
        out.form.buttonType = target.type
      }
    }
    const lastTrace = window.__changehereTrace?.getLast?.()
    if (lastTrace && lastTrace.stopReason !== 'cancelled') {
      out.lastTrace = {
        id: lastTrace.id,
        ageSeconds: Math.max(0, Math.round((Date.now() - Date.parse(lastTrace.startedAt)) / 1000)),
        events: lastTrace.records.filter((r) => r.kind === 'event').length,
        mutations: lastTrace.records.filter((r) => r.kind === 'mutation').length,
        errors: lastTrace.records.filter((r) => r.kind === 'error').length,
        elementDiffFields: (lastTrace.elementDiff || []).map((d) => d.field).slice(0, 10),
      }
    }
    return out
  }

  // ---------- 数据包 ----------

  const NETWORK_SKIP = /\/@vite|\/@react-refresh|\/node_modules\/|__vite|\.hot-update\./

  function recentNetwork(limit = 15) {
    let entries = []
    try { entries = performance.getEntriesByType('resource') } catch {}
    const api = entries.filter((e) =>
      (e.initiatorType === 'fetch' || e.initiatorType === 'xmlhttprequest') && !NETWORK_SKIP.test(e.name))
    const now = performance.now()
    return {
      totalOnPage: api.length,
      requests: api.slice(-limit).map((e) => {
        const item = {
          url: short(e.name, 140),
          type: e.initiatorType === 'fetch' ? 'fetch' : 'xhr',
          durationMs: Math.round(e.duration),
          agoSeconds: Math.max(0, Math.round((now - e.responseEnd) / 1000)),
        }
        // responseStatus 需要 Chrome 109+；跨域无 Timing-Allow-Origin 时为 0
        if (typeof e.responseStatus === 'number' && e.responseStatus !== 0) item.status = e.responseStatus
        if (e.transferSize) item.bytes = e.transferSize
        return item
      }),
    }
  }

  // 找到「重复同类子元素」的列表容器，对照“少了/多了/重复”类问题
  function listLike(target) {
    let node = target
    for (let i = 0; node && node !== document.body && i < 5; i++, node = node.parentElement) {
      const kids = node.children
      if (kids.length >= 3) {
        const tag = kids[0].tagName
        let same = 0
        for (const kid of kids) if (kid.tagName === tag) same++
        if (same / kids.length >= 0.8) return node
      }
    }
    return null
  }

  function collectData(target) {
    const out = { network: recentNetwork() }
    const list = listLike(target)
    if (list) {
      out.renderedList = {
        container: summary(list),
        itemCount: list.children.length,
        firstItem: short(list.children[0]?.textContent, 60),
        lastItem: short(list.children[list.children.length - 1]?.textContent, 60),
      }
    }
    if ((target instanceof HTMLInputElement && target.type !== 'password') ||
        target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
      out.currentValue = short(target.value, 120)
    }
    return out
  }

  // ---------- 性能包 ----------

  function observeBuffered(type, extra = {}, timeoutMs = 150) {
    return new Promise((resolve) => {
      const entries = []
      let po
      try {
        po = new PerformanceObserver((entryList) => entries.push(...entryList.getEntries()))
        po.observe({ type, buffered: true, ...extra })
      } catch { return resolve([]) }
      setTimeout(() => {
        try { po.disconnect() } catch {}
        resolve(entries)
      }, timeoutMs)
    })
  }

  async function collectPerformance() {
    const [longtasks, shifts, lcps, paints, slowEvents] = await Promise.all([
      observeBuffered('longtask'),
      observeBuffered('layout-shift'),
      observeBuffered('largest-contentful-paint'),
      observeBuffered('paint'),
      observeBuffered('event', { durationThreshold: 100 }),
    ])
    const out = {}
    if (longtasks.length) {
      out.longTasks = {
        count: longtasks.length,
        totalMs: Math.round(longtasks.reduce((n, e) => n + e.duration, 0)),
        worst: [...longtasks].sort((a, b) => b.duration - a.duration).slice(0, 5)
          .map((e) => ({ atMs: Math.round(e.startTime), durationMs: Math.round(e.duration) })),
      }
    }
    const realShifts = shifts.filter((e) => !e.hadRecentInput)
    if (realShifts.length) {
      out.layoutShift = {
        cls: +realShifts.reduce((n, e) => n + e.value, 0).toFixed(4),
        count: realShifts.length,
        worst: [...realShifts].sort((a, b) => b.value - a.value).slice(0, 3).map((e) => ({
          value: +e.value.toFixed(4),
          atMs: Math.round(e.startTime),
          sources: (e.sources || []).map((s) => summary(s.node)).filter(Boolean).slice(0, 3),
        })),
      }
    }
    const lcp = lcps[lcps.length - 1]
    if (lcp) out.lcp = { atMs: Math.round(lcp.startTime), element: summary(lcp.element) }
    const fcp = paints.find((e) => e.name === 'first-contentful-paint')
    if (fcp) out.fcpMs = Math.round(fcp.startTime)
    if (slowEvents.length) {
      out.slowInteractions = [...slowEvents].sort((a, b) => b.duration - a.duration).slice(0, 5)
        .map((e) => ({ type: e.name, durationMs: Math.round(e.duration), target: summary(e.target) }))
    }
    const nav = performance.getEntriesByType('navigation')[0]
    if (nav) {
      out.navigation = {
        ttfbMs: Math.round(nav.responseStart),
        domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd),
        loadMs: Math.round(nav.loadEventEnd),
      }
    }
    if (performance.memory) out.memory = { usedJsHeapMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) }
    let resources = []
    try { resources = performance.getEntriesByType('resource').filter((e) => !NETWORK_SKIP.test(e.name)) } catch {}
    if (resources.length) {
      out.resourceWaterfall = {
        total: resources.length,
        totalBytes: resources.reduce((n, e) => n + (e.transferSize || 0), 0),
        slowest: [...resources].sort((a, b) => b.duration - a.duration).slice(0, 8)
          .map((e) => ({ url: short(e.name, 120), type: e.initiatorType, startMs: Math.round(e.startTime), durationMs: Math.round(e.duration) })),
      }
    }
    out.notCollected = ['React 组件渲染次数（需页面加载时注入 profiler，后续版本）']
    return out
  }

  // ---------- 无障碍包 ----------

  // 常见标签的隐式 ARIA role（子集，覆盖日常排查够用）
  function implicitRole(tag, attr) {
    switch (tag) {
      case 'a': case 'area': return attr('href') != null ? 'link' : null
      case 'button': return 'button'
      case 'select': return attr('multiple') != null || Number(attr('size')) > 1 ? 'listbox' : 'combobox'
      case 'textarea': return 'textbox'
      case 'img': return attr('alt') === '' ? 'presentation' : 'img'
      case 'nav': return 'navigation'
      case 'main': return 'main'
      case 'header': return 'banner'
      case 'footer': return 'contentinfo'
      case 'aside': return 'complementary'
      case 'form': return 'form'
      case 'ul': case 'ol': return 'list'
      case 'li': return 'listitem'
      case 'table': return 'table'
      case 'tr': return 'row'
      case 'th': return attr('scope') === 'row' ? 'rowheader' : 'columnheader'
      case 'td': return 'cell'
      case 'dialog': return 'dialog'
      case 'hr': return 'separator'
      case 'progress': return 'progressbar'
      case 'summary': return 'button'
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': return 'heading'
      case 'input': {
        const type = attr('type') || 'text'
        if (type === 'checkbox') return 'checkbox'
        if (type === 'radio') return 'radio'
        if (type === 'range') return 'slider'
        if (type === 'number') return 'spinbutton'
        if (type === 'search') return 'searchbox'
        if (['submit', 'button', 'reset', 'image'].includes(type)) return 'button'
        if (type === 'hidden') return null
        return 'textbox'
      }
      default: return null
    }
  }

  // 简化版 accessible name 计算（AccName 规范的常用子集）
  function accessibleName(target) {
    const labelledby = target.getAttribute('aria-labelledby')
    if (labelledby) {
      const text = labelledby.split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || '').join(' ').trim()
      if (text) return { name: short(text, 120), from: 'aria-labelledby' }
    }
    const ariaLabel = target.getAttribute('aria-label')
    if (ariaLabel) return { name: short(ariaLabel, 120), from: 'aria-label' }
    if (target.labels?.length) {
      const text = [...target.labels].map((l) => l.textContent).join(' ').trim()
      if (text) return { name: short(text, 120), from: '<label>' }
    }
    const alt = target.getAttribute('alt')
    if (alt) return { name: short(alt, 120), from: 'alt' }
    const text = short(target.textContent, 120)
    if (text) return { name: text, from: '文本内容' }
    const title = target.getAttribute('title')
    if (title) return { name: short(title, 120), from: 'title' }
    const placeholder = target.getAttribute('placeholder')
    if (placeholder) return { name: short(placeholder, 120), from: 'placeholder（不能作为正式名称）' }
    return { name: '', from: null }
  }

  // WCAG 对比度纯计算
  function parseColor(value) {
    const m = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+%?))?\s*\)/.exec(value || '')
    if (!m) return null
    let a = m[4] == null ? 1 : parseFloat(m[4])
    if (m[4] != null && m[4].includes('%')) a /= 100
    return [+m[1], +m[2], +m[3], a]
  }

  function compositeOver(fg, bg) {
    const a = fg[3]
    return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1]
  }

  function luminance(color) {
    const [r, g, b] = color.map((v) => {
      const c = v / 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }

  function contrastRatio(c1, c2) {
    const [hi, lo] = [luminance(c1), luminance(c2)].sort((a, b) => b - a)
    return (hi + 0.05) / (lo + 0.05)
  }

  function requiredContrast(fontSizePx, fontWeight) {
    const large = fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700)
    return large ? 3 : 4.5
  }

  // 沿祖先合成实际背景色（半透明层叠加，兜底白底）
  function effectiveBackground(target) {
    const layers = []
    for (let node = target; node instanceof Element; node = node.parentElement) {
      const bg = parseColor(getComputedStyle(node).backgroundColor)
      if (bg && bg[3] > 0) {
        layers.push(bg)
        if (bg[3] === 1) break
      }
    }
    let color = [255, 255, 255, 1]
    for (const layer of layers.reverse()) color = compositeOver(layer, color)
    return color
  }

  function contrastInfo(target) {
    const cs = getComputedStyle(target)
    const fg = parseColor(cs.color)
    if (!fg) return null
    const bg = effectiveBackground(target)
    const fgFlat = fg[3] < 1 ? compositeOver(fg, bg) : fg
    const ratio = contrastRatio(fgFlat, bg)
    const required = requiredContrast(parseFloat(cs.fontSize) || 16, Number(cs.fontWeight) || 400)
    return {
      color: cs.color,
      background: `rgb(${bg.slice(0, 3).map(Math.round).join(', ')})`,
      ratio: +ratio.toFixed(2),
      required,
      pass: ratio >= required,
    }
  }

  const FOCUSABLE_SELECTOR = 'a[href],button,input,select,textarea,summary,audio[controls],video[controls],[tabindex],[contenteditable="true"]'

  function isFocusable(el) {
    if (el.disabled) return false
    if ((el.getAttribute('tabindex') || '') === '-1') return false
    const rect = el.getBoundingClientRect()
    return rect.width > 0 || rect.height > 0
  }

  function focusContext(target) {
    const all = [...document.querySelectorAll(FOCUSABLE_SELECTOR)]
      .filter(isFocusable)
      .filter((el) => !el.closest('.ch-overlay,.ch-card,.ch-toast,.ch-locate,.ch-intent'))
    const index = all.indexOf(target)
    const neighbor = (el) => el && {
      tag: el.tagName.toLowerCase(),
      name: short(accessibleName(el).name, 40) || '(无名称)',
      source: sourceLoc(el) || undefined,
    }
    const out = { inTabOrder: index !== -1 }
    const tabindex = target.getAttribute('tabindex')
    if (tabindex != null) out.tabindex = tabindex
    if (index !== -1) {
      out.position = `${index + 1}/${all.length}`
      const prev = [all[index - 2], all[index - 1]].filter(Boolean).map(neighbor)
      const next = [all[index + 1], all[index + 2]].filter(Boolean).map(neighbor)
      if (prev.length) out.prev = prev
      if (next.length) out.next = next
    }
    return out
  }

  const INTERACTIVE_ROLES = ['button', 'link', 'checkbox', 'radio', 'textbox', 'combobox', 'listbox', 'slider', 'spinbutton', 'searchbox', 'switch', 'menuitem', 'tab']
  const A11Y_STATE_ATTRS = ['aria-expanded', 'aria-checked', 'aria-pressed', 'aria-selected', 'aria-hidden', 'aria-disabled', 'aria-haspopup', 'aria-current', 'aria-invalid', 'aria-live']

  function collectA11y(target) {
    const tag = target.tagName.toLowerCase()
    const explicit = target.getAttribute('role')
    const implicit = implicitRole(tag, (name) => target.getAttribute(name))
    const role = explicit || implicit
    const name = accessibleName(target)
    const states = {}
    for (const attr of A11Y_STATE_ATTRS) {
      const value = target.getAttribute(attr)
      if (value != null) states[attr] = short(value, 60)
    }
    for (const prop of ['disabled', 'required', 'readOnly', 'checked']) {
      if (target[prop] === true) states[prop.toLowerCase()] = true
    }
    const warnings = []
    if (target.closest('[aria-hidden="true"]')) warnings.push('处于 aria-hidden="true" 祖先内，读屏完全不可见')
    if (role && INTERACTIVE_ROLES.includes(role) && !name.name) warnings.push('交互元素缺少 accessible name')
    if (!role && getComputedStyle(target).cursor === 'pointer' && !target.closest('a[href],button')) {
      warnings.push('看起来可点击（cursor:pointer）但无语义 role，读屏和键盘用户不可用')
    }
    if (Number(target.getAttribute('tabindex')) > 0) warnings.push('tabindex > 0 会打乱自然焦点顺序')
    const hasText = short(target.textContent, 10) !== ''
    const contrast = hasText ? contrastInfo(target) : null
    if (contrast && !contrast.pass) {
      warnings.push(`文本对比度 ${contrast.ratio}:1 低于 WCAG AA 要求的 ${contrast.required}:1`)
    }
    const out = {
      role: explicit ? `${explicit}（显式）` : implicit ? `${implicit}（隐式）` : '(无)',
      name: name.name || '(无)',
    }
    if (name.from) out.nameFrom = name.from
    if (/^h[1-6]$/.test(tag)) out.headingLevel = +tag[1]
    if (Object.keys(states).length) out.states = states
    out.focus = focusContext(target)
    if (contrast) out.contrast = contrast
    const landmark = target.closest('nav,main,header,footer,aside,[role="navigation"],[role="main"],[role="banner"],[role="contentinfo"],[role="complementary"],[role="dialog"]')
    if (landmark && landmark !== target) out.landmark = summary(landmark)
    if (warnings.length) out.warnings = warnings
    return out
  }

  // ---------- 验收规则 ----------

  function verificationFor(intent, loc) {
    const highlight = loc
      ? `\`changehere highlight ${loc}\` 反向高亮改动元素，确认改对了位置`
      : '用反向定位（Alt+Shift+L 粘贴 file:line）确认改动位置'
    const rules = {
      style: [
        '改完让用户重选该元素，对比 rect / 关键样式与本包基线是否达到预期',
        '检查父容器与相邻兄弟的 rect，确认没有连带挤压 / 溢出',
        highlight,
      ],
      interaction: [
        '让用户按 R 重录同样操作，`changehere trace last` 检查 elementDiff 是否出现预期状态变化',
        '新轨迹 records 中不应出现新的 error 记录',
        highlight,
      ],
      data: [
        '复现后核对 network 中对应请求的 status / 时长，与本包基线对比',
        '让用户重选该元素，确认渲染文本 / props / hooks 值为预期数据',
        highlight,
      ],
      performance: [
        '优化后让用户以性能意图重选该元素，对比 longTasks / CLS / 慢交互与本包基线数值',
        '确认 resourceWaterfall 中目标请求的时序变化',
      ],
      a11y: [
        '重选该元素核对 role / accessible name / 对比度 / 焦点顺序是否达标',
        '本包 warnings 列出的问题应全部消除',
      ],
      general: [highlight],
    }
    return rules[intent] || rules.general
  }

  window.__changehereCollect = {
    collectStyle,
    collectInteraction,
    collectData,
    collectPerformance,
    collectA11y,
    verificationFor,
    internals: {
      parseColor,
      compositeOver,
      luminance,
      contrastRatio,
      requiredContrast,
      implicitRole,
      verificationFor,
    },
  }
})()
