# 仓库指南

## 项目结构与模块组织

本仓库用于维护小型 HTML 工具。每个工具html、css、js 都放在同一个目录下，并能方便地在本地浏览器中打开。页面入口可以放在仓库根目录，也可以放在清晰命名的功能目录中，例如 `json-formatter/index.html` 或 `image-tools/index.html`。共享的 JavaScript、CSS 和静态资源建议放在 `js/`、`css/`、`assets/` 等目录中；如果资源只服务于单个工具，也可以放在对应工具目录内。不要把生成文件和源码混在一起，如需生成输出，请在相关目录中说明位置。

## 构建、测试与开发命令

全部工具都能通过直接打开对应 `.html` 文件运行。

## 编码风格与命名约定

HTML、CSS 和 JavaScript 使用 2 个空格缩进。优先使用语义化 HTML、原生 CSS 和浏览器内置 API；除非现有工具已使用框架，否则不要新增复杂框架依赖。文件和目录使用小写 kebab-case，例如 `color-picker.html` 或 `text-diff/`。JavaScript 变量和函数使用 `camelCase`，类或组件构造器使用 `PascalCase`。CSS 类名应具备足够语义，避免不同工具之间发生样式冲突。

## 测试指南

对于简单的纯浏览器工具，至少在当前 Chrome 或 Edge 中手动验证，并检查桌面与移动端宽度下的响应式表现。新增自动化测试时，可将测试放在代码附近或统一放入 `tests/` 目录，命名示例为 `tool-name.test.js`。解析、转换、校验等核心逻辑应尽量与 DOM 交互分开测试。

## 提交与 Pull Request 规范

提交信息使用简短的祈使句，例如 `Add CSV preview tool` 或 `Fix color conversion rounding`。不同工具的无关修改尽量拆分为独立提交。Pull Request 应包含简要说明、测试记录、相关 issue 链接；涉及界面变化时，应提供截图或简短录屏。新增依赖、生成资源或浏览器兼容性注意事项也应在 PR 中说明。

## Agent 专用说明

修改范围应尽量限制在用户请求的工具或共享辅助代码内。保留现有工具可直接打开 HTML 文件运行的工作方式。编辑共享文件前，先确认哪些工具依赖它们，避免破坏其他工具。

## PowerShell UTF-8 编码处理

本项目文件为 UTF-8 无 BOM，PowerShell 默认是GBK编码， 使用时需指定编码，否则中文会乱码：

