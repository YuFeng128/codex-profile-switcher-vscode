import { execFile } from "child_process";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { promisify } from "util";
import * as vscode from "vscode";

type ProviderKind = "builtinOpenai" | "customOpenaiAuth" | "customProvider";
type ProfileKind = "followCurrent" | "builtinOpenai" | "customProvider" | "officialSnapshot";
type AuthMode = "apiKey" | "chatgpt" | "accessToken" | "loggedOut" | "unknown";
type AuthStrategy = "apikey" | "preserve";
type Personality = "" | "none" | "friendly" | "pragmatic";

type CurrentState = {
  profileName: string;
  providerName: string;
  providerLabel: string;
  providerKind: ProviderKind;
  baseUrl: string;
  apiKey: string;
  fastResponseEnabled: boolean;
  authMode: AuthMode;
  authStrategy: AuthStrategy;
  preferredAuthMethod: string;
  personality: Personality;
  hasOfficialSnapshot: boolean;
};

type Profile = {
  id: string;
  name: string;
  kind: ProfileKind;
  baseUrl: string;
  apiKey: string;
  fastResponseEnabled: boolean;
  providerId: string;
  authStrategy: AuthStrategy;
  writePreferredAuthMethod: boolean;
  personality: Personality;
  readonly: boolean;
};

type OfficialSnapshotRecord = {
  id: string;
  profile: Profile;
  configText: string;
  authText: string | null;
  capturedAt: string;
  authMode: AuthMode;
};

type AuthPayload = {
  exists: boolean;
  text: string | null;
  data: Record<string, unknown>;
};

const execFileAsync = promisify(execFile);

const PROFILE_KEY = "codexProfileSwitcher.profiles";
const OFFICIAL_SNAPSHOT_KEY = "codexProfileSwitcher.officialSnapshot";
const OFFICIAL_SNAPSHOT_PROFILE_ID = "__official_snapshot__";

class CodexConfigManager {
  private readonly configPath = path.join(os.homedir(), ".codex", "config.toml");
  private readonly authPath = path.join(os.homedir(), ".codex", "auth.json");

  constructor(private readonly backupDir: string) {}

  async readCurrentState(): Promise<CurrentState> {
    const configText = await fs.readFile(this.configPath, "utf8");
    const configuredProviderName = readTopLevelStringValue(configText, "model_provider");
    const authPayload = await this.readAuthPayload();
    const apiKey = String(authPayload.data.OPENAI_API_KEY ?? "");
    const authMode = await this.detectAuthMode(authPayload.data);
    const providerName = configuredProviderName || (isOfficialAuthPayload(authPayload.data) ? "openai" : "");
    const providerLabel = providerName === "openai"
      ? "openai"
      : readStringValueFromSection(configText, `model_providers.${providerName}`, "name") || providerName;
    const requiresOpenaiAuth = providerName
      ? readBooleanValueFromSection(configText, `model_providers.${providerName}`, "requires_openai_auth")
      : false;

    const baseUrl = providerName === "openai"
      ? readTopLevelStringValue(configText, "openai_base_url")
      : readStringValueFromSection(configText, `model_providers.${providerName}`, "base_url");

    const providerKind: ProviderKind = providerName === "openai"
      ? "builtinOpenai"
      : requiresOpenaiAuth
        ? "customOpenaiAuth"
        : "customProvider";

    const topLevelServiceTier = readTopLevelStringValue(configText, "service_tier");
    const sectionServiceTier = providerName
      ? readStringValueFromSection(configText, `model_providers.${providerName}`, "service_tier")
      : "";

    return {
      profileName: "",
      providerName,
      providerLabel,
      providerKind,
      baseUrl,
      apiKey,
      fastResponseEnabled: topLevelServiceTier === "fast" || sectionServiceTier === "fast",
      authMode,
      authStrategy: authMode === "apiKey" || (authMode === "unknown" && Boolean(apiKey)) ? "apikey" : "preserve",
      preferredAuthMethod: readTopLevelStringValue(configText, "preferred_auth_method"),
      personality: normalizePersonality(readTopLevelStringValue(configText, "personality")),
      hasOfficialSnapshot: false,
    };
  }

