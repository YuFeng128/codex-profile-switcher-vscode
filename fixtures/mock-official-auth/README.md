# Mock Official Auth Fixtures

这些文件是给本项目做切换/恢复测试用的模拟夹具，不是 OpenAI 官方承诺的真实 `auth.json` schema。

用途：

- 验证插件能否识别 `model_provider = "openai"` 与 `openai_base_url`
- 验证插件能否在切换前保存“官方快照”
- 验证插件能否恢复整份 `config.toml` 和 `auth.json`
- 验证旧式 `requires_openai_auth = true` 自定义 provider 的迁移路径

注意：

- `builtin-openai-chatgpt` 和 `builtin-openai-access-token` 下的 `auth.json` 是“测试用模拟内容”。
- 真实环境里，官方登录态也可能保存在系统 keyring/keychain，不一定只在 `auth.json`。
- 当前插件对 ChatGPT / Access Token 的识别主要依赖 `codex login status`，不是依赖这里的 JSON 字段。

目录说明：

- `builtin-openai-apikey`
  - 内建 `openai` provider，使用 API Key。
- `builtin-openai-chatgpt`
  - 内建 `openai` provider，模拟 ChatGPT 登录态。
- `implicit-openai-chatgpt`
  - `config.toml` 中没有 `model_provider` 和 `openai_base_url`，依赖 Codex 内置默认 OpenAI provider，并通过 `auth.json` 中的账号 token 字段识别官方登录态。
- `builtin-openai-access-token`
  - 内建 `openai` provider，模拟 Access Token 登录态。
- `custom-openai-auth-legacy`
  - 自定义 provider + `requires_openai_auth = true`，用于测试迁移到内建 `openai`。
