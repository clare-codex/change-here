import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const caseStyle = {
  border: '1px solid #ddd',
  borderRadius: 8,
  padding: 12,
  minHeight: 118,
  background: '#fff',
}

function TraceCase({ id, title, hint, children }) {
  return (
    <article data-trace-case={id} style={caseStyle}>
      <strong>{title}</strong>
      <p style={{ color: '#666', fontSize: 13, margin: '6px 0 10px' }}>{hint}</p>
      {children}
    </article>
  )
}

function DoubleClickCase() {
  const [armed, setArmed] = useState(false)
  const [count, setCount] = useState(0)
  function increment() {
    if (armed) setCount((value) => value + 1)
    setArmed((value) => !value)
  }
  return (
    <TraceCase id="double-click" title="首次点击被吞" hint="点击一次没有计数，第二次才生效。">
      <button onClick={increment}>增加</button> <span>count: {count}</span>
    </TraceCase>
  )
}

function DropdownFlashCase() {
  const [open, setOpen] = useState(false)
  function openMenu() {
    setOpen(true)
    setTimeout(() => setOpen(false), 120)
  }
  return (
    <TraceCase id="dropdown-flash" title="下拉菜单闪退" hint="点击后菜单出现约 120ms 就消失。">
      <button aria-expanded={open} onClick={openMenu}>打开菜单</button>
      {open && <div role="menu">短暂菜单</div>}
    </TraceCase>
  )
}

function FocusLossCase() {
  const [value, setValue] = useState('')
  return (
    <TraceCase id="focus-loss" title="输入时焦点丢失" hint="每输入一个字符，input 都因错误 key 被重建。">
      <input key={value.length} value={value} onChange={(event) => setValue(event.target.value)} placeholder="连续输入 abc" />
    </TraceCase>
  )
}

function ScrollMisalignmentCase() {
  const [open, setOpen] = useState(false)
  return (
    <TraceCase id="scroll-misalignment" title="滚动后浮层错位" hint="打开浮层，再滚动灰色容器。">
      <div style={{ height: 64, overflow: 'auto', position: 'relative', background: '#f4f4f5' }}>
        <div style={{ height: 130, paddingTop: 8 }}>
          <button onClick={() => setOpen((value) => !value)}>切换浮层</button>
        </div>
        {open && <div style={{ position: 'absolute', top: 34, left: 90, background: '#fde68a' }}>未跟随锚点</div>}
      </div>
    </TraceCase>
  )
}

function AsyncRaceCase() {
  const [result, setResult] = useState('无结果')
  function run(label, delay) {
    setResult(`加载 ${label}…`)
    setTimeout(() => setResult(`${label} 完成`), delay)
  }
  return (
    <TraceCase id="async-race" title="异步响应覆盖" hint="先点慢请求，立即点快请求；慢结果最后覆盖快结果。">
      <button onClick={() => run('慢请求', 500)}>慢请求</button>{' '}
      <button onClick={() => run('快请求', 80)}>快请求</button>
      <div>{result}</div>
    </TraceCase>
  )
}

function PortalCloseCase() {
  const [open, setOpen] = useState(false)
  function show() {
    setOpen(true)
    setTimeout(() => setOpen(false), 80)
  }
  return (
    <TraceCase id="portal-close" title="Portal 立即关闭" hint="点击后弹层刚挂载就被关闭逻辑清掉。">
      <button onClick={show}>打开 Portal</button>
      {open && createPortal(<div style={{ position: 'fixed', right: 20, bottom: 20, background: '#fecaca', padding: 10 }}>Portal 内容</div>, document.body)}
    </TraceCase>
  )
}

function StaleDebounceCase() {
  const [draft, setDraft] = useState('')
  const [saved, setSaved] = useState('')
  function update(event) {
    const next = event.target.value
    setDraft(next)
    setTimeout(() => setSaved(next), 300)
  }
  return (
    <TraceCase id="stale-debounce" title="失效的 debounce" hint="快速输入多个字符，旧定时器会连续提交过期值。">
      <input value={draft} onChange={update} placeholder="快速输入" />
      <div>已保存：{saved}</div>
    </TraceCase>
  )
}

function DisabledStuckCase() {
  const [disabled, setDisabled] = useState(false)
  const [status, setStatus] = useState('等待保存')
  function save() {
    setDisabled(true)
    setStatus('保存中…')
    setTimeout(() => setStatus('保存失败，但按钮仍禁用'), 250)
  }
  return (
    <TraceCase id="disabled-stuck" title="失败后按钮永久禁用" hint="保存失败路径遗漏 finally。">
      <button disabled={disabled} onClick={save}>保存</button> <span>{status}</span>
    </TraceCase>
  )
}

