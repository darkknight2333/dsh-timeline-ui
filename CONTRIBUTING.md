# 参与改进 / Contributing

感谢你使用和改进 dsh-timeline-ui。问题与建议请在 [Issues](https://github.com/darkknight2333/dsh-timeline-ui/issues) 提交。

## 报告问题与建议

- Bug：注明 DSH 版本、插件版本、系统、操作步骤，以及预期和实际结果。
- 功能建议：说明你要解决的使用问题和期望行为。
- 截图与日志请移除账号、Token、绝对路径和私人会话内容。不要上传整个 profile 或会话目录。

## 本地开发

使用 Node.js 22 或 24。项目没有第三方依赖，无需安装依赖即可构建和测试。

1. Fork 仓库，克隆自己的副本，并创建功能分支。
2. 修改 `src/client.js`；`lib/` 是由构建生成的安装产物，不要直接修改。
3. 运行 `npm run verify`，确认构建与全部离线测试通过。
4. 提交源码与更新后的 `lib/`；修改行为时同步更新文档和必要测试。
5. 推送分支，向本仓库提交 Pull Request，说明问题、改动和验证结果。

CI 在 Windows/Linux 的 Node.js 22/24 上检查构建、离线测试、构建产物同步及打包清单。它不启动 DSH，不能替代真实界面验证。界面改动请按 [验证清单](docs/VERIFICATION.md) 检查点击跳转、悬停/移出、滚动、缩放、主题与停用清理，并说明实际验证过的 DSH 版本和系统。

## 发布维护

维护者发布新版时更新 `package.json` 的版本和 `CHANGELOG.md`，构建测试并生成对应的 npm tarball，再创建新的版本 tag 和 GitHub Release。已发布的 tag 不应移动；修复应使用新版本。

## English

Use Node.js 22 or 24. No dependency installation is required. Edit `src/client.js`, run `npm run verify`, and commit both source changes and regenerated `lib/` files. Open a pull request with the problem, change, and validation results. CI checks Windows/Linux builds and offline tests; it does not establish DSH runtime compatibility. Follow the manual verification checklist for UI changes, and redact private information from screenshots and logs.
