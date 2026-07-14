"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const child_process_1 = require("child_process");
const fs = __importStar(require("fs/promises"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const util_1 = require("util");
const vscode = __importStar(require("vscode"));
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
const PROFILE_KEY = "codexProfileSwitcher.profiles";
const OFFICIAL_SNAPSHOT_KEY = "codexProfileSwitcher.officialSnapshot";
const OFFICIAL_SNAPSHOT_PROFILE_ID = "__official_snapshot__";
class CodexConfigManager {
    constructor(backupDir) {
        this.backupDir = backupDir;
        this.configPath = path.join(os.homedir(), ".codex", "config.toml");
        this.authPath = path.join(os.homedir(), ".codex", "auth.json");
    }
    async readCurrentState() {
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
        const providerKind = providerName === "openai"
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
    async switchProfile(profile) {
        await this.backupCurrentFiles();
        const configText = await fs.readFile(this.configPath, "utf8");
        let updatedConfig = configText;
        const current = await this.readCurrentState();
        if (profile.kind === "followCurrent") {
            updatedConfig = updateFollowCurrentConfig(configText, current, profile);
        }
        else if (profile.kind === "builtinOpenai") {
            updatedConfig = updateBuiltinOpenAIConfig(configText, profile);
        }
        else if (profile.kind === "customProvider") {
            updatedConfig = updateCustomProviderConfig(configText, current.providerName, profile);
        }
        await fs.writeFile(this.configPath, updatedConfig, "utf8");
        await this.applyAuthStrategy(profile);
    }
    async restoreOfficialSnapshot(snapshot) {
        await this.backupCurrentFiles();
        await fs.writeFile(this.configPath, snapshot.configText, "utf8");
        if (snapshot.authText === null) {
            try {
                await fs.unlink(this.authPath);
            }
            catch {
                // ignore missing auth.json
            }
            return;
        }
        await fs.writeFile(this.authPath, snapshot.authText, "utf8");
    }
    async readRawFiles() {
        const configText = await fs.readFile(this.configPath, "utf8");
        try {
            const authText = await fs.readFile(this.authPath, "utf8");
            return { configText, authText };
        }
        catch {
            return { configText, authText: null };
        }
    }
    async backupCurrentFiles() {
        await fs.mkdir(this.backupDir, { recursive: true });
        const timestamp = createTimestamp();
        await fs.copyFile(this.configPath, path.join(this.backupDir, `config-${timestamp}.toml`));
        try {
            await fs.copyFile(this.authPath, path.join(this.backupDir, `auth-${timestamp}.json`));
        }
        catch {
            // ignore missing auth.json
        }
    }
    async applyAuthStrategy(profile) {
        if (profile.authStrategy !== "apikey") {
            return;
        }
        // When switching away from ChatGPT / access-token auth to API key auth,
        // rewrite auth.json to a minimal payload instead of preserving unknown
        // fields from the previous login mode.
        const authPayload = {
            auth_mode: "apikey",
            OPENAI_API_KEY: profile.apiKey,
        };
        await fs.writeFile(this.authPath, JSON.stringify(authPayload, null, 2), "utf8");
    }
    async readAuthPayload() {
        try {
            const text = await fs.readFile(this.authPath, "utf8");
            return {
                exists: true,
                text,
                data: JSON.parse(text),
            };
        }
        catch {
            return {
                exists: false,
                text: null,
                data: {},
            };
        }
    }
    async detectAuthMode(authData) {
        try {
            const { stdout, stderr } = await execFileAsync("codex", ["login", "status"], {
                timeout: 5000,
                windowsHide: true,
            });
            return parseAuthMode(`${stdout}\n${stderr}`);
        }
        catch {
            return detectAuthModeFromPayload(authData);
        }
    }
}
class CodexProfileViewProvider {
    constructor(context) {
        this.context = context;
        const backupDir = path.join(context.globalStorageUri.fsPath, "backups");
        this.configManager = new CodexConfigManager(backupDir);
    }
    resolveWebviewView(webviewView) {
        this.view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri],
        };
        webviewView.webview.html = this.getHtml(webviewView.webview);
        webviewView.webview.onDidReceiveMessage(async (message) => {
            try {
                await this.handleMessage(message);
            }
            catch (error) {
                const text = error instanceof Error ? error.message : String(error);
                void vscode.window.showErrorMessage(text);
            }
        });
    }
    async refresh() {
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
    async handleMessage(message) {
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
    loadProfiles() {
        const stored = this.context.globalState.get(PROFILE_KEY, []);
        const profiles = stored
            .map((profile) => this.restoreStoredProfile(profile))
            .filter((profile) => Boolean(profile));
        const snapshot = this.loadOfficialSnapshot();
        if (snapshot) {
            const index = profiles.findIndex((item) => item.id === snapshot.profile.id);
            if (index >= 0) {
                profiles[index] = snapshot.profile;
            }
            else {
                profiles.unshift(snapshot.profile);
            }
        }
        return profiles;
    }
    loadOfficialSnapshot() {
        const raw = this.context.globalState.get(OFFICIAL_SNAPSHOT_KEY);
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
    resolveCurrentProfileName(current, profiles) {
        const matched = profiles.find((profile) => this.profileMatchesCurrentState(profile, current));
        return matched?.name ?? "";
    }
    profileMatchesCurrentState(profile, current) {
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
    async saveProfiles(profiles) {
        await this.context.globalState.update(PROFILE_KEY, profiles
            .filter((profile) => profile.kind !== "officialSnapshot")
            .map((profile) => ({
            ...profile,
            readonly: false,
        })));
    }
    restoreStoredProfile(input) {
        const raw = (input ?? {});
        const id = typeof raw.id === "string" && raw.id ? raw.id : createProfileId();
        const kind = raw.kind === "followCurrent" || raw.kind === "builtinOpenai" || raw.kind === "officialSnapshot"
            ? raw.kind
            : "customProvider";
        const authStrategy = raw.authStrategy === "preserve" ? "preserve" : "apikey";
        const profile = {
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
    normalizeProfile(input, id) {
        const raw = (input ?? {});
        const kind = raw.kind === "builtinOpenai"
            ? "builtinOpenai"
            : raw.kind === "customProvider"
                ? "customProvider"
                : "followCurrent";
        const authStrategy = raw.authStrategy === "preserve" ? "preserve" : "apikey";
        const profile = {
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
    async addProfile(input) {
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
    async updateProfile(id, input) {
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
    async confirmProviderChoiceIfNeeded(input) {
        const raw = (input ?? {});
        if (raw.kind === "followCurrent") {
            return input;
        }
        const choice = await vscode.window.showWarningMessage("你选择了固定线路。以后切换到这套配置时，Codex 可能会使用不同的 provider，聊天记录可能分散到另一条线路。建议选择“沿用当前线路”。", { modal: true }, "改为沿用当前线路", "仍然保存");
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
    async deleteProfile(id) {
        if (typeof id !== "string" || !id) {
            throw new Error("请先选择一个配置。");
        }
        if (id === OFFICIAL_SNAPSHOT_PROFILE_ID) {
            const confirmed = await vscode.window.showWarningMessage("确定删除“原有账号备份”吗？删除后将无法一键切回原来的账号。", { modal: true }, "删除");
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
        const confirmed = await vscode.window.showWarningMessage(`确定删除配置“${profile.name}”吗？`, { modal: true }, "删除");
        if (confirmed !== "删除") {
            return;
        }
        await this.saveProfiles(profiles.filter((item) => item.id !== id));
        await this.refresh();
    }
    async switchProfile(id) {
        if (typeof id !== "string" || !id) {
            throw new Error("请先选择一个配置。");
        }
        const profiles = this.loadProfiles();
        const profile = profiles.find((item) => item.id === id);
        if (!profile) {
            throw new Error("当前选中的配置不存在。");
        }
        const confirmed = await vscode.window.showWarningMessage(`切换到“${profile.name}”后将重载 VS Code 窗口。是否继续？`, { modal: true }, "切换并重载");
        if (confirmed !== "切换并重载") {
            return;
        }
        if (profile.kind !== "officialSnapshot") {
            await this.captureOfficialSnapshotIfNeeded();
            await this.configManager.switchProfile(profile);
        }
        else {
            const snapshot = this.loadOfficialSnapshot();
            if (!snapshot) {
                throw new Error("没有找到“原有账号备份”。");
            }
            await this.configManager.restoreOfficialSnapshot(snapshot);
        }
        void vscode.window.showInformationMessage("Codex 配置已切换，VS Code 即将重载。");
        await vscode.commands.executeCommand("workbench.action.reloadWindow");
    }
    async captureOfficialSnapshotIfNeeded() {
        if (this.loadOfficialSnapshot()) {
            return;
        }
        const current = await this.configManager.readCurrentState();
        if (!isOfficialLikeState(current)) {
            return;
        }
        const files = await this.configManager.readRawFiles();
        const snapshotProfile = {
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
        const snapshot = {
            id: OFFICIAL_SNAPSHOT_PROFILE_ID,
            profile: snapshotProfile,
            configText: files.configText,
            authText: files.authText,
            capturedAt: new Date().toISOString(),
            authMode: current.authMode,
        };
        await this.context.globalState.update(OFFICIAL_SNAPSHOT_KEY, snapshot);
    }
    getHtml(webview) {
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
CodexProfileViewProvider.viewType = "codexProfileSwitcher.view";
function activate(context) {
    const provider = new CodexProfileViewProvider(context);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(CodexProfileViewProvider.viewType, provider), vscode.commands.registerCommand("codexProfileSwitcher.refresh", async () => {
        await provider.refresh();
    }));
}
function deactivate() { }
function createProfileId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function createTimestamp() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, "0");
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
function createNonce() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    for (let index = 0; index < 16; index += 1) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}
function parseAuthMode(text) {
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
function detectAuthModeFromPayload(authData) {
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
function isOfficialAuthPayload(authData) {
    const hasAccountIdentity = typeof authData.account_id === "string" && authData.account_id.length > 0;
    const hasSessionTokens = (typeof authData.access_token === "string" && authData.access_token.length > 0)
        || (typeof authData.refresh_token === "string" && authData.refresh_token.length > 0);
    const mode = String(authData.auth_mode ?? "").toLowerCase();
    return mode === "chatgpt"
        || mode === "access_token"
        || mode === "access-token"
        || (hasAccountIdentity && hasSessionTokens);
}
function isOfficialLikeState(state) {
    return state.providerKind === "builtinOpenai"
        || state.providerKind === "customOpenaiAuth"
        || state.authMode === "chatgpt"
        || state.authMode === "accessToken";
}
function formatAuthModeLabel(authMode) {
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
function readTopLevelStringValue(text, key) {
    const topLevelText = getTopLevelText(text);
    const matcher = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*"([^"]*)"`, "m");
    return topLevelText.match(matcher)?.[1] ?? "";
}
function readStringValueFromSection(text, sectionName, key) {
    const span = findSectionSpan(text, sectionName);
    if (!span) {
        return "";
    }
    const sectionText = text.slice(span.start, span.end);
    const matcher = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*"([^"]*)"`, "m");
    return sectionText.match(matcher)?.[1] ?? "";
}
function readBooleanValueFromSection(text, sectionName, key) {
    const span = findSectionSpan(text, sectionName);
    if (!span) {
        return false;
    }
    const sectionText = text.slice(span.start, span.end);
    const matcher = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*(true|false)`, "m");
    return sectionText.match(matcher)?.[1] === "true";
}
function updateBuiltinOpenAIConfig(text, profile) {
    let updated = setTopLevelStringValue(text, "model_provider", "openai");
    updated = setTopLevelStringValue(updated, "openai_base_url", profile.baseUrl);
    updated = setOptionalTopLevelStringValue(updated, "preferred_auth_method", profile.authStrategy === "apikey" && profile.writePreferredAuthMethod ? "apikey" : undefined);
    updated = setTopLevelStringValue(updated, "service_tier", profile.fastResponseEnabled ? "fast" : "default");
    updated = setOptionalTopLevelStringValue(updated, "personality", profile.personality || undefined);
    return updated;
}
function updateFollowCurrentConfig(text, current, profile) {
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
function updateCustomProviderConfig(text, currentProviderName, profile) {
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
    updated = setOptionalTopLevelStringValue(updated, "preferred_auth_method", profile.authStrategy === "apikey" && profile.writePreferredAuthMethod ? "apikey" : undefined);
    updated = setTopLevelStringValue(updated, "service_tier", profile.fastResponseEnabled ? "fast" : "default");
    updated = setOptionalTopLevelStringValue(updated, "personality", profile.personality || undefined);
    return updated;
}
function normalizePersonality(value) {
    if (value === "none" || value === "friendly" || value === "pragmatic") {
        return value;
    }
    return "";
}
function setTopLevelStringValue(text, key, value) {
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
function setOptionalTopLevelStringValue(text, key, value) {
    const firstSection = findFirstSectionIndex(text);
    const topLevelText = firstSection < 0 ? text : text.slice(0, firstSection);
    const restText = firstSection < 0 ? "" : text.slice(firstSection);
    const pattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*(\".*?\"|true|false|[^\\n#]+)\\s*(?:#.*)?\\r?\\n?`, "m");
    if (value === undefined) {
        return `${topLevelText.replace(pattern, "").replace(/\n{3,}/g, "\n\n").replace(/^\n+/g, "")}${restText}`;
    }
    return setTopLevelStringValue(text, key, value);
}
function getTopLevelText(text) {
    const firstSection = findFirstSectionIndex(text);
    return firstSection < 0 ? text : text.slice(0, firstSection);
}
function findFirstSectionIndex(text) {
    const match = /^\[.+?\]\s*$/m.exec(text);
    return match?.index ?? -1;
}
function upsertSection(text, sectionName, updater) {
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
function removeModelProviderSectionsExcept(text, providerIdToKeep) {
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
function setSectionStringValue(sectionText, key, value) {
    const pattern = new RegExp(`^(\\s*${escapeRegExp(key)}\\s*=\\s*)(\".*?\"|true|false|[^\\n#]+)(\\s*(?:#.*)?)$`, "m");
    const replacement = `$1"${escapeTomlString(value)}"$3`;
    if (pattern.test(sectionText)) {
        return sectionText.replace(pattern, replacement);
    }
    return `${sectionText}\n${key} = "${escapeTomlString(value)}"`;
}
function setOptionalSectionStringValue(sectionText, key, value) {
    const pattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*(\".*?\"|true|false|[^\\n#]+)\\s*(?:#.*)?\\r?\\n?`, "m");
    if (value === undefined) {
        return sectionText.replace(pattern, "").replace(/\n{3,}/g, "\n\n").replace(/\n+$/g, "");
    }
    return setSectionStringValue(sectionText, key, value);
}
function setOptionalSectionBooleanValue(sectionText, key, value) {
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
function findSectionSpan(text, sectionName) {
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
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function escapeTomlString(value) {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
//# sourceMappingURL=extension.js.map