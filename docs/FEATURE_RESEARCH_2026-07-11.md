# ChangeHere 功能完善与行业调研

> 调研日期：2026-07-11
> 范围：当前仓库实现、同类开源工具、浏览器 Agent/MCP 工具与相关安全规范。

> **审计修订**：后续核查确认，平台内置浏览器选择器与 React Grab 已覆盖“点选→agent”及多选/视觉编辑，原文将通用协议化、多选和页面级验收排得过早。当前主线调整为：安全热修 → 源码锚定微轨迹 → 动态 bug 对照实验 → CLI/SKILL → trace step 反向高亮。下文保留初版分析，便于追踪判断变化。

## 1. 结论

ChangeHere 已经形成了一个清晰且有差异化的闭环：**页面元素 → 源码上下文 → coding agent → 源码位置反向高亮**。下一阶段不建议直接扩成完整浏览器自动化或完整 IDE；Playwright MCP、Chrome DevTools MCP 和 stagewise 已经覆盖这条重资产路线。更适合的定位是：

> 面向 coding agent 的、轻量且确定性的“页面—源码上下文协议层”。

最值得优先投入的不是更多采集项，而是让现有闭环变得安全、结构化、可路由、可验证：

1. 先补 bridge 安全、测试矩阵和会话隔离。
2. 把 Markdown 单体升级为结构化 selection 数据，并把截图作为 MCP image/resource 返回。
3. 增加多选与“修改意图”就地录入，减少复制后人工补充。
4. 增加修改前后快照/差异验证，形成真正的 agent 验收闭环。
5. 再扩展 Next.js/Webpack 等适配器；完整浏览器调试能力优先与现有工具协作，不重复建设。

## 2. 当前能力盘点

| 能力 | 当前实现 | 代码证据 |
| --- | --- | --- |
| JSX 源码标记 | Vite dev 阶段为原生 JSX 元素注入组件名、文件、行列 | `packages/vite-plugin-changehere/src/index.js:10-54` |
| 元素选择 | 悬停高亮、点击复制、父子层级键盘导航 | `extension/content.js` |
| 上下文采集 | 源码位置、DOM 路径、组件链、计算样式、React props、尺寸、文本 | `extension/content.js:223-430` |
| 生产页降级 | 输出文本、稳定属性、语义类名与祖先锚点供 grep | `extension/content.js:292-339` |
| 截图 | Alt+点击后裁剪可见区域并下载到本机 | `extension/background.js:43-89` |
| 反向定位 | 粘贴或由 MCP 推送 `file:line`，页面高亮；行号漂移时退化为文件匹配 | `extension/content.js:433-555` |
| MCP 直连 | `get_selection` 与 `highlight` 两个工具 | `packages/changehere-mcp/server.js:107-150` |

已有设计中值得保留的部分：dev-only 插桩、生产页可降级、普通使用不强制截图、行号漂移容错、bridge 不可用时剪贴板流程仍可工作。这些都符合“低侵入、渐进增强”的产品方向。

## 3. 行业对照

