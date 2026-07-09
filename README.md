# 改这里 ChangeHere

在本地 vite + react dev 页面上鼠标选取元素，把「源码位置 + 组件链 + DOM 信息」以 markdown 复制到剪贴板，直接粘贴给 coding agent —— 指着页面说「改这里」。

两件套：

| 部分 | 作用 |
|------|------|
| `packages/vite-plugin-changehere` | dev 编译时给每个 JSX 原生元素注入 `data-ch="组件名@文件:行:列"`（React 18/19 通用，build 不生效） |
| `extension/` | Chrome MV3 插件：选取模式高亮元素，点击后组装 markdown 复制到剪贴板 |

## 安装

### 1. vite 插件（在你的目标项目里）

```bash
npm i -D vite-plugin-changehere   # 或先用本地路径: file:../fe-bridge/packages/vite-plugin-changehere
```

```js
// vite.config.js
import changeHere from 'vite-plugin-changehere'

export default defineConfig({
  plugins: [changeHere(), react()],  // 放在 react() 之前
})
```

### 2. Chrome 插件

1. 打开 `chrome://extensions`，开启右上角「开发者模式」
2. 「加载已解压的扩展程序」→ 选择本仓库的 `extension/` 目录

## 使用

### 选取模式（页面 → agent）

1. 打开本地 dev 页面（`http://localhost:*`）
2. 点击工具栏「改这里」图标（或 `Alt+Shift+E`）进入选取模式
3. 鼠标悬停高亮 + 显示 `<组件> 文件:行`，点击即复制、自动退出；`Esc` 取消
4. **Alt+点击** 额外把元素截图存到 `下载目录/changehere/` 并在 markdown 里附路径（普通点击不截图、不触发下载）

> 截图走浏览器下载。如果 Chrome 开了「下载前询问每个文件的保存位置」，Alt+点击会弹另存为；想静默保存就在 `chrome://settings/downloads` 关掉该选项。

复制内容示例：

````markdown
## 前端元素修改请求

**页面**: http://localhost:5173/
**源码位置**: src/components/Card.jsx:3:5（组件 <Card>）
**组件链**: Card (src/components/Card.jsx:3) ← App (src/App.jsx:5)
**元素**: `<button>` `div > section.card > button.btn.primary`
**文本**: 提交
**尺寸**: 120×36
**当前样式**: `display: inline-block; padding: 1px 6px; background-color: rgb(239, 239, 239); color: rgb(0, 0, 0); font-size: 13.33px`
**组件 props**（<Card>）:
```json
{ "title": "第一张卡片", "children": "<jsx/>" }
```
**截图**: /Users/you/Downloads/changehere/ch-20260709-2231.png

**修改意图**: （在此填写你想怎么改）
````

- **当前样式 / 组件 props**：agent 看不到浏览器，这两项补上「现状」——props 由 MAIN world 脚本从 React fiber 读取
- **截图**：元素区域自动裁剪存到 `下载目录/changehere/`，markdown 里带绝对路径，Claude Code 等 agent 可直接读图

### 生产页面（无 vite 插件也能用）

在任意站点（自家产品线上版等）点击扩展图标即可选取——`activeTab` 授权按需注入，无需预先配置。拿不到 `data-ch` 时自动降级为**检索线索**模式，输出 agent 能在源码里 grep 到的稳定锚点：

- 元素直接文本、`id`、`data-testid` / `aria-label` 等属性
- 类名（自动滤除 `css-1x2y3z` 这类 CSS-in-JS 哈希类，保留 Tailwind / 语义类）
- 最近的带 `data-testid` / `id` 的祖先
- React 组件 props（生产构建里 props 的 key 不会被压缩，是最强定位线索；组件名被压缩时会标注）

注意：非 localhost 页面首次使用必须**点图标**（快捷键不授予 activeTab）。

### 反向定位（agent → 页面）

agent 改完代码后验收用：按 `Alt+Shift+L`，粘贴源码位置（`src/App.jsx:9`，整行 markdown 也行，只给文件名则匹配整个文件），`Enter` 后页面上所有来自该行的元素粉色脉冲高亮并滚动到第一个。`Esc` 关闭。

## 本地开发

```bash
npm install        # 根目录，workspaces 一起装
cd example && npm run dev   # React 19 playground
```