  async switchProfile(profile: Profile): Promise<void> {
    await this.backupCurrentFiles();

    const configText = await fs.readFile(this.configPath, "utf8");
    let updatedConfig = configText;
    const current = await this.readCurrentState();

    if (profile.kind === "followCurrent") {
      updatedConfig = updateFollowCurrentConfig(configText, current, profile);
    } else if (profile.kind === "builtinOpenai") {
      updatedConfig = updateBuiltinOpenAIConfig(configText, profile);
    } else if (profile.kind === "customProvider") {
      updatedConfig = updateCustomProviderConfig(configText, current.providerName, profile);
    }

    await fs.writeFile(this.configPath, updatedConfig, "utf8");
    await this.applyAuthStrategy(profile);
  }

  async restoreOfficialSnapshot(snapshot: OfficialSnapshotRecord): Promise<void> {
    await this.backupCurrentFiles();
    await fs.writeFile(this.configPath, snapshot.configText, "utf8");

    if (snapshot.authText === null) {
      try {
        await fs.unlink(this.authPath);
      } catch {
        // ignore missing auth.json
      }
      return;
    }

    await fs.writeFile(this.authPath, snapshot.authText, "utf8");
  }

  async readRawFiles(): Promise<{ configText: string; authText: string | null }> {
    const configText = await fs.readFile(this.configPath, "utf8");
    try {
      const authText = await fs.readFile(this.authPath, "utf8");
      return { configText, authText };
    } catch {
      return { configText, authText: null };
    }
  }

  private async backupCurrentFiles(): Promise<void> {
    await fs.mkdir(this.backupDir, { recursive: true });
    const timestamp = createTimestamp();
    await fs.copyFile(this.configPath, path.join(this.backupDir, `config-${timestamp}.toml`));
    try {
      await fs.copyFile(this.authPath, path.join(this.backupDir, `auth-${timestamp}.json`));
    } catch {
      // ignore missing auth.json
    }
  }

  private async applyAuthStrategy(profile: Profile): Promise<void> {
    if (profile.authStrategy !== "apikey") {
      return;
    }

    // When switching away from ChatGPT / access-token auth to API key auth,
    // rewrite auth.json to a minimal payload instead of preserving unknown
    // fields from the previous login mode.
    const authPayload: Record<string, unknown> = {
      auth_mode: "apikey",
      OPENAI_API_KEY: profile.apiKey,
    };
    await fs.writeFile(this.authPath, JSON.stringify(authPayload, null, 2), "utf8");
  }

  private async readAuthPayload(): Promise<AuthPayload> {
    try {
      const text = await fs.readFile(this.authPath, "utf8");
      return {
        exists: true,
        text,
        data: JSON.parse(text) as Record<string, unknown>,
      };
    } catch {
      return {
        exists: false,
        text: null,
        data: {},
      };
    }
  }

  private async detectAuthMode(authData: Record<string, unknown>): Promise<AuthMode> {
    try {
      const { stdout, stderr } = await execFileAsync("codex", ["login", "status"], {
        timeout: 5000,
        windowsHide: true,
      });
      return parseAuthMode(`${stdout}\n${stderr}`);
    } catch {
      return detectAuthModeFromPayload(authData);
    }
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
    const snapshot = this.loadOfficialSnapshot();
    const current = await this.configManager.readCurrentState();
    current.profileName = this.resolveCurrentProfileName(current, profiles);
    current.hasOfficialSnapshot = Boolean(snapshot);

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
    const stored = this.context.globalState.get<unknown[]>(PROFILE_KEY, []);
    const profiles = stored
      .map((profile) => this.restoreStoredProfile(profile))
      .filter((profile): profile is Profile => Boolean(profile));

    const snapshot = this.loadOfficialSnapshot();
    if (snapshot) {
      const index = profiles.findIndex((item) => item.id === snapshot.profile.id);
      if (index >= 0) {
        profiles[index] = snapshot.profile;
      } else {
        profiles.unshift(snapshot.profile);
      }
    }

    return profiles;
  }

