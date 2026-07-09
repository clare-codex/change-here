import Card from './components/Card'

export default function App() {
  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: 640, margin: '40px auto' }}>
      <h1>改这里 playground</h1>
      <p className="intro">开启选取模式后点击任意元素测试。</p>
      <Card title="第一张卡片">
        <button className="btn primary">提交</button>
      </Card>
      <Card title="第二张卡片">
        <ul>
          <li>列表项 A</li>
          <li>列表项 B</li>
        </ul>
      </Card>
    </div>
  )
}
