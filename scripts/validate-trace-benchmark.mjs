import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const cases = JSON.parse(await readFile(new URL('benchmark/trace-cases.json', root), 'utf8'))
const source = await readFile(new URL('example/src/components/TraceLab.jsx', root), 'utf8')

assert.ok(cases.length >= 15 && cases.length <= 20, 'benchmark must contain 15–20 cases')
assert.equal(new Set(cases.map((item) => item.id)).size, cases.length, 'case ids must be unique')

for (const item of cases) {
  assert.match(item.id, /^[a-z0-9-]+$/, `invalid id: ${item.id}`)
  assert.ok(Array.isArray(item.steps) && item.steps.length >= 1, `${item.id}: steps required`)
  assert.ok(Array.isArray(item.expectedSignals) && item.expectedSignals.length >= 2, `${item.id}: at least two trace signals required`)
  assert.ok(item.staticSelectionGap?.length >= 20, `${item.id}: static-selection gap required`)
  assert.ok(source.includes(`id="${item.id}"`), `${item.id}: missing TraceLab implementation`)
}

const categories = new Set(cases.map((item) => item.category))
assert.ok(categories.size >= 8, 'benchmark needs broad dynamic-bug coverage')

console.log(`Validated ${cases.length} trace benchmark cases across ${categories.size} categories.`)
