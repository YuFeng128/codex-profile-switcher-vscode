# Codex Profile Switcher VS Code

在 VS Code 侧边栏里切换 Codex 的 API 配置，不用手动反复改 `~/.codex/config.toml` 和 `~/.codex/auth.json`。

![VS Code Extension](https://img.shields.io/badge/VS%20Code-Extension-2F6FEB?style=flat-square&logo=visualstudiocode&logoColor=white)
![Release v1.0.3](https://img.shields.io/badge/Release-v1.0.3-6C8C6B?style=flat-square&logo=github&logoColor=white)
![MIT License](https://img.shields.io/badge/License-MIT-4B5563?style=flat-square)
![Windows](https://img.shields.io/badge/Platform-Windows-0078D4?style=flat-square&logo=windows&logoColor=white)

下载地址:

- 本地构建产物：`codex-profile-switcher-1.0.3.vsix`

## 交流群

- AI 技术交流群 QQ：`1060173874`

<p align="center">
  <img src="./resource/community-qq.png" alt="AI 技术交流群 QQ 群" width="300" />
  <img src="./resource/community-wechat.png" alt="AI 技术交流群微信群" width="300" />
</p>

预览:

<p align="center">
  <img src="./resource/show.png" alt="Codex Profile Switcher Screenshot" width="420" />
</p>

## 功能

- 在侧边栏保存多套 Codex API 配置并快速切换
- 支持两种线路：
  - 官方线路地址：适合大多数代理地址，聊天记录更不容易分散
  - 独立线路配置：适合必须使用单独线路标识的服务
- 每套普通配置使用自己的 API Key，切换时会同步切换 Key
- 自动识别当前登录状态（API Key / OpenAI 账号 / 访问令牌 / 未知）
- 支持识别 `config.toml` 中未显式配置 provider、但 `auth.json` 中存在官方账号 token 的内置 OpenAI 默认场景
- 如果当前是官方账号或官方线路，切换前自动保存一份“原有账号备份”，后续可以通过切换这个配置回到原来的号
- 高级设置里支持快速响应、表达风格和旧版登录偏好
- 显示当前生效的配置、线路类型、登录状态、服务地址
- 支持 API Key 明文显示/隐藏
- 切换前自动备份配置文件
- 切换完成后自动重载 VS Code 窗口

## 安装

### 方式一：安装 VSIX

1. 使用本地生成的 `codex-profile-switcher-1.0.3.vsix`
2. 或从 Releases 下载对应版本的 VSIX
3. 在 VS Code 中执行 `Extensions: Install from VSIX...`
4. 选择下载好的 `.vsix` 文件

### 方式二：本地开发

```powershell
cd .\
npm install
npm run compile
```

然后用 VS Code 打开当前项目目录，按 `F5` 启动扩展开发宿主。

## 使用

1. 在侧边栏点击 `Codex`
2. 选择线路类型：
   - `官方线路地址`
   - `独立线路配置`
3. 填写 `显示名称`、`服务地址`
4. 按需填写 `线路标识`、`API Key`
5. 需要时展开 `高级设置`，开启快速响应、选择表达风格或旧版登录偏好
6. 点击 `新增为新配置` 或 `保存修改`
7. 在左侧列表选择目标配置
8. 点击 `切换选中配置`
9. 扩展会自动重载 VS Code 窗口

## 切换规则

- 如果配置模式是 `内建 OpenAI`：
  - 写入 `model_provider = "openai"`
  - 写入 `openai_base_url`
- 如果配置模式是 `自定义 Provider`：
  - 写入 `model_provider = <providerId>`
  - 删除其它 `[model_providers.*]` 段，仅保留目标 `[model_providers.<providerId>]`
- 根据勾选状态写入顶层 `service_tier = "fast"` 或 `service_tier = "default"`
- 普通配置切换时，会更新 `auth.json` 中的 `OPENAI_API_KEY`
- 表达风格会写入顶层 `personality`，可选值参考官方 Codex 配置：`none`、`friendly`、`pragmatic`
- 当前如果是内建 OpenAI 或 `requires_openai_auth = true` 的 provider，切换前自动保存“原有账号备份”
- 选择“原有账号备份”配置时，会直接恢复保存时的 `config.toml` 与 `auth.json`

## 数据存储

- 配置列表保存在扩展的 `globalState`
- 备份文件保存在扩展的 `globalStorage/backups`
- 生效文件:
  - `C:\Users\Administrator\.codex\config.toml`
  - `C:\Users\Administrator\.codex\auth.json`

## 更新日志

- [CHANGELOG.md](./CHANGELOG.md)

## License

[MIT](./LICENSE)
