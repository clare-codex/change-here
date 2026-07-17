import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../extension/collect.js', import.meta.url), 'utf8')
const context = { window: {} }
vm.runInNewContext(source, context)
const {
  parseColor, compositeOver, luminance, contrastRatio, requiredContrast,
  implicitRole, verificationFor,
} = context.window.__changehereCollect.internals

// vm 里创建的数组/对象原型跨 realm，deepEqual 前要过一遍 JSON（同 trace-diff 测试）
const plain = (value) => JSON.parse(JSON.stringify(value))

test('parseColor handles rgb, rgba, and slash/percent alpha syntax', () => {
  assert.deepEqual(plain(parseColor('rgb(255, 255, 255)')), [255, 255, 255, 1])
  assert.deepEqual(plain(parseColor('rgba(0, 0, 0, 0.5)')), [0, 0, 0, 0.5])
  assert.deepEqual(plain(parseColor('rgb(10 20 30 / 40%)')), [10, 20, 30, 0.4])
  assert.equal(parseColor('nonsense'), null)
  assert.equal(parseColor(''), null)
})

test('contrastRatio matches WCAG reference values', () => {
  const white = [255, 255, 255, 1]
  const black = [0, 0, 0, 1]
  assert.equal(contrastRatio(white, black).toFixed(0), '21')
  assert.equal(contrastRatio(white, white), 1)
  // #767676 on white 是 WCAG 文档里的 4.54:1 参考值
  assert.equal(contrastRatio([118, 118, 118, 1], white).toFixed(2), '4.54')
  // 顺序无关
  assert.equal(contrastRatio(black, white), contrastRatio(white, black))
})

test('luminance is monotonic in lightness', () => {
  assert.ok(luminance([0, 0, 0]) < luminance([128, 128, 128]))
  assert.ok(luminance([128, 128, 128]) < luminance([255, 255, 255]))
})

test('compositeOver blends translucent foreground over background', () => {
  const blended = compositeOver([0, 0, 0, 0.5], [255, 255, 255, 1])
  assert.deepEqual(plain(blended), [127.5, 127.5, 127.5, 1])
  // 不透明前景无视背景
  assert.deepEqual(plain(compositeOver([10, 20, 30, 1], [255, 255, 255, 1])), [10, 20, 30, 1])
})

test('requiredContrast applies the large-text thresholds', () => {
  assert.equal(requiredContrast(16, 400), 4.5)
  assert.equal(requiredContrast(24, 400), 3)
  assert.equal(requiredContrast(19, 700), 3)
  assert.equal(requiredContrast(18, 700), 4.5)
})

test('implicitRole maps common tags including input types', () => {
  const attrs = (map = {}) => (name) => (name in map ? map[name] : null)
  assert.equal(implicitRole('button', attrs()), 'button')
  assert.equal(implicitRole('a', attrs({ href: '/x' })), 'link')
  assert.equal(implicitRole('a', attrs()), null)
  assert.equal(implicitRole('input', attrs({ type: 'checkbox' })), 'checkbox')
  assert.equal(implicitRole('input', attrs()), 'textbox')
  assert.equal(implicitRole('input', attrs({ type: 'submit' })), 'button')
  assert.equal(implicitRole('input', attrs({ type: 'hidden' })), null)
  assert.equal(implicitRole('img', attrs({ alt: '' })), 'presentation')
  assert.equal(implicitRole('img', attrs()), 'img')
  assert.equal(implicitRole('select', attrs()), 'combobox')
  assert.equal(implicitRole('select', attrs({ multiple: '' })), 'listbox')
  assert.equal(implicitRole('h2', attrs()), 'heading')
  assert.equal(implicitRole('th', attrs({ scope: 'row' })), 'rowheader')
  assert.equal(implicitRole('div', attrs()), null)
})

test('verificationFor anchors highlight command to source location', () => {
  const style = verificationFor('style', 'src/App.jsx:12')
  assert.ok(style.some((rule) => rule.includes('changehere highlight src/App.jsx:12')))
  assert.ok(style.length >= 2)

  const interaction = verificationFor('interaction', 'src/App.jsx:12')
  assert.ok(interaction.some((rule) => rule.includes('changehere trace last')))

  // 无源码位置时退化为手动反向定位提示，不产出错误命令
  const noLoc = verificationFor('style', null)
  assert.ok(noLoc.every((rule) => !rule.includes('changehere highlight null')))

  // 未知 intent 落到 general
  assert.deepEqual(plain(verificationFor('unknown', 'a.jsx:1')), plain(verificationFor('general', 'a.jsx:1')))
})
