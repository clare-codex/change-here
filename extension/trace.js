// ChangeHere source-anchored microtrace recorder.
// Runs in the extension isolated world and records a bounded event/mutation summary.
(() => {
  if (window.__changehereTrace) return

  const MAX_DURATION_MS = 10_000
  const MAX_RECORDS = 100
  const MUTATION_WINDOW_MS = 100
  const SAFE_ATTRIBUTE = /^(?:class|style|hidden|disabled|open|checked|selected|aria-[\w-]+|data-state)$/
  let session = null

  function parseSource(value) {
    const match = /^(.*?)@(.*):(\d+):(\d+)$/.exec(value || '')
    return match
      ? { component: match[1], file: match[2], line: Number(match[3]), column: Number(match[4]) }
      : null
  }

  function elementOf(node) {
    if (node instanceof Element) return node
    return node?.parentElement ?? null
  }

  function sourceOf(node) {
    const element = elementOf(node)
    const host = element?.closest?.('[data-ch]')
    return host ? parseSource(host.getAttribute('data-ch')) : null
  }

  function short(value, limit = 160) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim()
    return text.length > limit ? text.slice(0, limit) + '…' : text
  }

  function elementSummary(node) {
    const element = elementOf(node)
    if (!element) return null
    const summary = { tag: element.tagName.toLowerCase() }
    if (element.id) summary.id = short(element.id, 80)
    const classes = [...element.classList].slice(0, 4)
    if (classes.length) summary.classes = classes
    const text = short(element.textContent, 80)
    if (text) summary.text = text
    const source = sourceOf(element)
    if (source) summary.source = source
    return summary
  }

  function eventDetail(event) {
    const target = event.target
    const detail = {}
    if (event.type === 'keydown') {
      detail.key = event.key.length === 1 ? '[character]' : event.key
      detail.modifiers = [
        event.altKey && 'Alt',
        event.ctrlKey && 'Control',
        event.metaKey && 'Meta',
        event.shiftKey && 'Shift',
      ].filter(Boolean)
    }
    if (event.type === 'input' || event.type === 'change') {
      if (target instanceof HTMLInputElement) {
        if (target.type === 'checkbox' || target.type === 'radio') detail.checked = target.checked
        else detail.valueLength = target.value.length
      } else if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
        detail.valueLength = target.value.length
      }
    }
    if (event.type === 'scroll') {
      const scroller = target === document ? document.scrollingElement : target
      if (scroller && 'scrollTop' in scroller) {
        detail.scrollTop = Math.round(scroller.scrollTop)
        detail.scrollLeft = Math.round(scroller.scrollLeft)
      }
    }
    return detail
  }

  function push(record) {
    if (!session || session.records.length >= MAX_RECORDS) return
    session.records.push({ atMs: Math.round(performance.now() - session.startedAtPerf), ...record })
  }

  function onEvent(event) {
    const element = elementOf(event.target)
    if (isOwnUi(element)) return
    push({ kind: 'event', type: event.type, target: elementSummary(event.target), detail: eventDetail(event) })
  }

  function isOwnUi(node) {
    const element = elementOf(node)
    return Boolean(element?.closest?.('.ch-overlay,.ch-card,.ch-toast,.ch-locate'))
  }

  function isOwnUiMutation(mutation) {
    if (isOwnUi(mutation.target)) return true
    if (mutation.type !== 'childList') return false
    const changed = [...mutation.addedNodes, ...mutation.removedNodes]
    return changed.length > 0 && changed.every((node) => isOwnUi(node))
  }

  function mutationKey(mutation) {
    const source = sourceOf(mutation.target)
    const sourceKey = source ? `${source.file}:${source.line}:${source.column}` : 'unanchored'
    return `${sourceKey}|${mutation.type}|${mutation.attributeName || ''}`
  }

  function mutationSummary(mutation) {
    const target = elementSummary(mutation.target)
    if (mutation.type === 'attributes') {
      const name = mutation.attributeName
      const safe = SAFE_ATTRIBUTE.test(name)
      const value = safe ? short(elementOf(mutation.target)?.getAttribute(name), 160) : '[redacted]'
      return { kind: 'mutation', type: 'attribute', target, attribute: name, before: safe ? short(mutation.oldValue, 160) : '[redacted]', after: value }
    }
    if (mutation.type === 'characterData') {
      return { kind: 'mutation', type: 'text', target, before: short(mutation.oldValue, 120), after: short(mutation.target.textContent, 120) }
    }
    return {
      kind: 'mutation',
      type: 'children',
      target,
      added: [...mutation.addedNodes].map((node) => elementSummary(node)?.tag || node.nodeName).slice(0, 8),
      removed: [...mutation.removedNodes].map((node) => elementSummary(node)?.tag || node.nodeName).slice(0, 8),
    }
  }

  function flushMutations() {
    if (!session || !session.pendingMutations.size) return
    for (const entry of session.pendingMutations.values()) {
      push({ ...entry.record, occurrences: entry.occurrences })
    }
    session.pendingMutations.clear()
    clearTimeout(session.mutationTimer)
    session.mutationTimer = null
  }

  function onMutations(mutations) {
    if (!session) return
    for (const mutation of mutations) {
      if (isOwnUiMutation(mutation)) continue
      const key = mutationKey(mutation)
      const existing = session.pendingMutations.get(key)
      if (existing) {
        existing.record = mutationSummary(mutation)
        existing.occurrences += 1
      } else {
        session.pendingMutations.set(key, { record: mutationSummary(mutation), occurrences: 1 })
      }
    }
    if (!session.mutationTimer) session.mutationTimer = setTimeout(flushMutations, MUTATION_WINDOW_MS)
  }

  function onError(event) {
    push({
      kind: 'error',
      type: 'error',
      message: short(event.message, 300),
      source: event.filename ? { file: event.filename, line: event.lineno || null, column: event.colno || null } : null,
    })
  }

  function onUnhandledRejection(event) {
    push({ kind: 'error', type: 'unhandledrejection', message: short(event.reason?.message || event.reason, 300) })
  }

  const EVENT_TYPES = ['click', 'input', 'change', 'keydown', 'focusin', 'focusout', 'scroll']

  function attach() {
    for (const type of EVENT_TYPES) document.addEventListener(type, onEvent, true)
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onUnhandledRejection)
    session.observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeOldValue: true,
      characterData: true,
      characterDataOldValue: true,
    })
  }

  function detach(activeSession) {
    for (const type of EVENT_TYPES) document.removeEventListener(type, onEvent, true)
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onUnhandledRejection)
    activeSession.observer.disconnect()
    clearTimeout(activeSession.timeout)
    clearTimeout(activeSession.mutationTimer)
  }

  function start({ target, onStop } = {}) {
    if (session) return null
    const startedAtPerf = performance.now()
    session = {
      id: `trace-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      startedAt: new Date().toISOString(),
      startedAtPerf,
      url: location.href,
      target: elementSummary(target),
      records: [],
      pendingMutations: new Map(),
      mutationTimer: null,
      observer: new MutationObserver(onMutations),
      timeout: null,
      onStop,
    }
    attach()
    session.timeout = setTimeout(() => stop('time-limit'), MAX_DURATION_MS)
    return session.id
  }

  function stop(reason = 'manual') {
    if (!session) return null
    flushMutations()
    const activeSession = session
    session = null
    detach(activeSession)
    const trace = {
      version: 1,
      id: activeSession.id,
      url: activeSession.url,
      startedAt: activeSession.startedAt,
      durationMs: Math.min(MAX_DURATION_MS, Math.round(performance.now() - activeSession.startedAtPerf)),
      stopReason: reason,
      target: activeSession.target,
      records: activeSession.records,
    }
    activeSession.onStop?.(trace)
    return trace
  }

  window.__changehereTrace = {
    start,
    stop,
    isRecording: () => Boolean(session),
    limits: { maxDurationMs: MAX_DURATION_MS, maxRecords: MAX_RECORDS },
  }
})()
