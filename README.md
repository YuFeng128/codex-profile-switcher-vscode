# Codex Profile Switcher VS Code 扩展版

这是独立桌面版之外的一个 VS Code 扩展版本，功能保持一致：

- 在 VS Code 侧边栏维护多组 Codex API 配置
- 切换时只修改当前激活 provider 的 `base_url`
- 同时更新 `C:\Users\Administrator\.codex\auth.json` 里的 `OPENAI_API_KEY`
- 切换前自动备份旧配置
- 切换后自动重载 VS Code 窗口

## 运行

```powershell
cd .\vscode-extension
npm install
npm run compile
```

然后用 VS Code 打开 `vscode-extension` 目录，按 `F5` 启动扩展开发宿主。

## 使用

1. 在侧边栏点击 `Codex`
2. 填入 `显示名称`、`API Base URL`、`API Key`
3. 点 `新增为新配置`
4. 选中一条配置后点 `切换选中配置`
5. 扩展会自动重载 VS Code

## 说明

- 配置列表保存在扩展的 `globalState`
- 备份文件保存在扩展的 `globalStorage/backups`
- 当前版本不会修改 `model_provider`、`model`、`wire_api`、`service_tier` 等其它配置
