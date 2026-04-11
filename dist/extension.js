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
const fs = __importStar(require("fs/promises"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const PROFILE_KEY = "codexProfileSwitcher.profiles";
class CodexConfigManager {
    constructor(backupDir) {
        this.backupDir = backupDir;
        this.configPath = path.join(os.homedir(), ".codex", "config.toml");
        this.authPath = path.join(os.homedir(), ".codex", "auth.json");
    }
    async readCurrentState() {
        const result = {
            profileName: "",
            providerName: "",
            baseUrl: "",
            apiKey: "",
            fastResponseEnabled: false,
        };
        const configText = await fs.readFile(this.configPath, "utf8");
        const providerNameMatch = configText.match(/^\s*model_provider\s*=\s*"([^"]+)"/m);
        const providerName = providerNameMatch?.[1] ?? "";
        result.providerName = providerName;
        if (providerName) {
            result.baseUrl = readStringValueFromSection(configText, `model_providers.${providerName}`, "base_url");
            result.fastResponseEnabled =
                readStringValueFromSection(configText, `model_providers.${providerName}`, "service_tier") === "fast";
        }
        try {
            const authText = await fs.readFile(this.authPath, "utf8");
            const authData = JSON.parse(authText);
            result.apiKey = String(authData.OPENAI_API_KEY ?? "");
        }
        catch {
            result.apiKey = "";
        }
        return result;
    }
    async switchProfile(profile) {
        const current = await this.readCurrentState();
        if (!current.providerName) {
            throw new Error("当前 config.toml 中没有找到激活的 model_provider。");
        }
        await fs.mkdir(this.backupDir, { recursive: true });
        const timestamp = createTimestamp();
        await fs.copyFile(this.configPath, path.join(this.backupDir, `config-${timestamp}.toml`));
        try {
            await fs.copyFile(this.authPath, path.join(this.backupDir, `auth-${timestamp}.json`));
        }
        catch {
            // ignore missing auth.json
        }
        const configText = await fs.readFile(this.configPath, "utf8");
        const updatedConfig = updateProviderConfig(configText, current.providerName, profile);
        await fs.writeFile(this.configPath, updatedConfig, "utf8");
        let authPayload = { auth_mode: "apikey" };
        try {
            const authText = await fs.readFile(this.authPath, "utf8");
            authPayload = JSON.parse(authText);
        }
        catch {
            // keep default payload
        }
        authPayload.OPENAI_API_KEY = profile.apiKey;
        await fs.writeFile(this.authPath, JSON.stringify(authPayload, null, 2), "utf8");
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
        const current = await this.configManager.readCurrentState();
        current.profileName = this.resolveCurrentProfileName(current, profiles);
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
        const profiles = this.context.globalState.get(PROFILE_KEY, []);
        return profiles.map((profile) => ({
            ...profile,
            fastResponseEnabled: Boolean(profile.fastResponseEnabled),
        }));
    }
    resolveCurrentProfileName(current, profiles) {
        const matched = profiles.find((profile) => profile.baseUrl === current.baseUrl &&
            profile.apiKey === current.apiKey &&
            profile.fastResponseEnabled === current.fastResponseEnabled);
        return matched?.name ?? "";
    }
    async saveProfiles(profiles) {
        await this.context.globalState.update(PROFILE_KEY, profiles);
    }
    normalizeProfile(input, id) {
        const raw = (input ?? {});
        const profile = {
            id: id ?? createProfileId(),
            name: String(raw.name ?? "").trim(),
            baseUrl: String(raw.baseUrl ?? "").trim(),
            apiKey: String(raw.apiKey ?? "").trim(),
            fastResponseEnabled: Boolean(raw.fastResponseEnabled),
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
    async addProfile(input) {
        const profiles = this.loadProfiles();
        profiles.push(this.normalizeProfile(input));
        await this.saveProfiles(profiles);
        await this.refresh();
        void vscode.window.showInformationMessage("已新增配置。");
    }
    async updateProfile(id, input) {
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
    async deleteProfile(id) {
        if (typeof id !== "string" || !id) {
            throw new Error("请先选择一个配置。");
        }
        const profiles = this.loadProfiles();
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
        await this.configManager.switchProfile(profile);
        void vscode.window.showInformationMessage("Codex 配置已切换，VS Code 即将重载。");
        await vscode.commands.executeCommand("workbench.action.reloadWindow");
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
function readStringValueFromSection(text, sectionName, key) {
    const span = findSectionSpan(text, sectionName);
    if (!span) {
        return "";
    }
    const sectionText = text.slice(span.start, span.end);
    const matcher = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*"([^"]*)"`, "m");
    return sectionText.match(matcher)?.[1] ?? "";
}
function updateProviderConfig(text, providerName, profile) {
    const sectionName = `model_providers.${providerName}`;
    const span = findSectionSpan(text, sectionName);
    if (!span) {
        throw new Error(`没有找到当前激活 provider 的配置段: [${sectionName}]`);
    }
    const current = text.slice(span.start, span.end).replace(/\n+$/g, "");
    let updated = setSectionStringValue(current, "base_url", profile.baseUrl);
    updated = setOptionalSectionStringValue(updated, "service_tier", profile.fastResponseEnabled ? "fast" : undefined);
    const suffix = text.slice(span.end);
    return `${text.slice(0, span.start).replace(/\n+$/g, "")}\n${updated}\n${suffix.replace(/^\n+/g, "")}`;
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