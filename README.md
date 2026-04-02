<p align="center">
  <img src="./media/icon.svg" alt="Codex Profile Switcher" width="72" />
</p>

<h1 align="center">Codex Profile Switcher VS Code</h1>

<p align="center">
  一个专门给 <strong>VS Code 插件版 Codex</strong> 用的 API 切换工具。<br />
  用来在侧边栏里快速切换 <code>base_url</code> 和 <code>API Key</code>，尽量减少手动改配置的成本。
</p>

<p align="center">
  <img src="https://img.shields.io/badge/VS%20Code-Extension-2F6FEB?style=flat-square&logo=visualstudiocode&logoColor=white" alt="VS Code Extension" />
  <img src="https://img.shields.io/badge/Release-v1.0.0-6C8C6B?style=flat-square&logo=github&logoColor=white" alt="Release v1.0.0" />
  <img src="https://img.shields.io/badge/License-MIT-4B5563?style=flat-square" alt="MIT License" />
  <img src="https://img.shields.io/badge/Platform-Windows-0078D4?style=flat-square&logo=windows&logoColor=white" alt="Windows" />
</p>

<p align="center">
  <a href="https://github.com/YuFeng128/codex-profile-switcher-vscode/releases/tag/v1.0.0">下载 VSIX 安装包</a>
</p>

---

## <img src="https://img.shields.io/badge/Preview-效果图-BFAF7A?style=flat-square" alt="Preview" />

<p align="center">
  <img src="./resource/show.png" alt="Codex Profile Switcher Screenshot" width="420" />
</p>

---

## <img src="https://img.shields.io/badge/What%20It%20Does-核心能力-7A8F6A?style=flat-square" alt="Core Features" />

<table>
  <tr>
    <td width="50%">
      <strong>侧边栏切换</strong><br />
      直接在 VS Code 侧边栏维护多组 Codex API 配置，不需要来回改文件。
    </td>
    <td width="50%">
      <strong>仅修改关键项</strong><br />
      切换时只改当前激活 provider 的 <code>base_url</code> 和 <code>OPENAI_API_KEY</code>。
    </td>
  </tr>
  <tr>
    <td width="50%">
      <strong>当前配置名称可见</strong><br />
      可以显示当前生效配置名称，减少“现在到底用的是哪条线路”的混乱。
    </td>
    <td width="50%">
      <strong>API Key 显示/隐藏</strong><br />
      输入框自带眼睛按钮，可切换明文与隐藏状态，方便核对。
    </td>
  </tr>
  <tr>
    <td width="50%">
      <strong>自动备份</strong><br />
      切换前自动备份旧的 Codex 配置文件，避免误改后无法回退。
    </td>
    <td width="50%">
      <strong>自动重载窗口</strong><br />
      切换后自动重载 VS Code 窗口，让新配置尽快生效。
    </td>
  </tr>
</table>

---

## <img src="https://img.shields.io/badge/Install-安装方式-5D7D7A?style=flat-square" alt="Install" />

### 方式一：直接安装 VSIX

1. 打开 [Releases](https://github.com/YuFeng128/codex-profile-switcher-vscode/releases/tag/v1.0.0)
2. 下载 `codex-profile-switcher-1.0.0.vsix`
3. 在 VS Code 中执行 `Extensions: Install from VSIX...`
4. 选择下载好的 `.vsix` 文件

### 方式二：本地开发运行

```powershell
cd .\vscode-extension
npm install
npm run compile
```

然后用 VS Code 打开 `vscode-extension` 目录，按 `F5` 启动扩展开发宿主。

---

## <img src="https://img.shields.io/badge/How%20to%20Use-使用流程-8A7A6A?style=flat-square" alt="Usage" />

1. 在侧边栏点击 `Codex`
2. 填写 `显示名称`、`API Base URL`、`API Key`
3. 点击 `新增为新配置`
4. 在左侧列表选择目标配置
5. 点击 `切换选中配置`
6. 插件会自动重载 VS Code 窗口

---

## <img src="https://img.shields.io/badge/Behavior-切换规则-6B7280?style=flat-square" alt="Behavior" />

这个插件当前的切换策略很克制：

- 会读取当前激活的 `model_provider`
- 只更新该 provider 下的 `base_url`
- 同时更新 `C:\Users\Administrator\.codex\auth.json` 中的 `OPENAI_API_KEY`
- 不会修改 `model`、`wire_api`、`service_tier`、`model_provider` 等其它配置

---

## <img src="https://img.shields.io/badge/Storage-数据存放-6E8B74?style=flat-square" alt="Storage" />

- 配置列表：保存在扩展的 `globalState`
- 备份文件：保存在扩展的 `globalStorage/backups`
- 生效目标：
  - `C:\Users\Administrator\.codex\config.toml`
  - `C:\Users\Administrator\.codex\auth.json`

---

## <img src="https://img.shields.io/badge/Scope-说明-7C6F64?style=flat-square" alt="Notes" />

- 这个仓库主要针对 **插件版 Codex** 的切换体验
- 当前实现重点是 **无感切换线路**，不是完整的账号系统管理器
- 如果你希望做多账号、多环境或多 Profile 管理，可以在这个基础上继续扩展

---

## <img src="https://img.shields.io/badge/License-MIT-4B5563?style=flat-square" alt="License" />

本项目基于 [MIT License](./LICENSE) 开源。
