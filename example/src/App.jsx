import Card from './components/Card'
import { Badge, Chip, FancyInput } from './components/Badge'
import TraceLab from './components/TraceLab'

export default function App() {
  const showTraceLab = new URLSearchParams(location.search).has('trace-lab')
  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: showTraceLab ? 980 : 640, margin: '40px auto' }}>
      <h1>改这里 playground</h1>
      <p className="intro">开启选取模式后点击任意元素测试。</p>
      <Card title="第一张卡片">
        <button className="btn primary css-1x2y3z" data-testid="submit-btn">提交</button>
      </Card>
      <Card title="第二张卡片">
        <ul>
          <li>列表项 A</li>
          <li>列表项 B</li>
        </ul>
      </Card>
      <Card title="包装组件测试">
        <Badge label="memo 组件" /> <Chip text="memo 箭头" /> <FancyInput data-x="1" />
      </Card>
      <p><a href={showTraceLab ? '/' : '/?trace-lab'}>{showTraceLab ? '返回基础 playground' : '打开动态轨迹实验台'}</a></p>
      {showTraceLab && <TraceLab />}
    </div>
  )
}
