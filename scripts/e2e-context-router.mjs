#!/usr/bin/env node
// Context Router E2E：起 example dev server + headless Chrome，经 CDP 注入扩展脚本
// （stub chrome.runtime / clipboard），驱动「点选 → 选意图 → Enter」全流程，
// 断言五类上下文包的 markdown 与结构化 pack。用法：node scripts/e2e-context-router.mjs
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PORT = 5199
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const INTENT_LABELS = { general: '通用', style: '样式', interaction: '交互', data: '数据', performance: '性能', a11y: '无障碍' }

const failures = []
let vite = null
let chrome = null
let ws = null
let userDataDir = null
let msgId = 0
const pending = new Map()

function check(name, cond, detail = '') {
  console.log(cond ? `  ✓ ${name}` : `  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failures.push(name)
}

async function waitFor(fn, what, timeoutMs = 15000, interval = 200) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    let value = null
    try { value = await fn() } catch {}
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, interval))
  }
  throw new Error(`timeout waiting for ${what}`)
}

function send(method, params = {}) {
  const id = ++msgId
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function evalJs(expression, awaitPromise = false) {
  const res = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true })
  if (res.exceptionDetails) {
    throw new Error('page eval failed: ' + (res.exceptionDetails.exception?.description || res.exceptionDetails.text))
  }
  return res.result?.value
}

// 走完整 UI 流程：开选取模式 → 悬停 → 点击 → 意图面板选类型/填句子 → Enter
async function pickAndSubmit(selector, intent, sentence) {
  await evalJs(`(() => {
    window.__copied = null
    window.__listeners.forEach((fn) => fn({ type: 'changehere:toggle' }))
    const el = document.querySelector(${JSON.stringify(selector)})
    el.scrollIntoView({ block: 'center' })
    el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })()`)
  await waitFor(() => evalJs(`Boolean(document.querySelector('.ch-intent input'))`), 'intent panel', 3000)
  await evalJs(`(() => {
    const input = document.querySelector('.ch-intent input')
    input.value = ${JSON.stringify(sentence)}
    const chip = [...document.querySelectorAll('.ch-chip')].find((c) => c.textContent === ${JSON.stringify(INTENT_LABELS[intent])})
    chip.click()
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })()`)
  await waitFor(() => evalJs(`Boolean(window.__copied)`), 'copied markdown', 5000)
  const result = await evalJs(`({
    md: window.__copied,
    pack: window.__chMessages.filter((m) => m.type === 'changehere:selection').pop()?.payload?.pack ?? null,
  })`)
  // CH_E2E_DUMP=1 时打印每份 markdown，供人工核对输出质量
  if (process.env.CH_E2E_DUMP) console.log('\n────── markdown ──────\n' + result.md + '\n──────────────────────')
  return result
}

async function main() {
  console.log('▶ 启动 example dev server (:%d)', PORT)
  vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: path.join(ROOT, 'example'),
    stdio: 'ignore',
  })
  await waitFor(async () => (await fetch(`http://localhost:${PORT}/`)).ok, 'vite dev server')

  console.log('▶ 启动 headless Chrome')
  userDataDir = await mkdtemp(path.join(tmpdir(), 'ch-e2e-'))
  chrome = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${userDataDir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', 'about:blank',
  ], { stdio: 'ignore' })
  const devtoolsPort = await waitFor(async () => {
    const text = await readFile(path.join(userDataDir, 'DevToolsActivePort'), 'utf8')
    return Number(text.split('\n')[0]) || null
  }, 'devtools port')
  const target = await waitFor(async () => {
    const list = await (await fetch(`http://127.0.0.1:${devtoolsPort}/json/list`)).json()
    return list.find((t) => t.type === 'page') || null
  }, 'page target')
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws failed')) })
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result)
  }

  await send('Page.navigate', { url: `http://localhost:${PORT}/?trace-lab` })
  await waitFor(() => evalJs(`document.querySelectorAll('[data-ch]').length > 0`), 'react rendered with data-ch')

  console.log('▶ 注入扩展脚本（stub chrome.runtime / clipboard）')
  await evalJs(`(() => {
    window.__chMessages = []
    window.__listeners = []
    window.chrome = {
      runtime: {
        onMessage: { addListener: (fn) => window.__listeners.push(fn) },
        sendMessage: (msg, cb) => { window.__chMessages.push(msg); cb && cb(null) },
        lastError: null,
      },
    }
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (text) => { window.__copied = text; return Promise.resolve() } },
    })
  })()`)
  for (const file of ['trace.js', 'collect.js', 'content.js', 'main.js']) {
    await evalJs(await readFile(path.join(ROOT, 'extension', file), 'utf8'))
  }

  // ---- 通用包（legacy 格式回归）----
  console.log('▶ 场景：通用包（空需求，格式应与 0.2 一致）')
  {
    const { md, pack } = await pickAndSubmit('[data-testid="submit-btn"]', 'general', '')
    check('标题无意图后缀', md.startsWith('## 前端元素修改请求\n'))
    check('保留修改意图占位', md.includes('**修改意图**: （在此填写你想怎么改）'))
    check('无专项段落', !md.includes('### ') && !md.includes('**验收建议**'))
    check('含源码位置', md.includes('**源码位置**: src/App.jsx:12'))
    check('含组件 props', md.includes('**组件 props**（<Card>'))
    check('pack.intent=general', pack?.intent === 'general')
    check('pack.packVersion=1', pack?.packVersion === 1)
    check('pack 含 verification', Array.isArray(pack?.verification) && pack.verification.length > 0)
  }

  // ---- 样式包 ----
  console.log('▶ 场景：样式包')
  {
    const { md, pack } = await pickAndSubmit('[data-testid="submit-btn"]', 'style', '把这个按钮往右挪 8px')
    check('标题带（样式）', md.includes('## 前端元素修改请求（样式）'))
    check('需求句写入', md.includes('**需求**: 把这个按钮往右挪 8px'))
    check('含样式上下文段', md.includes('### 样式上下文'))
    check('含盒模型', md.includes('**盒模型**:'))
    check('含父容器（含子元素序号）', /\*\*父容器\*\*:.*个子元素中第/.test(md))
    check('前一个兄弟是 h2', /\*\*前一个兄弟\*\*: `<h2>`/.test(md))
    check('通用样式行被替换', !md.includes('**当前样式**:'))
    check('验收建议锚定源码', md.includes('changehere highlight src/App.jsx:12'))
    check('无修改意图占位', !md.includes('**修改意图**:'))
    check('pack.style.box 存在', Boolean(pack?.style?.box?.['box-sizing']))
    check('pack.style.parent 存在', Boolean(pack?.style?.parent))
  }

  // ---- 交互包 ----
  console.log('▶ 场景：交互包（onClick 处理器）')
  {
    const { md, pack } = await pickAndSubmit('[data-trace-case="double-click"] button', 'interaction', '点一下没反应，要点两下')
    check('含交互上下文段', md.includes('### 交互上下文'))
    check('读到 onClick 处理器名', md.includes('onClick: ƒ increment'))
    check('无阻断因素', md.includes('**阻断因素**: 未发现'))
    check('提示录制轨迹', md.includes('按 R 录制复现轨迹'))
    check('pack.handlers 存在', Array.isArray(pack?.handlers) && pack.handlers.length > 0)
  }

  console.log('▶ 场景：交互包（disabled 阻断检测）')
  {
    // 真实点击一次让按钮进入 disabled 状态
    await evalJs(`document.querySelector('[data-trace-case="disabled-stuck"] button').click()`)
    await waitFor(() => evalJs(`document.querySelector('[data-trace-case="disabled-stuck"] button').disabled`), 'button disabled')
    const { md, pack } = await pickAndSubmit('[data-trace-case="disabled-stuck"] button', 'interaction', '保存按钮点不动了')
    check('检出 disabled 阻断', /\*\*阻断因素\*\* ⚠️:.*disabled/.test(md))
    check('pack.interaction.blockers 含 disabled', pack?.interaction?.blockers?.includes('disabled'))
  }

  // ---- 数据包 ----
  console.log('▶ 场景：数据包（hooks 状态 + 网络 + 列表）')
  {
    await evalJs(`Promise.all([
      fetch('/?e2e-probe=1').then((r) => r.text()),
      fetch('/?e2e-probe=2').then((r) => r.text()),
    ])`, true)
    const { md, pack } = await pickAndSubmit('[data-trace-case="accordion-wrong"] button', 'data', '点击后展开的数据不对')
    check('含数据上下文段', md.includes('### 数据上下文'))
    check('读到组件 hooks 状态', md.includes('**组件状态**') && md.includes('"hooks"'))
    check('组件名 AccordionWrongCase 在 state 里', pack?.state?.some((s) => s.component === 'AccordionWrongCase'))
    check('捕获 fetch 请求', /\*\*最近请求\*\*.*\n- \[200\].*e2e-probe/.test(md))
    check('渲染列表现状（15 个案例）', md.includes('**渲染列表现状**') && md.includes('共 15 项'))
    check('pack.data.network 存在', Array.isArray(pack?.data?.network?.requests) && pack.data.network.requests.length >= 2)
  }

  // ---- 性能包 ----
  console.log('▶ 场景：性能包')
  {
    const { md, pack } = await pickAndSubmit('h1', 'performance', '页面加载和滚动都很卡')
    check('含性能上下文段', md.includes('### 性能上下文'))
    check('含导航计时', /\*\*导航\*\*: TTFB \d+ms/.test(md))
    check('注明未采集渲染次数', md.includes('**未采集**') && md.includes('React 组件渲染次数'))
    check('pack.performance.navigation 存在', Boolean(pack?.performance?.navigation))
  }

  // ---- 无障碍包 ----
  console.log('▶ 场景：无障碍包')
  {
    const { md, pack } = await pickAndSubmit('[data-trace-case="double-click"] button', 'a11y', '读屏能不能念出这个按钮')
    check('含无障碍上下文段', md.includes('### 无障碍上下文'))
    check('隐式 role=button', md.includes('**role**: button（隐式）'))
    check('名称来自文本', md.includes('「增加」') && md.includes('（来自 文本内容）'))
    check('在 Tab 顺序中且有序号', /\*\*焦点\*\*: 在 Tab 顺序第 \d+\/\d+ 位/.test(md))
    check('含对比度', /\*\*文本对比度\*\*: [\d.]+:1/.test(md))
    check('pack.a11y.focus 存在', Boolean(pack?.a11y?.focus))
  }

  // ---- Esc 取消 ----
  console.log('▶ 场景：Esc 取消面板')
  {
    await evalJs(`(() => {
      window.__copied = null
      window.__listeners.forEach((fn) => fn({ type: 'changehere:toggle' }))
      const el = document.querySelector('h1')
      el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })()`)
    await waitFor(() => evalJs(`Boolean(document.querySelector('.ch-intent input'))`), 'intent panel', 3000)
    await evalJs(`document.querySelector('.ch-intent input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await new Promise((resolve) => setTimeout(resolve, 300))
    check('面板已关闭', !(await evalJs(`Boolean(document.querySelector('.ch-intent'))`)))
    check('未复制任何内容', !(await evalJs(`Boolean(window.__copied)`)))
  }
}

try {
  await main()
} catch (error) {
  failures.push(String(error?.message || error))
  console.error('✗ E2E aborted:', error)
} finally {
  try { ws?.close() } catch {}
  chrome?.kill()
  vite?.kill()
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
}

if (failures.length) {
  console.error(`\n✗ E2E failed: ${failures.length} 项`)
  for (const f of failures) console.error('  - ' + f)
  process.exit(1)
}
console.log('\n✓ E2E all scenarios passed')