| 产品/项目 | 已验证的代表能力 | 对 ChangeHere 的启发 |
| --- | --- | --- |
| [React Grab](https://github.com/aidenybai/react-grab) | 复制元素及组件源码栈；覆盖 Next.js、Vite、Webpack；提供插件 API、上下文菜单和工具栏扩展点 | 安装范围与扩展机制比 ChangeHere 成熟；但其核心仍偏“复制上下文”，ChangeHere 可用反向高亮和验证闭环形成差异化 |
| [stagewise DOM context selector](https://docs.stagewise.io/reference/dom-context-selector) | 在内置浏览器选元素，将 HTML、CSS、位置直接附加给 agent；产品同时覆盖多工作区、插件与设计集成 | 用户不应在选择后再手工拼上下文；“选中即成为一条可引用的 agent 上下文”是更顺滑的交互 |
| [LocatorJS](https://www.locatorjs.com/) | 浏览器扩展或库两种形态；点击打开 IDE；覆盖 React、Preact、Solid、Vue、Svelte；React 支持插桩和 DevTools 两条路线 | 应把“核心 selection 协议”与“框架定位适配器”拆开，并补 IDE deep link |
| [Playwright MCP](https://github.com/microsoft/playwright-mcp) | 结构化 accessibility snapshot、确定性浏览器操作、locator 生成、断言、trace/video；官方也指出 CLI/skills 对 coding agent 往往更节省 token | MCP 工具应少而清晰、输出结构化且可分页；可增加 locator/断言生成，但不必复制整套自动化能力 |
| [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp) | console、带 source map 的错误、network、截图/页面快照、性能 trace、Lighthouse、heap snapshot | console/network/performance 应优先做可选联动或输出关联 ID，不宜在本项目重建完整 DevTools |
| [BrowserTools MCP](https://github.com/AgentDeskAI/browser-tools-mcp) | console/network/截图/DOM、自动重连、token 截断、cookie/敏感 header 清理、组合审计模式 | 数据清洗、配额和连接恢复值得借鉴；其 README 已明确项目停止维护，也说明三组件重架构的维护成本很高 |

行业信号很一致：**更丰富的浏览器数据并不是最稀缺能力，准确路由、低 token 消耗、隐私边界和自动验收才是。**

## 4. 需要先修的基础项（P0）

### P0-1 Bridge 安全与隐私

当前 bridge 对所有响应返回 `Access-Control-Allow-Origin: *`，OPTIONS 也允许任意来源，并且没有配对 token、Host/Origin 校验或请求体上限（`packages/changehere-mcp/server.js:23-49`）。这意味着任意网页都有机会尝试访问本机端口；props 又可能包含业务数据。

建议：

- 首次启动生成随机 pairing token，由扩展保存并随请求发送。
- 严格校验 `Host` 和 `Origin`，仅允许扩展 origin 与明确的 localhost 页面；移除 wildcard CORS。
- 为请求体、字段长度、记录数和截图大小设置硬上限；超限立即断开。
- 增加可配置的 props/属性脱敏规则，默认遮盖 token、authorization、cookie、password、secret、email 等字段。
- 生产页默认不读取 props，改为一次性显式授权。

MCP 官方传输规范要求 HTTP 服务校验 `Origin` 以防 DNS rebinding、仅监听 loopback，并建议鉴权；可参考 [MCP transport security warning](https://modelcontextprotocol.io/specification/2024-11-05/basic/transports)。Chrome 扩展文档也要求后台跨域代理限制可请求的资源，避免网页滥用扩展权限，见 [Chrome cross-origin network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)。

### P0-2 自动化测试与兼容矩阵

根 `package.json` 没有 scripts，仓库内没有项目测试。当前最脆弱的三处恰好都依赖运行时细节：Babel AST 插桩、React fiber 私有字段、截图坐标与浏览器权限。

建议至少建立：

- 插桩单测：TS/JS、class/function/arrow、memo/forwardRef、spread props、已有 `data-ch`、Windows 路径、语法错误。
- 浏览器 E2E：React 18/19 × Vite 主版本，覆盖选取、复制、截图、反向定位、HMR 后定位。
- MCP contract test：tools/list、结构化返回、bridge 断线、双实例、过期消息。
- GitHub Actions 矩阵与最小 fixture 项目。

### P0-3 项目/标签页/Agent 会话隔离

现在所有 tab 共享一个选区队列，高亮命令广播给所有轮询页面；`get_selection` 只能返回全局最新一条。多项目、多窗口或多个 agent 同时工作时会取错对象。

建议每条记录携带 `projectId`、`tabId`、`pageId`、`sessionId`、`selectionId`、`createdAt`，扩展向 bridge 注册心跳。MCP 增加 `list_pages`、`list_selections`、`get_selection(id)`，高亮必须指定目标 page/session；只有单页面时才能自动省略。

## 5. 核心产品增强（P1）

### P1-1 结构化 selection 协议

当前扩展只把 Markdown 和 URL 推给 bridge（`extension/content.js:209-218`），MCP 又只返回文本（`packages/changehere-mcp/server.js:113-125`）。建议内部以 versioned JSON 为事实来源，Markdown 只做一种 renderer：

```json
{
  "schemaVersion": 1,
  "selectionId": "sel_...",
  "page": { "url": "...", "viewport": {} },
  "source": { "file": "src/App.tsx", "line": 12, "column": 5, "component": "App" },
  "element": { "tag": "button", "text": "提交", "rect": {}, "locator": {} },
  "accessibility": { "role": "button", "name": "提交", "states": {} },
  "styles": {},
  "props": {},
  "artifacts": []
}
```

收益：agent 不用重新解析 Markdown；字段可按需返回以节省 token；第三方可写 renderer/plugin；后续 schema 可演进。

### P1-2 截图作为 artifact，而不是仅提供下载路径

本机绝对路径对远程容器、SSH、Codespaces 或不同用户运行的 agent 不可见。建议截图保存在 bridge 的受限临时目录，并由 MCP 以 image content 或 resource URI 返回；同时保留“下载到本机”作为可选操作。

artifact 至少支持：元素裁剪图、带上下文裁剪图、当前 viewport；记录 DPR、zoom、scroll 和媒体查询。避免默认全页截图，以控制隐私与 token/文件体积。

### P1-3 多选、标注与就地填写意图

增加 Shift+点击多选；每个选区可添加短备注，例如“这三个卡片间距统一”“只改移动端”。一次提交形成 selection group。它比继续堆更多自动采集字段更能提升任务成功率，因为“想改什么”仍是当前 Markdown 中的空占位。

建议交互：

- 点击：单选并提交；Shift+点击：加入/移出集合。
- 浮层显示已选数量、取消、备注输入、复制/发送。
- 每个 selection 可有 label，group 有总 intent。
- MCP 可按 group 读取，避免 agent 错把多次点击当成不同任务。

### P1-4 修改前后验证闭环

新增 `capture_baseline(selectionId)` 与 `compare_after(selectionId)`：保存元素 DOM/可访问性/尺寸/关键样式/截图摘要，HMR 后重新定位并返回差异。首版不需要做通用像素级测试平台，只需回答：

- 元素是否仍存在、是否可见、尺寸和位置是否异常变化；
- accessible name/role 是否改变；
- 关键 computed style 是否达到目标；
- 截图差异区域与变化比例；
- console 是否新增 error（可选联动 DevTools）。

这会把现有的“高亮给用户看”升级为“agent 能自证改动结果”，也是最有价值的差异化方向。

### P1-5 无障碍语义与测试 locator

在现有文本、属性、CSS path 之外增加 role、accessible name、disabled/checked/expanded 等状态，并生成 Playwright 推荐 locator 候选。这样同一条 selection 既能指导改代码，也能生成回归测试；结构化可访问性快照也是 Playwright MCP 的核心取舍。

## 6. 生态扩展（P2）

### P2-1 框架适配器

按优先级建议：

1. Next.js（SWC/Turbopack/Webpack）—— React 用户增量最大。
2. 通用 Babel/Webpack 插件——复用当前 JSX 插桩逻辑。
3. Preact。
4. Vue/Svelte/Solid——需要独立编译器适配，不应塞进现有 Vite React 插件。

架构上拆成 `@changehere/protocol`、`@changehere/runtime`、`@changehere/vite-react`、`@changehere/next` 等包。LocatorJS 的多框架与“双定位路线”证明了这种拆分的可行性。

### P2-2 IDE deep link

增加“在编辑器打开”动作，支持 VS Code、Cursor、WebStorm/IDEA 的可配置 URL scheme 或命令模板。它不是主要卖点，但成本低、日常使用频率高，并能覆盖不使用 agent 的传统定位场景。

### P2-3 Shadow DOM、iframe 与 Portal

优先 Shadow DOM，其次同源 iframe，再评估跨域 frame。需要把 page/frame 标识纳入 selection schema 后再做，否则消息路由会继续复杂化。React Portal 应在组件链与 DOM 链中分别表示，避免二者混为一谈。

### P2-4 插件与输出模板

参考 React Grab 的 plugin actions/hooks，提供有限但稳定的扩展点：`onSelect`、`enrichSelection`、`renderOutput`、toolbar/context-menu action。可由团队插件添加设计 token、内部组件库文档链接、埋点信息或自定义脱敏规则。

## 7. 暂不建议自行建设（P3/集成优先）

- 完整浏览器点击、输入、导航自动化：交给 Playwright。
- 完整 console/network/performance/heap 工具面：交给 Chrome DevTools MCP。
- Lighthouse 全量审计：可提供一键联动或 recipes，不在 ChangeHere 内复制。
- 内置通用 coding agent、模型账户和 Git 工作流：会把产品推向 stagewise 所在的重型 IDE 赛道。
- 云端选区同步和团队协作：在本地协议、脱敏与权限模型稳定前不做。

推荐提供 `capabilities`/`status` 输出，告诉 agent 当前是否存在 Playwright 或 Chrome DevTools 能力，并在任务需要时给出协同提示。ChangeHere 的价值是把“用户指的页面对象”和其他工具对齐，而不是替代其他工具。

## 8. 建议路线图

| 阶段 | 周期参考 | 交付目标 | 成功指标 |
| --- | --- | --- | --- |
| M0 地基 | 1–2 周 | token 配对、Host/Origin 校验、请求限额、脱敏、测试/CI | 安全测试通过；核心 E2E 稳定；React 18/19 fixture 通过 |
| M1 协议化 | 2 周 | selection v1 JSON、ID/history、page/session 路由、截图 artifact | 多 tab 不串线；agent 无需解析 Markdown；远程环境可读取图片 |
| M2 交互升级 | 2–3 周 | 多选、备注、selection group、无障碍语义、locator | 多元素任务可一次表达；生成的 locator 可直接用于测试 |
| M3 验收闭环 | 3–4 周 | baseline/compare、HMR 后重定位、关键差异报告 | agent 能自动判断目标元素是否达到预期；误报率可量化 |
| M4 生态 | 持续 | Next.js/Webpack、IDE deep link、插件 API、Shadow DOM | 非 Vite React 项目采用率提升；第三方 enrichers 可独立发布 |

## 9. 推荐优先级总表

| 功能 | 用户价值 | 实现成本 | 风险 | 优先级 |
| --- | --- | --- | --- | --- |
| bridge 安全、脱敏、限额 | 极高 | 中 | 低 | P0 |
| 测试/CI/fixture 矩阵 | 极高 | 中 | 低 | P0 |
| page/session 路由 | 极高 | 中 | 中 | P0 |
| 结构化 selection + history | 极高 | 中 | 中 | P1 |
| MCP 图片 artifact | 高 | 中 | 中 | P1 |
| 多选 + 就地备注 | 高 | 中 | 低 | P1 |
| baseline/after 差异验证 | 极高 | 高 | 中 | P1 |
| accessibility + locator | 高 | 中 | 低 | P1 |
| Next.js/Webpack 适配 | 高 | 高 | 中 | P2 |
| IDE deep link | 中 | 低 | 低 | P2 |
| Shadow DOM/iframe | 中 | 高 | 高 | P2 |
| console/network/Lighthouse 全量自研 | 中 | 极高 | 高 | P3，集成优先 |

## 10. 仍需产品决策的问题

1. 核心用户更偏“个人开发者的轻量剪贴板工具”，还是“团队可扩展的 agent 上下文协议”？后者需要更早稳定 schema 和插件 API。
2. 是否坚持完全本地？如果答案是肯定的，应把“默认不出机、可审计、可脱敏”写入产品承诺和测试标准。
3. 首个框架扩展是否确认 Next.js？若目标用户以 Vite 内部项目为主，也可以先把 M0–M3 做深，推迟多框架。
4. 是否愿意依赖 Chrome DevTools Protocol？它能快速补 console/network，但会显著提高权限、兼容与维护成本。
