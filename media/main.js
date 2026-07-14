(function () {
  const vscode = acquireVsCodeApi();

  const state = {
    profiles: [],
    current: {
      profileName: "",
      providerName: "",
      providerLabel: "",
      providerKind: "customProvider",
      baseUrl: "",
      apiKey: "",
      fastResponseEnabled: false,
      authMode: "unknown",
      authStrategy: "apikey",
      preferredAuthMethod: "",
      personality: "",
      hasOfficialSnapshot: false,
    },
    selectedId: null,
    showApiKey: false,
    showAdvanced: false,
    editingProfile: null,
  };

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function getEmptyFormData() {
    return {
      name: "",
      kind: "followCurrent",
      providerId: "",
      baseUrl: "",
      apiKey: "",
      fastResponseEnabled: false,
      authStrategy: "apikey",
      writePreferredAuthMethod: false,
      personality: "",
      readonly: false,
    };
  }

  function getFormData() {
    return {
      name: document.getElementById("name").value.trim(),
      kind: document.getElementById("kind").value,
      providerId: document.getElementById("providerId").value.trim(),
      baseUrl: document.getElementById("baseUrl").value.trim(),
      apiKey: document.getElementById("apiKey").value.trim(),
      fastResponseEnabled: document.getElementById("fastResponseEnabled").checked,
      authStrategy: "apikey",
      writePreferredAuthMethod: document.getElementById("writePreferredAuthMethod").checked,
      personality: document.getElementById("personality").value,
    };
  }

  function getSelectedProfile() {
    return state.profiles.find((item) => item.id === state.selectedId) ?? null;
  }

  function cloneProfileForEditing(profile) {
    if (!profile) {
      return getEmptyFormData();
    }

    return {
      name: profile.name ?? "",
      kind: profile.kind ?? "followCurrent",
      providerId: profile.providerId ?? "",
      baseUrl: profile.baseUrl ?? "",
      apiKey: profile.apiKey ?? "",
      fastResponseEnabled: Boolean(profile.fastResponseEnabled),
      authStrategy: "apikey",
      writePreferredAuthMethod: Boolean(profile.writePreferredAuthMethod),
      personality: profile.personality ?? "",
      readonly: Boolean(profile.readonly),
    };
  }

  function getEditingProfile() {
    return state.editingProfile ?? getEmptyFormData();
  }

  function fillForm(profile) {
    const data = cloneProfileForEditing(profile);
    const formKind = data.kind === "officialSnapshot"
      ? "followCurrent"
      : data.kind ?? "followCurrent";
    document.getElementById("name").value = data.name ?? "";
    document.getElementById("kind").value = formKind;
    document.getElementById("providerId").value = data.providerId ?? "";
    document.getElementById("baseUrl").value = data.baseUrl ?? "";
    document.getElementById("apiKey").value = data.apiKey ?? "";
    document.getElementById("fastResponseEnabled").checked = Boolean(data.fastResponseEnabled);
    document.getElementById("writePreferredAuthMethod").checked = Boolean(data.writePreferredAuthMethod);
    document.getElementById("personality").value = data.personality ?? "";
    applyFormVisibility(data.readonly ?? false);
  }

  function formatProviderKind(kind) {
    switch (kind) {
      case "builtinOpenai":
        return "官方线路";
      case "customOpenaiAuth":
        return "自定义线路";
      default:
        return "自定义线路";
    }
  }

  function formatProfileKind(kind) {
    switch (kind) {
      case "followCurrent":
        return "沿用当前线路";
      case "builtinOpenai":
        return "官方线路";
      case "officialSnapshot":
        return "原有账号备份";
      default:
        return "自定义线路";
    }
  }

  function formatAuthMode(mode) {
    switch (mode) {
      case "apiKey":
        return "API Key";
      case "chatgpt":
        return "已登录 OpenAI 账号";
      case "accessToken":
        return "访问令牌";
      case "loggedOut":
        return "未登录";
      default:
        return "未识别";
    }
  }

  function renderProfileList() {
    if (!state.profiles.length) {
      return `<div class="empty">还没有保存的配置，可以先导入当前配置或手动新增。</div>`;
    }

    return state.profiles
      .map((profile) => {
        const active = profile.id === state.selectedId ? "active" : "";
        const fastBadgeClass = profile.fastResponseEnabled ? "list-badge" : "list-badge muted";
        const fastBadgeText = profile.fastResponseEnabled ? "快速响应" : "标准响应";
        const typeBadgeClass = profile.kind === "officialSnapshot" ? "list-badge warning" : "list-badge secondary";

        return `
          <div class="list-item ${active}" data-id="${escapeHtml(profile.id)}">
            <div class="list-head">
              <div class="list-name">${escapeHtml(profile.name)}</div>
              <span class="${typeBadgeClass}">${escapeHtml(formatProfileKind(profile.kind))}</span>
            </div>
            <div class="list-meta">
              <span class="${fastBadgeClass}">${escapeHtml(fastBadgeText)}</span>
            </div>
            <div class="list-url">${escapeHtml(profile.baseUrl || "切换到这里即可回到原来的账号")}</div>
          </div>
        `;
      })
      .join("");
  }

  function render() {
    const currentProfileName = state.current.profileName || "未匹配到已保存配置";
    const currentBaseUrl = state.current.baseUrl || "使用默认地址";
    const currentFastResponse = state.current.fastResponseEnabled ? "已开启" : "未开启";
    const currentSnapshot = state.current.hasOfficialSnapshot ? "已保存" : "未保存";
    const selectedProfile = getSelectedProfile();
    const editingProfile = getEditingProfile();

    document.body.innerHTML = `
      <div class="app">
        <section class="promo-banner">
          <div class="promo-label">AI 技术交流群</div>
          <div class="promo-value">1060173874</div>
        </section>

        <section class="card card-current">
          <div class="title">Codex API 切换</div>
          <div class="current">
            <div>当前配置名称: ${escapeHtml(currentProfileName)}</div>
            <div>当前线路类型: ${escapeHtml(formatProviderKind(state.current.providerKind))}</div>
            <div>当前登录状态: ${escapeHtml(formatAuthMode(state.current.authMode))}</div>
            <div>当前服务地址: ${escapeHtml(currentBaseUrl)}</div>
            <div>快速响应: ${escapeHtml(currentFastResponse)}</div>
            <div>原有账号备份: ${escapeHtml(currentSnapshot)}</div>
          </div>
        </section>

        <section class="card card-saved">
          <div class="title">已保存配置</div>
          <div class="list" id="profileList">${renderProfileList()}</div>
          <div class="actions" style="margin-top:10px;">
            <button id="switchBtn">切换选中配置</button>
            <button id="deleteBtn" class="secondary">删除选中</button>
          </div>
        </section>

        <section class="card card-editor">
          <div class="title">编辑配置</div>
          ${editingProfile.readonly ? `<div class="notice">当前选中的是“原有账号备份”。切换到它就会回到原来的账号；它只能切换或删除，不能直接修改。</div>` : ""}
          <div class="form">
            <label>
              显示名称
              <input id="name" type="text" placeholder="例如：Hongyun OpenAI" />
            </label>
            <label>
              线路类型
              <select id="kind">
                <option value="followCurrent">沿用当前线路（推荐）</option>
                <option value="builtinOpenai">官方线路地址</option>
                <option value="customProvider">独立线路配置</option>
              </select>
            </label>
            <label id="providerIdField">
              线路标识
              <input id="providerId" type="text" placeholder="例如：crs" />
            </label>
            <label>
              服务地址
              <input id="baseUrl" type="text" placeholder="https://your-api.example.com/v1" />
            </label>
            <label id="apiKeyField">
              API Key
              <div class="input-with-action">
                <input id="apiKey" type="${state.showApiKey ? "text" : "password"}" placeholder="输入这套配置要使用的 Key" />
                <button id="toggleApiKeyBtn" type="button" class="icon-button ghost" title="${state.showApiKey ? "隐藏 API Key" : "显示 API Key"}" aria-label="${state.showApiKey ? "隐藏 API Key" : "显示 API Key"}">
                  ${
                    state.showApiKey
                      ? `
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path d="M3 12C4.8 8.5 8 6 12 6C16 6 19.2 8.5 21 12C19.2 15.5 16 18 12 18C8 18 4.8 15.5 3 12Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                          <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/>
                        </svg>
                      `
                      : `
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path d="M4 4L20 20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                          <path d="M10.7 6.3C11.13 6.1 11.56 6 12 6C16 6 19.2 8.5 21 12C20.22 13.51 19.17 14.81 17.9 15.88M14.1 17.68C13.42 17.89 12.72 18 12 18C8 18 4.8 15.5 3 12C3.94 10.18 5.29 8.67 6.9 7.58" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                          <path d="M9.88 9.88C9.34 10.42 9 11.17 9 12C9 13.66 10.34 15 12 15C12.83 15 13.58 14.66 14.12 14.12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                      `
                  }
                </button>
              </div>
            </label>
            <button id="advancedToggleBtn" type="button" class="advanced-toggle ${state.showAdvanced ? "open" : ""}">
              <span>高级设置</span>
              <span class="advanced-arrow">${state.showAdvanced ? "收起" : "展开"}</span>
            </button>
            <div id="advancedPanel" class="advanced-panel ${state.showAdvanced ? "open" : ""}">
              <label class="checkbox-row" for="fastResponseEnabled">
                <input id="fastResponseEnabled" type="checkbox" />
                <span>优先使用更快响应</span>
              </label>
              <label class="checkbox-row" for="writePreferredAuthMethod">
                <input id="writePreferredAuthMethod" type="checkbox" />
                <span>旧版 Codex 优先使用 Key 登录</span>
              </label>
              <label>
                表达风格
                <select id="personality">
                  <option value="">跟随 Codex 默认</option>
                  <option value="none">简洁中性</option>
                  <option value="friendly">友好亲和</option>
                  <option value="pragmatic">务实直接</option>
                </select>
              </label>
              <div class="subtle">
                旧版登录偏好只影响旧版 Codex 的登录选择。表达风格使用官方支持的 none、friendly、pragmatic 三种值；不确定时保持默认即可。
              </div>
            </div>
            <div class="subtle" id="formHint"></div>
          </div>
          <div class="actions" style="margin-top:12px;">
            <button id="updateBtn" class="secondary">保存修改</button>
            <button id="addBtn">新增为新配置</button>
          </div>
          <div class="actions" style="margin-top:8px;">
            <button id="importBtn" class="ghost">导入当前配置</button>
            <button id="clearBtn" class="ghost">清空表单</button>
          </div>
        </section>
      </div>
    `;

    fillForm(editingProfile);
    bindEvents();
  }

  function applyFormVisibility(readonly) {
    const kind = document.getElementById("kind").value;
    const isFollowCurrent = kind === "followCurrent";
    const isBuiltin = kind === "builtinOpenai";

    document.getElementById("providerIdField").style.display = isFollowCurrent || isBuiltin ? "none" : "grid";
    document.getElementById("apiKey").disabled = readonly;
    document.getElementById("kind").disabled = readonly;
    document.getElementById("providerId").disabled = readonly;
    document.getElementById("baseUrl").disabled = readonly;
    document.getElementById("writePreferredAuthMethod").disabled = readonly;
    document.getElementById("fastResponseEnabled").disabled = readonly;
    document.getElementById("personality").disabled = readonly;
    document.getElementById("name").disabled = readonly;
    document.getElementById("addBtn").disabled = readonly;
    document.getElementById("updateBtn").disabled = readonly;

    const hint = [];
    if (isFollowCurrent) {
      hint.push("推荐选项。切换时会按当前 Codex 配置自动判断线路，尽量避免聊天记录分散。");
    } else if (isBuiltin) {
      hint.push("官方线路地址适合大多数情况，也更不容易让聊天记录分散到不同线路。");
    } else {
      hint.push("独立线路配置适合必须使用单独线路标识的服务；切换时会只保留这一条线路配置。");
    }
    if (!isFollowCurrent) {
      hint.push("固定线路可能让聊天记录分散到另一条线路；保存时会再次提醒你确认。");
    }
    hint.push("切换时会把这里填写的 Key 设为当前使用的 Key。");
    document.getElementById("formHint").innerHTML = hint.map((item) => `<div>${escapeHtml(item)}</div>`).join("");
  }

  function importCurrentConfig() {
    state.editingProfile = cloneProfileForEditing({
      name: `导入于 ${new Date().toLocaleTimeString("zh-CN", { hour12: false })}`,
      kind: "followCurrent",
      providerId: state.current.providerName,
      baseUrl: state.current.baseUrl,
      apiKey: state.current.apiKey,
      fastResponseEnabled: state.current.fastResponseEnabled,
      authStrategy: "apikey",
      writePreferredAuthMethod: state.current.preferredAuthMethod === "apikey",
      personality: state.current.personality ?? "",
      readonly: false,
    });
    render();
  }

  function bindEvents() {
    document.querySelectorAll(".list-item").forEach((element) => {
      element.addEventListener("click", () => {
        state.selectedId = element.getAttribute("data-id");
        state.editingProfile = cloneProfileForEditing(getSelectedProfile());
        render();
      });
    });

    document.getElementById("kind").addEventListener("change", () => {
      state.editingProfile = { ...getFormData(), readonly: Boolean(getEditingProfile().readonly) };
      applyFormVisibility(Boolean(getEditingProfile().readonly));
    });

    document.getElementById("advancedToggleBtn").addEventListener("click", () => {
      const currentData = getFormData();
      const readonly = Boolean(getEditingProfile().readonly);
      state.editingProfile = { ...currentData, readonly };
      state.showAdvanced = !state.showAdvanced;
      render();
      fillForm({ ...currentData, readonly });
    });

    document.getElementById("addBtn").addEventListener("click", () => {
      vscode.postMessage({ type: "addProfile", profile: getFormData() });
    });

    document.getElementById("updateBtn").addEventListener("click", () => {
      vscode.postMessage({ type: "updateProfile", id: state.selectedId, profile: getFormData() });
    });

    document.getElementById("deleteBtn").addEventListener("click", () => {
      vscode.postMessage({ type: "deleteProfile", id: state.selectedId });
    });

    document.getElementById("switchBtn").addEventListener("click", () => {
      vscode.postMessage({ type: "switchProfile", id: state.selectedId });
    });

    document.getElementById("importBtn").addEventListener("click", () => {
      state.selectedId = null;
      importCurrentConfig();
    });

    document.getElementById("clearBtn").addEventListener("click", () => {
      state.selectedId = null;
      state.editingProfile = getEmptyFormData();
      render();
    });

    document.getElementById("toggleApiKeyBtn").addEventListener("click", () => {
      state.showApiKey = !state.showApiKey;
      const currentData = getFormData();
      const readonly = Boolean(getEditingProfile().readonly);
      state.editingProfile = { ...currentData, readonly };
      render();
      fillForm({ ...currentData, readonly });
    });
  }

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type === "state") {
      state.profiles = message.profiles;
      state.current = message.current;
      if (state.selectedId && !state.profiles.find((item) => item.id === state.selectedId)) {
        state.selectedId = null;
      }
      state.editingProfile = state.selectedId
        ? cloneProfileForEditing(getSelectedProfile())
        : getEmptyFormData();
      render();
    }
  });

  vscode.postMessage({ type: "ready" });
}());
