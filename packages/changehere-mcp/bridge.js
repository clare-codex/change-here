import { randomBytes, timingSafeEqual } from 'node:crypto'
import http from 'node:http'

export const MAX_BODY_BYTES = 64 * 1024
const MAX_SELECTION_MARKDOWN = 20_000
const MAX_PACK_BYTES = 32_000
const MAX_URL_LENGTH = 2_048
const EXTENSION_ORIGIN_RE = /^chrome-extension:\/\/[a-p]{32}$/
const LOOPBACK_HOST_RE = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i

export function createBridgeState() {
  return {
    selections: [],
    highlights: [],
    traces: [],
  }
}

function isExtensionOrigin(origin) {
  return typeof origin === 'string' && EXTENSION_ORIGIN_RE.test(origin)
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

function bearerToken(req) {
  const value = req.headers.authorization
  return typeof value === 'string' && value.startsWith('Bearer ') ? value.slice(7) : ''
}

function trustForUrl(value) {
  try {
    const url = new URL(value)
    return /^(?:localhost|127\.0\.0\.1)$/.test(url.hostname)
      ? 'local-dev'
      : 'user-approved-page'
  } catch {
    return 'untrusted-page'
  }
}

function readJsonBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let buf = ''
    let size = 0
    let settled = false

    req.on('data', (chunk) => {
      if (settled) return
      size += chunk.length
      if (size > limit) {
        settled = true
        const error = new Error('request body too large')
        error.statusCode = 413
        reject(error)
        return
      }
      buf += chunk
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      try {
        resolve(JSON.parse(buf || 'null'))
      } catch {
        const error = new Error('invalid json')
        error.statusCode = 400
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

export function createBridgeServer(options = {}) {
  const state = options.state ?? createBridgeState()
  const tokenFactory = options.tokenFactory ?? (() => randomBytes(32).toString('base64url'))
  const pairingTokens = new Map()

  function corsHeaders(origin) {
    if (!isExtensionOrigin(origin)) return {}
    return {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-allow-private-network': 'true',
      vary: 'Origin',
    }
  }

  function json(req, res, code, data, extraHeaders = {}) {
    res.writeHead(code, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...corsHeaders(req.headers.origin),
      ...extraHeaders,
    })
    res.end(JSON.stringify(data))
  }

  function browserAuthorized(req) {
    const origin = req.headers.origin
    if (!origin) return true // 同机 MCP/CLI 请求不会携带 Origin
    if (!isExtensionOrigin(origin)) return false
    return safeEqual(pairingTokens.get(origin), bearerToken(req))
  }

  return http.createServer(async (req, res) => {
    const host = req.headers.host || ''
    if (!LOOPBACK_HOST_RE.test(host)) {
      return json(req, res, 403, { error: 'invalid host' })
    }

    const origin = req.headers.origin
    const path = new URL(req.url || '/', 'http://localhost').pathname

    if (req.method === 'OPTIONS') {
      if (!isExtensionOrigin(origin)) {
        return json(req, res, 403, { error: 'browser origin not allowed' })
      }
      res.writeHead(204, corsHeaders(origin))
      return res.end()
    }

    if (req.method === 'POST' && path === '/pair') {
      if (!isExtensionOrigin(origin)) {
        return json(req, res, 403, { error: 'extension origin required' })
      }
      const token = tokenFactory()
      pairingTokens.set(origin, token)
      return json(req, res, 200, { token })
    }

    if (!browserAuthorized(req)) {
      return json(req, res, isExtensionOrigin(origin) ? 401 : 403, {
        error: isExtensionOrigin(origin) ? 'pairing required' : 'browser origin not allowed',
      })
    }

    if (req.method === 'GET' && path === '/status') {
      return json(req, res, 200, {
        ok: true,
        version: 1,
        selections: state.selections.length,
        traces: state.traces.length,
      })
    }

    if (req.method === 'POST' && path === '/selection') {
      try {
        const body = await readJsonBody(req)
        if (!body || typeof body.markdown !== 'string') {
          return json(req, res, 400, { error: 'markdown required' })
        }
        const url = String(body.url || '').slice(0, MAX_URL_LENGTH)
        // 结构化上下文包（packVersion 1）：只透传对象，超限丢弃并注明
        let pack = null
        if (body.pack && typeof body.pack === 'object' && !Array.isArray(body.pack)) {
          pack = JSON.stringify(body.pack).length <= MAX_PACK_BYTES
            ? body.pack
            : { dropped: `pack exceeded ${MAX_PACK_BYTES} bytes` }
        }
        state.selections.unshift({
          markdown: body.markdown.slice(0, MAX_SELECTION_MARKDOWN),
          url,
          pack,
          at: new Date().toISOString(),
          provenance: {
            channel: origin ? 'verified-extension' : 'local-process',
            pageTrust: trustForUrl(url),
          },
        })
        state.selections.length = Math.min(state.selections.length, 10)
        return json(req, res, 200, { ok: true })
      } catch (error) {
        return json(req, res, error.statusCode || 400, { error: error.message })
      }
    }

    if (req.method === 'GET' && path === '/selection') {
      return json(req, res, 200, {
        latest: state.selections[0] ?? null,
        count: state.selections.length,
      })
    }

    if (req.method === 'POST' && path === '/trace') {
      try {
        const body = await readJsonBody(req)
        if (!body || body.version !== 1 || typeof body.id !== 'string' || !Array.isArray(body.records)) {
          return json(req, res, 400, { error: 'valid trace required' })
        }
        const trace = {
          version: 1,
          id: body.id.slice(0, 120),
          url: String(body.url || '').slice(0, MAX_URL_LENGTH),
          startedAt: String(body.startedAt || ''),
          durationMs: Math.max(0, Math.min(10_000, Number(body.durationMs) || 0)),
          stopReason: String(body.stopReason || 'unknown').slice(0, 40),
          target: body.target ?? null,
          elementBefore: body.elementBefore ?? null,
          elementAfter: body.elementAfter ?? null,
          elementDiff: Array.isArray(body.elementDiff) ? body.elementDiff.slice(0, 100) : [],
          records: body.records.slice(0, 100),
          receivedAt: new Date().toISOString(),
          provenance: {
            channel: origin ? 'verified-extension' : 'local-process',
            pageTrust: trustForUrl(body.url),
          },
        }
        state.traces.unshift(trace)
        state.traces.length = Math.min(state.traces.length, 10)
        return json(req, res, 200, { ok: true, id: trace.id })
      } catch (error) {
        return json(req, res, error.statusCode || 400, { error: error.message })
      }
    }

    if (req.method === 'GET' && path === '/trace') {
      return json(req, res, 200, {
        latest: state.traces[0] ?? null,
        count: state.traces.length,
      })
    }

    if (req.method === 'POST' && path === '/trace/highlight') {
      try {
        const body = await readJsonBody(req)
        const trace = state.traces.find((item) => item.id === body?.traceId)
        const step = Number(body?.step)
        if (!trace || !Number.isInteger(step) || step < 0 || step >= trace.records.length) {
          return json(req, res, 404, { error: 'trace step not found' })
        }
        const record = trace.records[step]
        const source = record?.target?.source ?? record?.source ?? trace.target?.source
        if (!source || typeof source.file !== 'string' || !Number.isFinite(Number(source.line))) {
          return json(req, res, 422, { error: 'trace step has no source anchor' })
        }
        const command = {
          kind: 'trace-step',
          traceId: trace.id,
          step,
          file: source.file,
          line: Number(source.line),
          at: new Date().toISOString(),
        }
        state.highlights.push(command)
        return json(req, res, 200, { ok: true, command })
      } catch (error) {
        return json(req, res, error.statusCode || 400, { error: error.message })
      }
    }

    if (req.method === 'POST' && path === '/highlight') {
      try {
        const body = await readJsonBody(req)
        if (!body || typeof body.file !== 'string' || body.file.length > 1_024) {
          return json(req, res, 400, { error: 'valid file required' })
        }
        state.highlights.push({
          file: body.file,
          line: body.line == null ? null : Number(body.line),
          at: new Date().toISOString(),
        })
        return json(req, res, 200, { ok: true })
      } catch (error) {
        return json(req, res, error.statusCode || 400, { error: error.message })
      }
    }

    if (req.method === 'GET' && path === '/highlight/pending') {
      const cutoff = Date.now() - 15_000
      state.highlights = state.highlights.filter((item) => Date.parse(item.at) > cutoff)
      return json(req, res, 200, state.highlights)
    }

    return json(req, res, 404, { error: 'not found' })
  })
}
