import { parse } from '@babel/parser'
import MagicString from 'magic-string'
import path from 'node:path'

/**
 * 仅 dev 生效：给每个 JSX 原生元素（div/button/...）注入
 *   data-ch="组件名@相对路径:行:列"
 * 供「改这里 ChangeHere」Chrome 插件在页面上读取。
 */
export default function changeHere() {
  let root = ''
  return {
    name: 'changehere',
    apply: 'serve',
    enforce: 'pre',
    configResolved(config) {
      root = config.root
    },
    transform(code, id) {
      const [file] = id.split('?')
      if (!/\.[jt]sx$/.test(file) || file.includes('node_modules')) return
      const rel = path.relative(root, file).split(path.sep).join('/')

      let ast
      try {
        ast = parse(code, {
          sourceType: 'module',
          plugins: ['jsx', 'typescript', 'decorators-legacy'],
        })
      } catch {
        return
      }

      const s = new MagicString(code)
      let changed = false

      walk(ast.program, '', (node, comp) => {
        if (
          node.type === 'JSXOpeningElement' &&
          node.name.type === 'JSXIdentifier' &&
          /^[a-z]/.test(node.name.name)
        ) {
          const { line, column } = node.loc.start
          // 注在最后一个属性之后，保证 data-ch 不被 {...props} 覆盖
          const attrs = node.attributes
          const insertAt = attrs.length ? attrs[attrs.length - 1].end : node.name.end
          s.appendLeft(insertAt, ` data-ch="${comp}@${rel}:${line}:${column + 1}"`)
          changed = true
        }
      })

      if (!changed) return
      return { code: s.toString(), map: s.generateMap({ hires: true }) }
    },
  }
}

/** 取节点声明的组件名（大写开头的函数/类/变量），用于 JSX 归属 */
function componentNameOf(node) {
  if (
    (node.type === 'FunctionDeclaration' ||
      node.type === 'ClassDeclaration' ||
      node.type === 'FunctionExpression') &&
    node.id && /^[A-Z]/.test(node.id.name)
  ) {
    return node.id.name
  }
  // const Card = () => ... / memo(...) / forwardRef(...) / observer(...) 等包装调用
  if (
    node.type === 'VariableDeclarator' &&
    node.id.type === 'Identifier' &&
    /^[A-Z]/.test(node.id.name) &&
    node.init &&
    (node.init.type === 'ArrowFunctionExpression' ||
      node.init.type === 'FunctionExpression' ||
      node.init.type === 'CallExpression')
  ) {
    return node.id.name
  }
  return null
}

function walk(node, comp, visit) {
  if (!node || typeof node.type !== 'string') return
  const next = componentNameOf(node) || comp
  visit(node, next)
  for (const key of Object.keys(node)) {
    if (key === 'loc') continue
    const val = node[key]
    if (Array.isArray(val)) {
      for (const child of val) walk(child, next, visit)
    } else if (val && typeof val.type === 'string') {
      walk(val, next, visit)
    }
  }
}