  private loadOfficialSnapshot(): OfficialSnapshotRecord | undefined {
    const raw = this.context.globalState.get<OfficialSnapshotRecord | undefined>(OFFICIAL_SNAPSHOT_KEY);
    if (!raw || !raw.profile) {
      return undefined;
    }

    const restoredProfile = this.restoreStoredProfile(raw.profile);
    if (!restoredProfile) {
      return undefined;
    }

    return {
      ...raw,
      profile: {
        ...restoredProfile,
        id: OFFICIAL_SNAPSHOT_PROFILE_ID,
        kind: "officialSnapshot",
        readonly: true,
      },
    };
  }

  private resolveCurrentProfileName(current: CurrentState, profiles: Profile[]): string {
    const matched = profiles.find((profile) => this.profileMatchesCurrentState(profile, current));
    return matched?.name ?? "";
  }

  private profileMatchesCurrentState(profile: Profile, current: CurrentState): boolean {
    const kindMatches = profile.kind === "officialSnapshot"
      ? true
      : profile.kind === "followCurrent"
        ? true
        : profile.kind === "builtinOpenai"
          ? current.providerKind === "builtinOpenai"
          : current.providerKind !== "builtinOpenai";

    const providerMatches = profile.kind === "followCurrent"
      ? true
      : profile.kind === "builtinOpenai"
        ? current.providerName === "openai"
        : !profile.providerId || profile.providerId === current.providerName;

    const apiKeyMatches = profile.authStrategy === "preserve" || profile.apiKey === current.apiKey;

    return kindMatches
      && providerMatches
      && profile.baseUrl === current.baseUrl
      && profile.fastResponseEnabled === current.fastResponseEnabled
      && profile.authStrategy === current.authStrategy
      && profile.personality === current.personality
      && apiKeyMatches;
  }

  private async saveProfiles(profiles: Profile[]): Promise<void> {
    await this.context.globalState.update(
      PROFILE_KEY,
      profiles
        .filter((profile) => profile.kind !== "officialSnapshot")
        .map((profile) => ({
          ...profile,
          readonly: false,
        })),
    );
  }

  private restoreStoredProfile(input: unknown): Profile | undefined {
    const raw = (input ?? {}) as Record<string, unknown>;
    const id = typeof raw.id === "string" && raw.id ? raw.id : createProfileId();
    const kind = raw.kind === "followCurrent" || raw.kind === "builtinOpenai" || raw.kind === "officialSnapshot"
      ? raw.kind
      : "customProvider";
    const authStrategy = raw.authStrategy === "preserve" ? "preserve" : "apikey";

    const profile: Profile = {
      id,
      name: String(raw.name ?? "").trim(),
      kind,
      baseUrl: String(raw.baseUrl ?? "").trim(),
      apiKey: String(raw.apiKey ?? "").trim(),
      fastResponseEnabled: Boolean(raw.fastResponseEnabled),
      providerId: String(raw.providerId ?? "").trim(),
      authStrategy,
      writePreferredAuthMethod: Boolean(raw.writePreferredAuthMethod),
      personality: normalizePersonality(raw.personality),
      readonly: Boolean(raw.readonly),
    };

    if (!profile.name || (profile.kind !== "officialSnapshot" && !profile.baseUrl)) {
      return undefined;
    }

    if (profile.kind === "builtinOpenai") {
      profile.providerId = "openai";
    }

    return profile;
  }

