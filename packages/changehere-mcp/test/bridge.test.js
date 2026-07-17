import assert from 'node:assert/strict'
import http from 'node:http'
import { after, before, test } from 'node:test'
import { createBridgeServer, MAX_BODY_BYTES } from '../bridge.js'

const EXTENSION_ORIGIN = 'chrome-extension://' + 'a'.repeat(32)
let server
let base

before(async () => {
  server = createBridgeServer({ tokenFactory: () => 'test-pairing-token' })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  base = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  await new Promise((resolve) => server.close(resolve))
})

test('allows local non-browser health checks', async () => {
  const response = await fetch(base + '/status')
  assert.equal(response.status, 200)
  assert.equal((await response.json()).ok, true)
  assert.equal(response.headers.get('access-control-allow-origin'), null)
})

test('rejects public-page CORS and private-network preflights', async () => {
  const response = await fetch(base + '/selection', {
    method: 'OPTIONS',
    headers: {
      origin: 'https://attacker.example',
      'access-control-request-method': 'POST',
      'access-control-request-private-network': 'true',
    },
  })
  assert.equal(response.status, 403)
  assert.equal(response.headers.get('access-control-allow-private-network'), null)
  assert.equal(response.headers.get('access-control-allow-origin'), null)
})

test('pairs an extension origin and requires its bearer token', async () => {
  const pairResponse = await fetch(base + '/pair', {
    method: 'POST',
    headers: { origin: EXTENSION_ORIGIN },
  })
  assert.equal(pairResponse.status, 200)
  assert.equal(pairResponse.headers.get('access-control-allow-origin'), EXTENSION_ORIGIN)
  const { token } = await pairResponse.json()

  const unauthorized = await fetch(base + '/selection', {
    method: 'POST',
    headers: { origin: EXTENSION_ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({ markdown: 'forged', url: 'http://localhost:5173' }),
  })
  assert.equal(unauthorized.status, 401)

  const accepted = await fetch(base + '/selection', {
    method: 'POST',
    headers: {
      origin: EXTENSION_ORIGIN,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ markdown: 'selected button', url: 'http://localhost:5173' }),
  })
  assert.equal(accepted.status, 200)

  const stored = await (await fetch(base + '/selection')).json()
  assert.equal(stored.latest.markdown, 'selected button')
  assert.deepEqual(stored.latest.provenance, {
    channel: 'verified-extension',
    pageTrust: 'local-dev',
  })
})

test('stores structured context packs and drops oversized ones', async () => {
  const pack = { packVersion: 1, intent: 'style', target: { tag: 'button' }, verification: ['rule'] }
  const accepted = await fetch(base + '/selection', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ markdown: 'with pack', url: 'http://localhost:5173', pack }),
  })
  assert.equal(accepted.status, 200)
  const stored = await (await fetch(base + '/selection')).json()
  assert.deepEqual(stored.latest.pack, pack)

  // 超过 32k 的 pack 丢弃并注明，不 500 也不透传
  const oversized = await fetch(base + '/selection', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      markdown: 'oversized pack',
      url: 'http://localhost:5173',
      pack: { blob: 'x'.repeat(33_000) },
    }),
  })
  assert.equal(oversized.status, 200)
  const dropped = await (await fetch(base + '/selection')).json()
  assert.equal(dropped.latest.markdown, 'oversized pack')
  assert.match(dropped.latest.pack.dropped, /exceeded/)

  // 非对象 pack 一律拒收为 null
  await fetch(base + '/selection', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ markdown: 'array pack', url: 'http://localhost:5173', pack: [1, 2] }),
  })
  const arrayPack = await (await fetch(base + '/selection')).json()
  assert.equal(arrayPack.latest.pack, null)
})

test('rejects oversized request bodies before parsing', async () => {
  const response = await fetch(base + '/selection', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ markdown: 'x'.repeat(MAX_BODY_BYTES + 1) }),
  })
  assert.equal(response.status, 413)
})

test('stores only bounded versioned traces', async () => {
  const trace = {
    version: 1,
    id: 'trace-test',
    url: 'http://localhost:5173/trace-lab',
    startedAt: new Date().toISOString(),
    durationMs: 800,
    stopReason: 'manual',
    target: { tag: 'button', source: { file: 'src/App.jsx', line: 10, column: 3 } },
    elementBefore: { text: 'Closed', visible: true },
    elementAfter: { text: 'Open', visible: true },
    elementDiff: [{ field: 'text', before: 'Closed', after: 'Open' }],
    records: Array.from({ length: 120 }, (_, index) => ({ kind: 'event', type: 'click', atMs: index })),
  }
  const response = await fetch(base + '/trace', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(trace),
  })
  assert.equal(response.status, 200)
  const stored = await (await fetch(base + '/trace')).json()
  assert.equal(stored.latest.id, 'trace-test')
  assert.equal(stored.latest.records.length, 100)
  assert.equal(stored.latest.provenance.pageTrust, 'local-dev')
  assert.deepEqual(stored.latest.elementDiff, [{ field: 'text', before: 'Closed', after: 'Open' }])

  const highlight = await fetch(base + '/trace/highlight', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ traceId: 'trace-test', step: 0 }),
  })
  assert.equal(highlight.status, 200)
  const command = (await highlight.json()).command
  assert.deepEqual(
    { kind: command.kind, traceId: command.traceId, step: command.step, file: command.file, line: command.line },
    { kind: 'trace-step', traceId: 'trace-test', step: 0, file: 'src/App.jsx', line: 10 }
  )
})

test('rejects DNS-rebinding Host headers', async () => {
  const status = await new Promise((resolve, reject) => {
    const request = http.request(base + '/status', {
      headers: { host: 'attacker.example' },
    }, (response) => {
      response.resume()
      response.on('end', () => resolve(response.statusCode))
    })
    request.on('error', reject)
    request.end()
  })
  assert.equal(status, 403)
})
