import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../extension/trace.js', import.meta.url), 'utf8')
const context = { window: {} }
vm.runInNewContext(source, context)
const { diffSnapshots } = context.window.__changehereTrace.internals

test('reports element removal', () => {
  const changes = diffSnapshots({ text: 'Menu', visible: true, rect: {}, attributes: {}, styles: {} }, null)
  assert.deepEqual(JSON.parse(JSON.stringify(changes)), [{ field: 'element', before: 'present', after: null }])
})

test('reports text, geometry, attribute, and style changes', () => {
  const changes = diffSnapshots(
    {
      text: 'Closed',
      visible: true,
      rect: { x: 10, y: 20, width: 100, height: 30 },
      attributes: { 'aria-expanded': 'false' },
      styles: { display: 'block', opacity: '1' },
    },
    {
      text: 'Open',
      visible: false,
      rect: { x: 12, y: 20, width: 120, height: 30 },
      attributes: { 'aria-expanded': 'true' },
      styles: { display: 'none', opacity: '1' },
    }
  )
  const fields = changes.map((change) => change.field)
  assert.deepEqual(JSON.parse(JSON.stringify(fields)), [
    'text',
    'visible',
    'rect.x',
    'rect.width',
    'attributes.aria-expanded',
    'styles.display',
  ])
})