  private normalizeProfile(input: unknown, id?: string): Profile {
    const raw = (input ?? {}) as Record<string, unknown>;
    const kind: ProfileKind = raw.kind === "builtinOpenai"
      ? "builtinOpenai"
      : raw.kind === "customProvider"
        ? "customProvider"
        : "followCurrent";
    const authStrategy: AuthStrategy = raw.authStrategy === "preserve" ? "preserve" : "apikey";
    const profile: Profile = {
      id: id ?? createProfileId(),
      name: String(raw.name ?? "").trim(),
      kind,
      baseUrl: String(raw.baseUrl ?? "").trim(),
      apiKey: String(raw.apiKey ?? "").trim(),
      fastResponseEnabled: Boolean(raw.fastResponseEnabled),
      providerId: kind === "builtinOpenai" ? "openai" : String(raw.providerId ?? "").trim(),
      authStrategy,
      writePreferredAuthMethod: Boolean(raw.writePreferredAuthMethod),
      personality: normalizePersonality(raw.personality),
      readonly: false,
    };

    if (!profile.name) {
      throw new Error("显示名称不能为空。");
    }
    if (!profile.baseUrl.startsWith("http://") && !profile.baseUrl.startsWith("https://")) {
      throw new Error("API Base URL 必须以 http:// 或 https:// 开头。");
    }
    if (profile.kind === "customProvider" && !profile.providerId) {
      throw new Error("自定义 Provider 模式必须填写 Provider ID。");
    }
    if (profile.authStrategy === "apikey" && !profile.apiKey) {
      throw new Error("API Key 不能为空。要切回原来的账号，请使用“原有账号备份”。");
    }

    return profile;
  }

  private async addProfile(input: unknown): Promise<void> {
    const profiles = this.loadProfiles().filter((profile) => profile.kind !== "officialSnapshot");
    const confirmedInput = await this.confirmProviderChoiceIfNeeded(input);
    if (!confirmedInput) {
      return;
    }
    profiles.push(this.normalizeProfile(confirmedInput));
    await this.saveProfiles(profiles);
    await this.refresh();
    void vscode.window.showInformationMessage("已新增配置。");
  }

  private async updateProfile(id: unknown, input: unknown): Promise<void> {
    if (typeof id !== "string" || !id) {
      throw new Error("请先在左侧选择一个配置，再保存修改。");
    }
    if (id === OFFICIAL_SNAPSHOT_PROFILE_ID) {
      throw new Error("“原有账号备份”是自动生成的，不能直接修改。");
    }

    const profiles = this.loadProfiles().filter((profile) => profile.kind !== "officialSnapshot");
    const index = profiles.findIndex((item) => item.id === id);
    if (index < 0) {
      throw new Error("当前选中的配置不存在。");
    }
    const confirmedInput = await this.confirmProviderChoiceIfNeeded(input);
    if (!confirmedInput) {
      return;
    }
    profiles[index] = this.normalizeProfile(confirmedInput, id);
    await this.saveProfiles(profiles);
    await this.refresh();
    void vscode.window.showInformationMessage("已保存修改。");
  }

  private async confirmProviderChoiceIfNeeded(input: unknown): Promise<unknown | undefined> {
    const raw = (input ?? {}) as Record<string, unknown>;
    if (raw.kind === "followCurrent") {
      return input;
    }

    const choice = await vscode.window.showWarningMessage(
      "你选择了固定线路。以后切换到这套配置时，Codex 可能会使用不同的 provider，聊天记录可能分散到另一条线路。建议选择“沿用当前线路”。",
      { modal: true },
      "改为沿用当前线路",
      "仍然保存",
    );

    if (choice === "改为沿用当前线路") {
      return {
        ...raw,
        kind: "followCurrent",
      };
    }

    if (choice === "仍然保存") {
      return input;
    }

    return undefined;
  }

  private async deleteProfile(id: unknown): Promise<void> {
    if (typeof id !== "string" || !id) {
      throw new Error("请先选择一个配置。");
    }

    if (id === OFFICIAL_SNAPSHOT_PROFILE_ID) {
      const confirmed = await vscode.window.showWarningMessage(
        "确定删除“原有账号备份”吗？删除后将无法一键切回原来的账号。",
        { modal: true },
        "删除",
      );
      if (confirmed !== "删除") {
        return;
      }
      await this.context.globalState.update(OFFICIAL_SNAPSHOT_KEY, undefined);
      await this.refresh();
      return;
    }

    const profiles = this.loadProfiles().filter((profile) => profile.kind !== "officialSnapshot");
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

    if (profile.kind !== "officialSnapshot") {
      await this.captureOfficialSnapshotIfNeeded();
      await this.configManager.switchProfile(profile);
    } else {
      const snapshot = this.loadOfficialSnapshot();
      if (!snapshot) {
        throw new Error("没有找到“原有账号备份”。");
      }
      await this.configManager.restoreOfficialSnapshot(snapshot);
    }

    void vscode.window.showInformationMessage("Codex 配置已切换，VS Code 即将重载。");
    await vscode.commands.executeCommand("workbench.action.reloadWindow");
  }

