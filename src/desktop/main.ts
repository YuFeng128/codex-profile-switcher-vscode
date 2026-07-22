import { execFile } from "child_process";
import { app, BrowserWindow, Menu, ipcMain, shell } from "electron";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { promisify } from "util";

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
  fullAccessEnabled: boolean;
  hasOfficialSnapshot: boolean;
  configPath: string;
  authPath: string;
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
  fullAccessEnabled: boolean;
  readonly: boolean;
  minimalConfig?: boolean;
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

type StoreFile = {
  profiles?: unknown[];
  officialSnapshot?: OfficialSnapshotRecord;
};

const execFileAsync = promisify(execFile);

const OFFICIAL_SNAPSHOT_PROFILE_ID = "__official_snapshot__";
const OFFICIAL_SNAPSHOT_PROFILE_NAME = "原有账号配置备份";
const HONGYUN_BASE_URL = "https://ai.hongyun.chat/v1";
const HONGYUN_PROFILE_NAME = "Hongyun OpenAI";
const HONGYUN_PROVIDER_ID = "hongyun";

class CodexConfigManager {
  public readonly configPath = path.join(os.homedir(), ".codex", "config.toml");
  public readonly authPath = path.join(os.homedir(), ".codex", "auth.json");

  constructor(private readonly backupDir: string) {}

  async ensureConfigFile(): Promise<void> {
    await fs.mkdir(path.dirname(this.configPath), { recursive: true });
    try {
      await fs.access(this.configPath);
    } catch {
      await fs.writeFile(this.configPath, 'model_provider = "openai"\n', "utf8");
    }
  }

