import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

type CurrentState = {
  profileName: string;
  providerName: string;
  baseUrl: string;
  apiKey: string;
};

type Profile = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
};

const PROFILE_KEY = "codexProfileSwitcher.profiles";

class CodexConfigManager {
  private readonly configPath = path.join(os.homedir(), ".codex", "config.toml");
  private readonly authPath = path.join(os.homedir(), ".codex", "auth.json");

  constructor(private readonly backupDir: string) {}

  async readCurrentState(): Promise<CurrentState> {
    const result: CurrentState = {
      profileName: "",
      providerName: "",
      baseUrl: "",
      apiKey: "",
    };

    const configText = await fs.readFile(this.configPath, "utf8");
    const providerNameMatch = configText.match(/^\s*model_provider\s*=\s*"([^"]+)"/m);
    const providerName = providerNameMatch?.[1] ?? "";
    result.providerName = providerName;
    if (providerName) {
      result.baseUrl = readStringValueFromSection(configText, `model_providers.${providerName}`, "base_url");
    }

    try {
      const authText = await fs.readFile(this.authPath, "utf8");
      const authData = JSON.parse(authText) as Record<string, unknown>;
      result.apiKey = String(authData.OPENAI_API_KEY ?? "");
    } catch {
      result.apiKey = "";
    }

    return result;
  }

  async switchProfile(profile: Profile): Promise<void> {
    const current = await this.readCurrentState();
    if (!current.providerName) {
      throw new Error("当前 config.toml 中没有找到激活的 model_provider。");
    }

    await fs.mkdir(this.backupDir, { recursive: true });
    const timestamp = createTimestamp();
    await fs.copyFile(this.configPath, path.join(this.backupDir, `config-${timestamp}.toml`));
    try {
      await fs.copyFile(this.authPath, path.join(this.backupDir, `auth-${timestamp}.json`));
    } catch {
      // ignore missing auth.json
    }

    const configText = await fs.readFile(this.configPath, "utf8");
    const updatedConfig = updateProviderBaseUrl(configText, current.providerName, profile.baseUrl);
    await fs.writeFile(this.configPath, updatedConfig, "utf8");

    let authPayload: Record<string, unknown> = { auth_mode: "apikey" };
    try {
      const authText = await fs.readFile(this.authPath, "utf8");
      authPayload = JSON.parse(authText) as Record<string, unknown>;
    } catch {
      // keep default payload
    }
    authPayload.OPENAI_API_KEY = profile.apiKey;
    await fs.writeFile(this.authPath, JSON.stringify(authPayload, null, 2), "utf8");
  }
}

class CodexProfileViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "codexProfileSwitcher.view";

  private view?: vscode.WebviewView;
  private readonly configManager: CodexConfigManager;

  constructor(private readonly context: vscode.ExtensionContext) {
    const backupDir = path.join(context.globalStorageUri.fsPath, "backups");
    this.configManager = new CodexConfigManager(backupDir);
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void | Thenable<void> {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      try {
        await this.handleMessage(message);
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(text);
      }
    });
  }

  async refresh(): Promise<void> {
    if (!this.view) {
      return;
    }
    const profiles = this.loadProfiles();
    const current = await this.configManager.readCurrentState();
    current.profileName = this.resolveCurrentProfileName(current, profiles);
    await this.view.webview.postMessage({
      type: "state",
      profiles,
      current,
    });
  }

  private async handleMessage(message: { type: string; [key: string]: unknown }): Promise<void> {
    switch (message.type) {
      case "ready":
        await this.refresh();
        return;
      case "addProfile":
        await this.addProfile(message.profile);
        return;
      case "updateProfile":
        await this.updateProfile(message.id, message.profile);
        return;
      case "deleteProfile":
        await this.deleteProfile(message.id);
        return;
      case "switchProfile":
        await this.switchProfile(message.id);
        return;
      default:
        return;
    }
  }

  private loadProfiles(): Profile[] {
    return this.context.globalState.get<Profile[]>(PROFILE_KEY, []);
  }

  private resolveCurrentProfileName(current: CurrentState, profiles: Profile[]): string {
    const matched = profiles.find(
      (profile) => profile.baseUrl === current.baseUrl && profile.apiKey === current.apiKey,
    );
    return matched?.name ?? "";
  }

  private async saveProfiles(profiles: Profile[]): Promise<void> {
    await this.context.globalState.update(PROFILE_KEY, profiles);
  }

  private normalizeProfile(input: unknown, id?: string): Profile {
    const raw = (input ?? {}) as Record<string, unknown>;
    const profile: Profile = {
      id: id ?? createProfileId(),
      name: String(raw.name ?? "").trim(),
      baseUrl: String(raw.baseUrl ?? "").trim(),
      apiKey: String(raw.apiKey ?? "").trim(),
    };

    if (!profile.name) {
      throw new Error("显示名称不能为空。");
    }
    if (!profile.baseUrl.startsWith("http://") && !profile.baseUrl.startsWith("https://")) {
      throw new Error("API Base URL 必须以 http:// 或 https:// 开头。");
    }
    if (!profile.apiKey) {
      throw new Error("API Key 不能为空。");
    }

    return profile;
  }

  private async addProfile(input: unknown): Promise<void> {
    const profiles = this.loadProfiles();
    profiles.push(this.normalizeProfile(input));
    await this.saveProfiles(profiles);
    await this.refresh();
    void vscode.window.showInformationMessage("已新增配置。");
  }

  private async updateProfile(id: unknown, input: unknown): Promise<void> {
    if (typeof id !== "string" || !id) {
      throw new Error("请先在左侧选择一个配置，再保存修改。");
    }
    const profiles = this.loadProfiles();
    const index = profiles.findIndex((item) => item.id === id);
    if (index < 0) {
      throw new Error("当前选中的配置不存在。");
    }
    profiles[index] = this.normalizeProfile(input, id);
    await this.saveProfiles(profiles);
    await this.refresh();
    void vscode.window.showInformationMessage("已保存修改。");
  }

  private async deleteProfile(id: unknown): Promise<void> {
    if (typeof id !== "string" || !id) {
      throw new Error("请先选择一个配置。");
    }
    const profiles = this.loadProfiles();
    const profile = profiles.find((item) => item.id === id);
    if (!profile) {
      throw new Error("当前选中的配置不存在。");
    }
    const confirmed = await vscode.window.showWarningMessage(
      `确定删除配置“${profile.name}”吗？`,
      { modal: true },
      "删除",
    );
    if (confirmed !== "删除") {
      return;
    }
    await this.saveProfiles(profiles.filter((item) => item.id !== id));
    await this.refresh();
  }

  private async switchProfile(id: unknown): Promise<void> {
    if (typeof id !== "string" || !id) {
      throw new Error("请先选择一个配置。");
    }
    const profiles = this.loadProfiles();
    const profile = profiles.find((item) => item.id === id);
    if (!profile) {
      throw new Error("当前选中的配置不存在。");
    }

    const confirmed = await vscode.window.showWarningMessage(
      `切换到“${profile.name}”后将重载 VS Code 窗口。是否继续？`,
      { modal: true },
      "切换并重载",
    );
    if (confirmed !== "切换并重载") {
      return;
    }

    await this.configManager.switchProfile(profile);
    void vscode.window.showInformationMessage("Codex 配置已切换，VS Code 即将重载。");
    await vscode.commands.executeCommand("workbench.action.reloadWindow");
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "main.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "styles.css"));
    const nonce = createNonce();
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}">
  <title>Codex API 切换</title>
</head>
<body>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new CodexProfileViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(CodexProfileViewProvider.viewType, provider),
    vscode.commands.registerCommand("codexProfileSwitcher.refresh", async () => {
      await provider.refresh();
    }),
  );
}

export function deactivate(): void {}

function createProfileId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function createTimestamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
}

function createNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let index = 0; index < 16; index += 1) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function readStringValueFromSection(text: string, sectionName: string, key: string): string {
  const span = findSectionSpan(text, sectionName);
  if (!span) {
    return "";
  }
  const sectionText = text.slice(span.start, span.end);
  const matcher = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*"([^"]*)"`, "m");
  return sectionText.match(matcher)?.[1] ?? "";
}

function updateProviderBaseUrl(text: string, providerName: string, baseUrl: string): string {
  const sectionName = `model_providers.${providerName}`;
  const span = findSectionSpan(text, sectionName);
  if (!span) {
    throw new Error(`没有找到当前激活 provider 的配置段: [${sectionName}]`);
  }
  const current = text.slice(span.start, span.end).replace(/\n+$/g, "");
  const updated = setSectionStringValue(current, "base_url", baseUrl);
  const suffix = text.slice(span.end);
  return `${text.slice(0, span.start).replace(/\n+$/g, "")}\n${updated}\n${suffix.replace(/^\n+/g, "")}`;
}

function setSectionStringValue(sectionText: string, key: string, value: string): string {
  const pattern = new RegExp(`^(\\s*${escapeRegExp(key)}\\s*=\\s*)(\".*?\"|true|false|[^\\n#]+)(\\s*(?:#.*)?)$`, "m");
  const replacement = `$1"${escapeTomlString(value)}"$3`;
  if (pattern.test(sectionText)) {
    return sectionText.replace(pattern, replacement);
  }
  return `${sectionText}\n${key} = "${escapeTomlString(value)}"`;
}

function findSectionSpan(text: string, sectionName: string): { start: number; end: number } | undefined {
  const matcher = /^\[(.+?)\]\s*$/gm;
  const matches = Array.from(text.matchAll(matcher));
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    if (match[1]?.trim() === sectionName) {
      const start = match.index ?? 0;
      const end = index + 1 < matches.length ? matches[index + 1].index ?? text.length : text.length;
      return { start, end };
    }
  }
  return undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeTomlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
