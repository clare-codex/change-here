// 改这里 ChangeHere：MAIN world 脚本。
// content script 在 isolated world 里读不到 React fiber，
// 由这里按请求的 kinds 代取组件 props / 事件处理器 / hooks state，通过 CustomEvent 传回。
// 跨 world 只能传原始值，请求和响应的 detail 都是 JSON 字符串。
(() => {
  if (window.__changehereMain) return
  window.__changehereMain = true

  window.addEventListener('changehere:req', (e) => {
    let payload = null
    try {
      let kinds = ['props']
      try {
        const detail = JSON.parse(e.detail || 'null')
        if (Array.isArray(detail?.kinds) && detail.kinds.length) kinds = detail.kinds
      } catch {}
      const el = document.querySelector('[data-ch-picked]')
      if (el) {
        const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'))
        const hostFiber = key ? el[key] : null
        if (hostFiber) {
          payload = {}
          if (kinds.includes('props')) Object.assign(payload, propsInfo(hostFiber))
          if (kinds.includes('handlers')) {
            const handlers = handlersInfo(hostFiber)
            if (handlers.length) payload.handlers = handlers
          }
          if (kinds.includes('state')) {
            const state = stateInfo(hostFiber)
            if (state.length) payload.state = state
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

  function propsInfo(hostFiber) {
    let fiber = hostFiber
    let fn = null
    while (fiber && !(fn = unwrapFn(fiber.type))) fiber = fiber.return
    if (!fiber) return {}
    return {
      component: fiber.type.displayName || fn.displayName || fn.name || 'Anonymous',
      props: safeClone(fiber.memoizedProps, 3),
    }
  }

  // host fiber 的 props 就是挂在 DOM 上的 React 事件；再沿 fiber 链向上收组件层的 on* 回调。
  // 同一组回调逐层透传很常见，靠签名去重。
  function handlersInfo(hostFiber) {
    const groups = []
    let fiber = hostFiber
    for (let depth = 0; fiber && depth < 8 && groups.length < 5; depth++, fiber = fiber.return) {
      const props = fiber.memoizedProps
      if (!props || typeof props !== 'object') continue
      const handlers = []
      for (const key of Object.keys(props)) {
        if (/^on[A-Z]/.test(key) && typeof props[key] === 'function') {
          handlers.push(`${key}: ƒ ${props[key].name || '(匿名)'}`)
          if (handlers.length >= 10) break
        }
      }
      if (!handlers.length) continue
      const owner = typeof fiber.type === 'string'
        ? `<${fiber.type}>`
        : componentNameOf(fiber)
      if (!owner) continue
      const signature = handlers.join()
      if (groups[groups.length - 1]?.signature === signature) continue
      groups.push({ owner, handlers, signature })
    }
    return groups.map(({ owner, handlers }) => ({ owner, handlers }))
  }

  // 由内向外收组件层的状态（最多 3 层）。
  // 函数组件走 hooks 链：只能拿到按声明顺序的现状值（拿不到变量名），
  // effect/ref 特判标注，其余原样压缩；类组件读 instance.state。
  function stateInfo(hostFiber) {
    const components = []
    let fiber = hostFiber
    for (let depth = 0; fiber && depth < 20 && components.length < 3; depth++, fiber = fiber.return) {
      const fn = unwrapFn(fiber.type)
      if (!fn) continue
      const entry = {
        component: fiber.type.displayName || fn.displayName || fn.name || 'Anonymous',
        props: safeClone(fiber.memoizedProps, 2),
      }
      const isClass = typeof fn === 'function' && fn.prototype && fn.prototype.isReactComponent
      if (isClass) {
        if (fiber.stateNode?.state) entry.state = safeClone(fiber.stateNode.state, 2)
      } else if (fiber.memoizedState && typeof fiber.memoizedState === 'object') {
        const hooks = []
        let hook = fiber.memoizedState
        for (let i = 0; hook && typeof hook === 'object' && 'memoizedState' in hook && i < 10; i++, hook = hook.next) {
          hooks.push(describeHook(hook.memoizedState))
        }
        if (hooks.length) entry.hooks = hooks
      }
      components.push(entry)
    }
    return components
  }

  function describeHook(value) {
    if (value && typeof value === 'object') {
      if (typeof value.create === 'function') return '(effect)'
      if ('current' in value && Object.keys(value).length === 1) return { ref: safeClone(value.current, 1) }
    }
    return safeClone(value, 2)
  }

  function componentNameOf(fiber) {
    const fn = unwrapFn(fiber.type)
    return fn ? (fiber.type.displayName || fn.displayName || fn.name || 'Anonymous') : null
  }

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