function OptimisticRollbackCase() {
  const [liked, setLiked] = useState(false)
  function like() {
    setLiked(true)
    setTimeout(() => setLiked(false), 250)
  }
  return (
    <TraceCase id="optimistic-rollback" title="乐观状态静默回滚" hint="点赞后没有错误提示，状态自动退回。">
      <button aria-pressed={liked} onClick={like}>{liked ? '已点赞' : '点赞'}</button>
    </TraceCase>
  )
}

function HoverFlickerCase() {
  const [show, setShow] = useState(false)
  return (
    <TraceCase id="hover-flicker" title="Tooltip 无法悬停" hint="把鼠标从目标移向 Portal tooltip，它立刻消失。">
      <span onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)} style={{ textDecoration: 'underline' }}>悬停目标</span>
      {show && createPortal(<div style={{ position: 'fixed', left: 24, top: 24, background: '#ddd6fe', padding: 8 }}>尝试移到这里</div>, document.body)}
    </TraceCase>
  )
}

function EscapeLeakCase() {
  const [outer, setOuter] = useState(false)
  const [inner, setInner] = useState(false)
  useEffect(() => {
    function closeBoth(event) {
      if (event.key === 'Escape') {
        setInner(false)
        setOuter(false)
      }
    }
    window.addEventListener('keydown', closeBoth)
    return () => window.removeEventListener('keydown', closeBoth)
  }, [])
  return (
    <TraceCase id="escape-leak" title="Esc 穿透两层弹窗" hint="打开内层后按 Esc，外层也一起关闭。">
      <button onClick={() => setOuter(true)}>打开外层</button>
      {outer && <div>外层 <button onClick={() => setInner(true)}>打开内层</button> {inner && <b>内层已开</b>}</div>}
    </TraceCase>
  )
}

function CaretJumpCase() {
  const [value, setValue] = useState('')
  const inputRef = useRef(null)
  useEffect(() => {
    if (value && inputRef.current) inputRef.current.setSelectionRange(0, 0)
  }, [value])
  return (
    <TraceCase id="caret-jump" title="格式化导致光标跳头" hint="输入后光标被强制移到开头。">
      <input ref={inputRef} value={value} onChange={(event) => setValue(event.target.value.toUpperCase())} placeholder="输入 abc" />
    </TraceCase>
  )
}

function AccordionWrongCase() {
  const [openIndex, setOpenIndex] = useState(null)
  const items = ['账户', '安全', '通知']
  return (
    <TraceCase id="accordion-wrong" title="Accordion 打开错项" hint="点击一项，却展开下一项。">
      {items.map((item, index) => (
        <div key={item}>
          <button onClick={() => setOpenIndex((index + 1) % items.length)}>{item}</button>
          {openIndex === index && <span> {item} 内容</span>}
        </div>
      ))}
    </TraceCase>
  )
}

function StaleTooltipCase() {
  const [count, setCount] = useState(0)
  const [tooltip, setTooltip] = useState(null)
  return (
    <TraceCase id="stale-tooltip" title="Tooltip 展示旧状态" hint="先显示 tooltip，再加一；tooltip 保留旧值。">
      <button onClick={() => setTooltip((value) => value ? null : `当前值：${count}`)}>显示 Tooltip</button>{' '}
      <button onClick={() => setCount((value) => value + 1)}>加一</button>
      <span> count: {count} {tooltip && ` / ${tooltip}`}</span>
    </TraceCase>
  )
}

function SpinnerStuckCase() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  function load() {
    setLoading(true)
    setError('')
    setTimeout(() => setError('请求失败'), 250)
  }
  return (
    <TraceCase id="spinner-stuck" title="失败后 loading 不结束" hint="错误已出现，spinner 仍持续显示。">
      <button onClick={load}>加载</button> {loading && <span role="status">⏳</span>} {error && <span>{error}</span>}
    </TraceCase>
  )
}

export default function TraceLab() {
  return (
    <section style={{ marginTop: 40 }}>
      <h2>Source-Anchored Microtrace Lab</h2>
      <p>每个案例先指向交互起点并按 R，再按提示复现；再次按 R 停止。</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 12 }}>
        <DoubleClickCase />
        <DropdownFlashCase />
        <FocusLossCase />
        <ScrollMisalignmentCase />
        <AsyncRaceCase />
        <PortalCloseCase />
        <StaleDebounceCase />
        <DisabledStuckCase />
        <OptimisticRollbackCase />
        <HoverFlickerCase />
        <EscapeLeakCase />
        <CaretJumpCase />
        <AccordionWrongCase />
        <StaleTooltipCase />
        <SpinnerStuckCase />
      </div>
    </section>
  )
}
