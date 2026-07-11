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

test('rejects oversized request bodies before parsing', async () => {
  const response = await fetch(base + '/selection', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ markdown: 'x'.repeat(MAX_BODY_BYTES + 1) }),
  })
  assert.equal(response.status, 413)
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
