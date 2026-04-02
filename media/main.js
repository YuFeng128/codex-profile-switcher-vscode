(function () {
  const vscode = acquireVsCodeApi();

  const state = {
    profiles: [],
    current: { profileName: "", providerName: "", baseUrl: "", apiKey: "" },
    selectedId: null,
    showApiKey: false,
  };

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function getFormData() {
    return {
      name: document.getElementById("name").value.trim(),
      baseUrl: document.getElementById("baseUrl").value.trim(),
      apiKey: document.getElementById("apiKey").value.trim(),
    };
  }

  function fillForm(profile) {
    document.getElementById("name").value = profile?.name ?? "";
    document.getElementById("baseUrl").value = profile?.baseUrl ?? "";
    document.getElementById("apiKey").value = profile?.apiKey ?? "";
  }

  function render() {
    const currentProfileName = state.current.profileName || "未匹配到已保存配置";
    const currentProvider = state.current.providerName || "未检测到";
    const currentBaseUrl = state.current.baseUrl || "未检测到";
    const items = state.profiles.length
      ? state.profiles
          .map((profile) => {
            const active = profile.id === state.selectedId ? "active" : "";
            return `
              <div class="list-item ${active}" data-id="${escapeHtml(profile.id)}">
                <div class="list-name">${escapeHtml(profile.name)}</div>
                <div class="list-url">${escapeHtml(profile.baseUrl)}</div>
              </div>
            `;
          })
          .join("")
      : `<div class="empty">还没有保存的配置，可以先导入当前配置或手动新增。</div>`;

    document.body.innerHTML = `
      <div class="app">
        <section class="card">
          <div class="title">Codex API 切换</div>
          <div class="current">
            <div>当前配置名称: ${escapeHtml(currentProfileName)}</div>
            <div>当前激活 Provider: ${escapeHtml(currentProvider)}</div>
            <div>当前 API 地址: ${escapeHtml(currentBaseUrl)}</div>
          </div>
          <div class="subtle" style="margin-top:8px;">
            切换时只修改当前激活 provider 的 base_url，以及 auth.json 里的 OPENAI_API_KEY。切换完成后会重载 VS Code 窗口。
          </div>
        </section>

        <section class="card">
          <div class="title">已保存配置</div>
          <div class="list" id="profileList">${items}</div>
          <div class="actions" style="margin-top:10px;">
            <button id="switchBtn">切换选中配置</button>
            <button id="deleteBtn" class="secondary">删除选中</button>
          </div>
        </section>

        <section class="card">
          <div class="title">编辑配置</div>
          <div class="form">
            <label>
              显示名称
              <input id="name" type="text" placeholder="例如：备用线路 A" />
            </label>
            <label>
              API Base URL
              <input id="baseUrl" type="text" placeholder="https://your-api.example.com/v1" />
            </label>
            <label>
              API Key
              <div class="input-with-action">
                <input id="apiKey" type="${state.showApiKey ? "text" : "password"}" placeholder="输入对应 key" />
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
          </div>
          <div class="actions" style="margin-top:12px;">
            <button id="addBtn">新增为新配置</button>
            <button id="updateBtn" class="secondary">保存修改</button>
          </div>
          <div class="actions" style="margin-top:8px;">
            <button id="importBtn" class="ghost">导入当前配置</button>
            <button id="clearBtn" class="ghost">清空表单</button>
          </div>
        </section>
      </div>
    `;

    fillForm(state.profiles.find((item) => item.id === state.selectedId) ?? null);
    bindEvents();
  }

  function bindEvents() {
    document.querySelectorAll(".list-item").forEach((element) => {
      element.addEventListener("click", () => {
        const id = element.getAttribute("data-id");
        state.selectedId = id;
        const profile = state.profiles.find((item) => item.id === id) ?? null;
        fillForm(profile);
        render();
      });
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
      fillForm({
        name: `导入于 ${new Date().toLocaleTimeString("zh-CN", { hour12: false })}`,
        baseUrl: state.current.baseUrl,
        apiKey: state.current.apiKey,
      });
    });

    document.getElementById("clearBtn").addEventListener("click", () => {
      state.selectedId = null;
      fillForm(null);
    });

    document.getElementById("toggleApiKeyBtn").addEventListener("click", () => {
      state.showApiKey = !state.showApiKey;
      const currentData = getFormData();
      render();
      fillForm(currentData);
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
      render();
    }
  });

  vscode.postMessage({ type: "ready" });
}());
