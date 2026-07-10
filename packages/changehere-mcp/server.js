#!/usr/bin/env node
// 改这里 ChangeHere MCP server
//
// 同一进程做两件事：
// 1. HTTP bridge（127.0.0.1:5299）：浏览器扩展 POST 选区、轮询待高亮命令
// 2. stdio MCP：暴露 get_selection / highlight 两个工具给 coding agent
//
// 多个 agent 会话各起一个本进程：谁先绑定端口谁当 bridge 宿主，
// 后来者绑定失败自动降级为纯客户端——工具统一走 HTTP，行为一致。
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import http from 'node:http'

const PORT = Number(process.env.CHANGEHERE_PORT || 5299)
const BASE = `http://127.0.0.1:${PORT}`

const state = {
  selections: [], // {markdown, url, at} 新的在前，最多 10 条
  highlights: [], // {file, line, at} 15s 内有效，扩展轮询后按 at 去重
}

function json(res, code, data) {
  res.writeHead(code, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
  })
  res.end(JSON.stringify(data))
}

function readBody(req) {
  return new Promise((resolve) => {
    let buf = ''
    req.on('data', (c) => (buf += c))
    req.on('end', () => {
      try { resolve(JSON.parse(buf)) } catch { resolve(null) }
    })
  })
}

const httpServer = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-private-network': 'true',
    })
    return res.end()
  }
  const path = req.url.split('?')[0]

  if (req.method === 'POST' && path === '/selection') {
    const body = await readBody(req)
    if (body && typeof body.markdown === 'string') {
      state.selections.unshift({
        markdown: body.markdown.slice(0, 20000),
        url: String(body.url || ''),
        at: new Date().toISOString(),
      })
      state.selections.length = Math.min(state.selections.length, 10)
      return json(res, 200, { ok: true })
    }
    return json(res, 400, { error: 'markdown required' })
  }

  if (req.method === 'GET' && path === '/selection') {
    return json(res, 200, { latest: state.selections[0] ?? null, count: state.selections.length })
  }

  if (req.method === 'POST' && path === '/highlight') {
    const body = await readBody(req)
    if (body && typeof body.file === 'string') {
      state.highlights.push({
        file: body.file,
        line: body.line == null ? null : Number(body.line),
        at: new Date().toISOString(),
      })
      return json(res, 200, { ok: true })
    }
    return json(res, 400, { error: 'file required' })
  }

  if (req.method === 'GET' && path === '/highlight/pending') {
    // 不清空、只裁剪过期项：多标签页都能收到，扩展侧按 at 去重
    const cutoff = Date.now() - 15000
    state.highlights = state.highlights.filter((h) => Date.parse(h.at) > cutoff)
    return json(res, 200, state.highlights)
  }

  json(res, 404, { error: 'not found' })
})

httpServer.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    // 已有实例当宿主，本进程只做 MCP 客户端
    startMcp()
  } else {
    console.error('[changehere-mcp]', e.message)
    process.exit(1)
  }
})

httpServer.listen(PORT, '127.0.0.1', startMcp)

let mcpStarted = false
async function startMcp() {
  if (mcpStarted) return
  mcpStarted = true

  const mcp = new McpServer({ name: 'changehere', version: '0.1.0' })

  mcp.tool(
    'get_selection',
    '获取用户刚在浏览器里用「改这里 ChangeHere」扩展选取的页面元素信息（markdown，含源码位置/组件链/样式/props）。用户说"改我刚选的元素/这个元素"时调用。',
    {},
    async () => {
      try {
        const r = await (await fetch(`${BASE}/selection`)).json()
        if (!r.latest) {
          return { content: [{ type: 'text', text: '还没有选区记录。请先在浏览器里用「改这里」扩展点选一个元素。' }] }
        }
        return {
          content: [{ type: 'text', text: `（选取于 ${r.latest.at}，共 ${r.count} 条记录，返回最新）\n\n${r.latest.markdown}` }],
        }
      } catch {
        return { content: [{ type: 'text', text: 'bridge 未运行（端口 ' + PORT + ' 无响应），无法读取选区。' }], isError: true }
      }
    }
  )

  mcp.tool(
    'highlight',
    '在用户浏览器的本地 dev 页面上高亮来自指定源码位置的元素（粉色脉冲 8 秒）。改完前端代码后调用，把改动位置指给用户看。',
    { file: z.string().describe('源码相对路径，如 src/App.jsx'), line: z.number().optional().describe('行号，可省略（匹配整个文件）') },
    async ({ file, line }) => {
      try {
        await fetch(`${BASE}/highlight`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ file, line }),
        })
        return { content: [{ type: 'text', text: `已推送高亮 ${file}${line ? ':' + line : ''}，页面 3 秒内生效（需 dev 页面开着且扩展已加载）。` }] }
      } catch {
        return { content: [{ type: 'text', text: 'bridge 未运行，高亮推送失败。' }], isError: true }
      }
    }
  )

  await mcp.connect(new StdioServerTransport())
}