  private async captureOfficialSnapshotIfNeeded(): Promise<void> {
    if (this.loadOfficialSnapshot()) {
      return;
    }

    const current = await this.configManager.readCurrentState();
    if (!isOfficialLikeState(current)) {
      return;
    }

    const files = await this.configManager.readRawFiles();
    const snapshotProfile: Profile = {
      id: OFFICIAL_SNAPSHOT_PROFILE_ID,
      name: `原有账号备份（${formatAuthModeLabel(current.authMode)}）`,
      kind: "officialSnapshot",
      baseUrl: current.baseUrl,
      apiKey: "",
      fastResponseEnabled: current.fastResponseEnabled,
      providerId: current.providerName,
      authStrategy: "preserve",
      writePreferredAuthMethod: false,
      personality: current.personality,
      readonly: true,
    };

    const snapshot: OfficialSnapshotRecord = {
      id: OFFICIAL_SNAPSHOT_PROFILE_ID,
      profile: snapshotProfile,
      configText: files.configText,
      authText: files.authText,
      capturedAt: new Date().toISOString(),
      authMode: current.authMode,
    };

    await this.context.globalState.update(OFFICIAL_SNAPSHOT_KEY, snapshot);
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

function parseAuthMode(text: string): AuthMode {
  const normalized = text.toLowerCase();
  if (normalized.includes("api key")) {
    return "apiKey";
  }
  if (normalized.includes("chatgpt")) {
    return "chatgpt";
  }
  if (normalized.includes("access token")) {
    return "accessToken";
  }
  if (normalized.includes("not logged in") || normalized.includes("logged out")) {
    return "loggedOut";
  }
  return "unknown";
}

function detectAuthModeFromPayload(authData: Record<string, unknown>): AuthMode {
  const authMode = String(authData.auth_mode ?? "").toLowerCase();
  if (authMode === "apikey" || authMode === "api_key") {
    return "apiKey";
  }
  if (authMode === "chatgpt") {
    return "chatgpt";
  }
  if (authMode === "access_token" || authMode === "access-token") {
    return "accessToken";
  }
  if (typeof authData.OPENAI_API_KEY === "string" && authData.OPENAI_API_KEY) {
    return "apiKey";
  }
  if (isOfficialAuthPayload(authData)) {
    return "chatgpt";
  }
  return "unknown";
}

function isOfficialAuthPayload(authData: Record<string, unknown>): boolean {
  const hasAccountIdentity = typeof authData.account_id === "string" && authData.account_id.length > 0;
  const hasSessionTokens =
    (typeof authData.access_token === "string" && authData.access_token.length > 0)
    || (typeof authData.refresh_token === "string" && authData.refresh_token.length > 0);
  const mode = String(authData.auth_mode ?? "").toLowerCase();
  return mode === "chatgpt"
    || mode === "access_token"
    || mode === "access-token"
    || (hasAccountIdentity && hasSessionTokens);
}

function isOfficialLikeState(state: CurrentState): boolean {
  return state.providerKind === "builtinOpenai"
    || state.providerKind === "customOpenaiAuth"
    || state.authMode === "chatgpt"
    || state.authMode === "accessToken";
}

function formatAuthModeLabel(authMode: AuthMode): string {
  switch (authMode) {
    case "apiKey":
      return "API Key";
    case "chatgpt":
      return "ChatGPT";
    case "accessToken":
      return "Access Token";
    case "loggedOut":
      return "未登录";
    default:
      return "未知认证";
  }
}

function readTopLevelStringValue(text: string, key: string): string {
  const topLevelText = getTopLevelText(text);
  const matcher = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*"([^"]*)"`, "m");
  return topLevelText.match(matcher)?.[1] ?? "";
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

function readBooleanValueFromSection(text: string, sectionName: string, key: string): boolean {
  const span = findSectionSpan(text, sectionName);
  if (!span) {
    return false;
  }
  const sectionText = text.slice(span.start, span.end);
  const matcher = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*(true|false)`, "m");
  return sectionText.match(matcher)?.[1] === "true";
}

function updateBuiltinOpenAIConfig(text: string, profile: Profile): string {
  let updated = setTopLevelStringValue(text, "model_provider", "openai");
  updated = setTopLevelStringValue(updated, "openai_base_url", profile.baseUrl);
  updated = setOptionalTopLevelStringValue(
    updated,
    "preferred_auth_method",
    profile.authStrategy === "apikey" && profile.writePreferredAuthMethod ? "apikey" : undefined,
  );
  updated = setTopLevelStringValue(updated, "service_tier", profile.fastResponseEnabled ? "fast" : "default");
  updated = setOptionalTopLevelStringValue(updated, "personality", profile.personality || undefined);
  return updated;
}

function updateFollowCurrentConfig(text: string, current: CurrentState, profile: Profile): string {
  if (current.providerKind === "builtinOpenai" || current.providerName === "openai" || !current.providerName) {
    return updateBuiltinOpenAIConfig(text, {
      ...profile,
      kind: "builtinOpenai",
      providerId: "openai",
    });
  }

  return updateCustomProviderConfig(text, current.providerName, {
    ...profile,
    kind: "customProvider",
    providerId: current.providerName,
  });
}

function updateCustomProviderConfig(text: string, currentProviderName: string, profile: Profile): string {
  const targetProviderId = profile.providerId || currentProviderName;
  if (!targetProviderId) {
    throw new Error("没有可写入的 Provider ID。");
  }

  let updated = setTopLevelStringValue(text, "model_provider", targetProviderId);
  updated = removeModelProviderSectionsExcept(updated, targetProviderId);
  updated = upsertSection(updated, `model_providers.${targetProviderId}`, (sectionText) => {
    let next = setSectionStringValue(sectionText, "name", targetProviderId);
    next = setSectionStringValue(next, "base_url", profile.baseUrl);
    next = setSectionStringValue(next, "wire_api", "responses");
    if (profile.authStrategy === "preserve") {
      next = setOptionalSectionBooleanValue(next, "requires_openai_auth", true);
    }
    next = setOptionalSectionStringValue(next, "service_tier", undefined);
    return next;
  });

  updated = setOptionalTopLevelStringValue(
    updated,
    "preferred_auth_method",
    profile.authStrategy === "apikey" && profile.writePreferredAuthMethod ? "apikey" : undefined,
  );
  updated = setTopLevelStringValue(updated, "service_tier", profile.fastResponseEnabled ? "fast" : "default");
  updated = setOptionalTopLevelStringValue(updated, "personality", profile.personality || undefined);
  return updated;
}

function normalizePersonality(value: unknown): Personality {
  if (value === "none" || value === "friendly" || value === "pragmatic") {
    return value;
  }
  return "";
}

function setTopLevelStringValue(text: string, key: string, value: string): string {
  const firstSection = findFirstSectionIndex(text);
  const topLevelText = firstSection < 0 ? text : text.slice(0, firstSection);
  const restText = firstSection < 0 ? "" : text.slice(firstSection);
  const pattern = new RegExp(`^(\\s*${escapeRegExp(key)}\\s*=\\s*)(\".*?\")(\\s*(?:#.*)?)$`, "m");
  const replacement = `$1"${escapeTomlString(value)}"$3`;
  if (pattern.test(topLevelText)) {
    return `${topLevelText.replace(pattern, replacement)}${restText}`;
  }

  if (firstSection < 0) {
    return `${text.replace(/\s*$/g, "")}\n${key} = "${escapeTomlString(value)}"\n`;
  }

  return `${topLevelText.replace(/\s*$/g, "")}\n${key} = "${escapeTomlString(value)}"\n\n${restText.replace(/^\s*/g, "")}`;
}

function setOptionalTopLevelStringValue(text: string, key: string, value?: string): string {
  const firstSection = findFirstSectionIndex(text);
  const topLevelText = firstSection < 0 ? text : text.slice(0, firstSection);
  const restText = firstSection < 0 ? "" : text.slice(firstSection);
  const pattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*(\".*?\"|true|false|[^\\n#]+)\\s*(?:#.*)?\\r?\\n?`, "m");
  if (value === undefined) {
    return `${topLevelText.replace(pattern, "").replace(/\n{3,}/g, "\n\n").replace(/^\n+/g, "")}${restText}`;
  }
  return setTopLevelStringValue(text, key, value);
}

function getTopLevelText(text: string): string {
  const firstSection = findFirstSectionIndex(text);
  return firstSection < 0 ? text : text.slice(0, firstSection);
}

function findFirstSectionIndex(text: string): number {
  const match = /^\[.+?\]\s*$/m.exec(text);
  return match?.index ?? -1;
}

function upsertSection(text: string, sectionName: string, updater: (sectionText: string) => string): string {
  const span = findSectionSpan(text, sectionName);
  if (!span) {
    const created = updater(`[${sectionName}]`);
    return `${text.replace(/\s*$/g, "")}\n\n${created}\n`;
  }

  const current = text.slice(span.start, span.end).replace(/\n+$/g, "");
  const updated = updater(current);
  const suffix = text.slice(span.end);
  return `${text.slice(0, span.start).replace(/\n+$/g, "")}\n${updated}\n${suffix.replace(/^\n+/g, "")}`;
}

function removeModelProviderSectionsExcept(text: string, providerIdToKeep: string): string {
  const matcher = /^\[(.+?)\]\s*$/gm;
  const matches = Array.from(text.matchAll(matcher));
  let result = text;

  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index];
    const sectionName = match[1]?.trim() ?? "";
    if (!sectionName.startsWith("model_providers.")) {
      continue;
    }
    if (sectionName === `model_providers.${providerIdToKeep}`) {
      continue;
    }

    const start = match.index ?? 0;
    const end = index + 1 < matches.length ? matches[index + 1].index ?? result.length : result.length;
    result = `${result.slice(0, start).replace(/\n+$/g, "")}\n${result.slice(end).replace(/^\n+/g, "")}`;
  }

  return result.replace(/\n{3,}/g, "\n\n");
}

function setSectionStringValue(sectionText: string, key: string, value: string): string {
  const pattern = new RegExp(`^(\\s*${escapeRegExp(key)}\\s*=\\s*)(\".*?\"|true|false|[^\\n#]+)(\\s*(?:#.*)?)$`, "m");
  const replacement = `$1"${escapeTomlString(value)}"$3`;
  if (pattern.test(sectionText)) {
    return sectionText.replace(pattern, replacement);
  }
  return `${sectionText}\n${key} = "${escapeTomlString(value)}"`;
}

function setOptionalSectionStringValue(sectionText: string, key: string, value?: string): string {
  const pattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*(\".*?\"|true|false|[^\\n#]+)\\s*(?:#.*)?\\r?\\n?`, "m");
  if (value === undefined) {
    return sectionText.replace(pattern, "").replace(/\n{3,}/g, "\n\n").replace(/\n+$/g, "");
  }
  return setSectionStringValue(sectionText, key, value);
}

function setOptionalSectionBooleanValue(sectionText: string, key: string, value?: boolean): string {
  const pattern = new RegExp(`^(\\s*${escapeRegExp(key)}\\s*=\\s*)(\".*?\"|true|false|[^\\n#]+)(\\s*(?:#.*)?)$`, "m");
  if (value === undefined) {
    return sectionText.replace(new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*(\".*?\"|true|false|[^\\n#]+)\\s*(?:#.*)?\\r?\\n?`, "m"), "")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/\n+$/g, "");
  }
  const replacement = `$1${value ? "true" : "false"}$3`;
  if (pattern.test(sectionText)) {
    return sectionText.replace(pattern, replacement);
  }
  return `${sectionText}\n${key} = ${value ? "true" : "false"}`;
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
