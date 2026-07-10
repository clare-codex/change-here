// 改这里 ChangeHere：MAIN world 脚本。
// content script 在 isolated world 里读不到 React fiber，
// 由这里代取「最近的函数/类组件 + 其 props」，通过 CustomEvent 传回。
(() => {
  if (window.__changehereMain) return
  window.__changehereMain = true

  window.addEventListener('changehere:req', () => {
    let payload = null
    try {
      const el = document.querySelector('[data-ch-picked]')
      if (el) {
        const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'))
        let fiber = key ? el[key] : null
        let fn = null
        while (fiber && !(fn = unwrapFn(fiber.type))) fiber = fiber.return
        if (fiber) {
          payload = {
            component:
              fiber.type.displayName || fn.displayName || fn.name || 'Anonymous',
            props: safeClone(fiber.memoizedProps, 3),
          }
        }
      }
    } catch {
      payload = null
    }
    window.dispatchEvent(
      new CustomEvent('changehere:res', { detail: JSON.stringify(payload) })
    )
  })

  // memo 的 type 是 {type: fn}，forwardRef 是 {render: fn}，可能嵌套；host fiber 的 type 是字符串
  function unwrapFn(t) {
    if (typeof t === 'function') return t
    if (t && typeof t === 'object') {
      if (t.render) return unwrapFn(t.render)
      if (t.type) return unwrapFn(t.type)
    }
    return null
  }

  function safeClone(val, depth) {
    if (val == null || typeof val === 'boolean' || typeof val === 'number') return val
    if (typeof val === 'string') return val.length > 200 ? val.slice(0, 200) + '…' : val
    if (typeof val === 'function') return 'ƒ ' + (val.name || '()')
    if (typeof val !== 'object') return String(val)
    if (val.$$typeof) return '<jsx/>'
    if (val instanceof Node) return '<node/>'
    if (depth <= 0) return '…'
    if (Array.isArray(val)) return val.slice(0, 10).map((v) => safeClone(v, depth - 1))
    const out = {}
    let n = 0
    for (const k of Object.keys(val)) {
      if (++n > 20) { out['…'] = '…'; break }
      out[k] = safeClone(val[k], depth - 1)
    }
    return out
  }
})()