  async readCurrentState(): Promise<CurrentState> {
    await this.ensureConfigFile();
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
      fullAccessEnabled: isFullAccessConfig(configText),
      hasOfficialSnapshot: false,
      configPath: this.configPath,
      authPath: this.authPath,
    };
  }

  async switchProfile(profile: Profile): Promise<void> {
    await this.ensureConfigFile();
    await this.backupCurrentFiles();

    const configText = await fs.readFile(this.configPath, "utf8");
    let updatedConfig = configText;
    const current = await this.readCurrentState();

    if (profile.minimalConfig) {
      updatedConfig = updateCurrentRouteBaseUrlConfig(configText, current, profile);
    } else if (profile.kind === "followCurrent") {
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
    await this.ensureConfigFile();
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
    await this.ensureConfigFile();
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

    await this.writeApiKeyAuth(profile.apiKey);
  }

  private async writeApiKeyAuth(apiKey: string): Promise<void> {
    const authPayload: Record<string, unknown> = {
      auth_mode: "apikey",
      OPENAI_API_KEY: apiKey,
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

class DesktopStore {
  private readonly filePath = path.join(app.getPath("userData"), "profiles.json");

  async load(): Promise<StoreFile> {
    try {
      const text = await fs.readFile(this.filePath, "utf8");
      return JSON.parse(text) as StoreFile;
    } catch {
      return {};
    }
  }

  async save(next: StoreFile): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(next, null, 2), "utf8");
  }
}

let mainWindow: BrowserWindow | undefined;
let configManager: CodexConfigManager;
let store: DesktopStore;

async function createWindow(): Promise<void> {
  configManager = new CodexConfigManager(path.join(app.getPath("userData"), "backups"));
  store = new DesktopStore();
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1180,
    minHeight: 720,
    backgroundColor: "#ffffff",
    title: "ChatGPT Hongyun Configurator",
    icon: path.join(__dirname, "../../media/icon.svg"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await mainWindow.loadFile(path.join(__dirname, "../../desktop/index.html"));

  if (process.env.CODEX_DESKTOP_SMOKE === "1") {
    setTimeout(() => app.quit(), 1500);
  }
}

app.whenReady().then(async () => {
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.handle("app:openPath", async (_event, targetPath: string) => {
  if (!targetPath) {
    return;
  }
  await shell.showItemInFolder(targetPath);
});

ipcMain.handle("profiles:getState", async () => getApplicationState());

ipcMain.handle("profiles:add", async (_event, input: unknown) => {
  const file = await store.load();
  const profiles = loadStoredProfiles(file).filter((profile) => profile.kind !== "officialSnapshot");
  const profile = normalizeProfile(input);
  profiles.push(profile);
  await store.save({ ...file, profiles });
  return getApplicationState();
});

ipcMain.handle("profiles:update", async (_event, id: unknown, input: unknown) => {
  if (typeof id !== "string" || !id) {
    throw new Error("请先选择一个配置，再保存修改。");
  }
  if (id === OFFICIAL_SNAPSHOT_PROFILE_ID) {
    throw new Error("原有账号备份不能直接修改。");
  }

  const file = await store.load();
  const profiles = loadStoredProfiles(file).filter((profile) => profile.kind !== "officialSnapshot");
  const index = profiles.findIndex((item) => item.id === id);
  if (index < 0) {
    throw new Error("当前选中的配置不存在。");
  }
  profiles[index] = normalizeProfile(input, id);
  await store.save({ ...file, profiles });
  return getApplicationState();
});

ipcMain.handle("profiles:delete", async (_event, id: unknown) => {
  if (typeof id !== "string" || !id) {
    throw new Error("请先选择一个配置。");
  }

  const file = await store.load();
  if (id === OFFICIAL_SNAPSHOT_PROFILE_ID) {
    await store.save({ ...file, officialSnapshot: undefined });
    return getApplicationState();
  }

  const profiles = loadStoredProfiles(file)
    .filter((profile) => profile.kind !== "officialSnapshot")
    .filter((profile) => profile.id !== id);
  await store.save({ ...file, profiles });
  return getApplicationState();
});

ipcMain.handle("profiles:switch", async (_event, id: unknown) => {
  if (typeof id !== "string" || !id) {
    throw new Error("请先选择一个配置。");
  }

  const file = await store.load();
  const profiles = loadStoredProfiles(file);
  const profile = profiles.find((item) => item.id === id);
  if (!profile) {
    throw new Error("当前选中的配置不存在。");
  }

  if (profile.kind !== "officialSnapshot") {
    await captureOfficialSnapshotIfNeeded(file);
    await configManager.switchProfile(profile);
  } else {
    const snapshot = loadOfficialSnapshot(file);
    if (!snapshot) {
      throw new Error("没有找到原有账号备份。");
    }
    await configManager.restoreOfficialSnapshot(snapshot);
  }

  return getApplicationState();
});

ipcMain.handle("hongyun:autoConfigure", async (_event, apiKey: unknown) => {
  const normalizedApiKey = String(apiKey ?? "").trim();
  if (!normalizedApiKey) {
    throw new Error("请先填写 Hongyun API Key。");
  }

  const file = await store.load();
  await captureOfficialSnapshotIfNeeded(file);
  const current = await configManager.readCurrentState();
  const profile = createHongyunProfile(normalizedApiKey, current);
  const profiles = upsertHongyunProfile(loadStoredProfiles(file), profile);
  await store.save({ ...(await store.load()), profiles });
  await configManager.switchProfile(profile);
  return getApplicationState();
});

async function getApplicationState(): Promise<{
  profiles: Profile[];
  current: CurrentState;
  hongyun: { baseUrl: string; providerId: string; profileName: string };
}> {
  const file = await store.load();
  const profiles = loadStoredProfiles(file);
  const snapshot = loadOfficialSnapshot(file);
  const current = await configManager.readCurrentState();
  current.profileName = snapshot && await currentFilesMatchSnapshot(snapshot)
    ? OFFICIAL_SNAPSHOT_PROFILE_NAME
    : resolveCurrentProfileName(current, profiles);
  current.hasOfficialSnapshot = Boolean(snapshot);

  return {
    profiles,
    current,
    hongyun: {
      baseUrl: HONGYUN_BASE_URL,
      providerId: HONGYUN_PROVIDER_ID,
      profileName: HONGYUN_PROFILE_NAME,
    },
  };
}

async function captureOfficialSnapshotIfNeeded(file: StoreFile): Promise<void> {
  if (loadOfficialSnapshot(file)) {
    return;
  }

  const current = await configManager.readCurrentState();
  if (!isOfficialLikeState(current)) {
    return;
  }

  const files = await configManager.readRawFiles();
  const snapshotProfile: Profile = {
    id: OFFICIAL_SNAPSHOT_PROFILE_ID,
    name: OFFICIAL_SNAPSHOT_PROFILE_NAME,
    kind: "officialSnapshot",
    baseUrl: current.baseUrl,
    apiKey: "",
    fastResponseEnabled: current.fastResponseEnabled,
    providerId: current.providerName,
    authStrategy: "preserve",
    writePreferredAuthMethod: false,
    personality: current.personality,
    fullAccessEnabled: current.fullAccessEnabled,
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

  await store.save({ ...file, officialSnapshot: snapshot });
}

function loadStoredProfiles(file: StoreFile): Profile[] {
  const profiles = (file.profiles ?? [])
    .map((profile) => restoreStoredProfile(profile))
    .filter((profile): profile is Profile => Boolean(profile));

  const snapshot = loadOfficialSnapshot(file);
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

function loadOfficialSnapshot(file: StoreFile): OfficialSnapshotRecord | undefined {
  const raw = file.officialSnapshot;
  if (!raw || !raw.profile) {
    return undefined;
  }

  const restoredProfile = restoreStoredProfile(raw.profile);
  if (!restoredProfile) {
    return undefined;
  }

  return {
    ...raw,
    profile: {
      ...restoredProfile,
      id: OFFICIAL_SNAPSHOT_PROFILE_ID,
      name: OFFICIAL_SNAPSHOT_PROFILE_NAME,
      kind: "officialSnapshot",
      readonly: true,
    },
  };
}

async function currentFilesMatchSnapshot(snapshot: OfficialSnapshotRecord): Promise<boolean> {
  const files = await configManager.readRawFiles();
  return files.configText === snapshot.configText && files.authText === snapshot.authText;
}

function resolveCurrentProfileName(current: CurrentState, profiles: Profile[]): string {
  const matched = profiles.find((profile) => profileMatchesCurrentState(profile, current));
  return matched?.name ?? "";
}

function profileMatchesCurrentState(profile: Profile, current: CurrentState): boolean {
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

  const optionalSettingsMatch = profile.minimalConfig
    || (profile.fastResponseEnabled === current.fastResponseEnabled && profile.personality === current.personality);
  const fullAccessMatches = profile.fullAccessEnabled === current.fullAccessEnabled;

  return kindMatches
    && providerMatches
    && profile.baseUrl === current.baseUrl
    && profile.authStrategy === current.authStrategy
    && optionalSettingsMatch
    && fullAccessMatches
    && apiKeyMatches;
}

function restoreStoredProfile(input: unknown): Profile | undefined {
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
    fullAccessEnabled: Boolean(raw.fullAccessEnabled),
    readonly: Boolean(raw.readonly),
    minimalConfig: Boolean(raw.minimalConfig),
  };

  if (!profile.name || (profile.kind !== "officialSnapshot" && !profile.baseUrl)) {
    return undefined;
  }

  if (profile.kind === "builtinOpenai") {
    profile.providerId = "openai";
  }

  return profile;
}

function normalizeProfile(input: unknown, id?: string): Profile {
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
    fullAccessEnabled: Boolean(raw.fullAccessEnabled),
    readonly: false,
    minimalConfig: Boolean(raw.minimalConfig),
  };

  if (!profile.name) {
    throw new Error("显示名称不能为空。");
  }
  if (!profile.baseUrl.startsWith("http://") && !profile.baseUrl.startsWith("https://")) {
    throw new Error("API Base URL 必须以 http:// 或 https:// 开头。");
  }
  if (profile.kind === "customProvider" && !profile.providerId) {
    throw new Error("自定义供应商模式必须填写供应商 ID。");
  }
  if (profile.authStrategy === "apikey" && !profile.apiKey) {
    throw new Error("API Key 不能为空。");
  }

  return profile;
}

function createHongyunProfile(apiKey: string, current: CurrentState): Profile {
  return {
    id: HONGYUN_PROVIDER_ID,
    name: HONGYUN_PROFILE_NAME,
    kind: "followCurrent",
    baseUrl: HONGYUN_BASE_URL,
    apiKey,
    fastResponseEnabled: false,
    providerId: current.providerName,
    authStrategy: "apikey",
    writePreferredAuthMethod: false,
    personality: "",
    fullAccessEnabled: true,
    readonly: false,
    minimalConfig: true,
  };
}

function upsertHongyunProfile(profiles: Profile[], profile: Profile): Profile[] {
  const editableProfiles = profiles.filter((item) => item.kind !== "officialSnapshot");
  const index = editableProfiles.findIndex((item) => item.id === profile.id || item.name === profile.name);
  if (index >= 0) {
    editableProfiles[index] = profile;
    return editableProfiles;
  }
  return [profile, ...editableProfiles];
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
  updated = setFullAccessConfig(updated, profile.fullAccessEnabled);
  return updated;
}

function updateCurrentRouteBaseUrlConfig(text: string, current: CurrentState, profile: Profile): string {
  if (current.providerKind === "builtinOpenai" || current.providerName === "openai" || !current.providerName) {
    let updated = setTopLevelStringValue(text, "model_provider", "openai");
    updated = setTopLevelStringValue(updated, "openai_base_url", profile.baseUrl);
    updated = setFullAccessConfig(updated, profile.fullAccessEnabled);
    return updated;
  }

  let updated = setTopLevelStringValue(text, "model_provider", current.providerName);
  updated = upsertSection(updated, `model_providers.${current.providerName}`, (sectionText) => {
    return setSectionStringValue(sectionText, "base_url", profile.baseUrl);
  });
  updated = setFullAccessConfig(updated, profile.fullAccessEnabled);
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
    throw new Error("没有可写入的供应商 ID。");
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
  updated = setFullAccessConfig(updated, profile.fullAccessEnabled);
  return updated;
}

function normalizePersonality(value: unknown): Personality {
  if (value === "none" || value === "friendly" || value === "pragmatic") {
    return value;
  }
  return "";
}

function isFullAccessConfig(text: string): boolean {
  return readTopLevelStringValue(text, "sandbox_mode") === "danger-full-access"
    && readTopLevelStringValue(text, "approval_policy") === "never";
}

function setFullAccessConfig(text: string, enabled: boolean): string {
  let updated = setOptionalTopLevelStringValue(text, "sandbox_mode", enabled ? "danger-full-access" : undefined);
  updated = setOptionalTopLevelStringValue(updated, "approval_policy", enabled ? "never" : undefined);
  return updated;
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
