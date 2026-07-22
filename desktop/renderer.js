(function () {
  const api = window.codexDesktop || createPreviewApi();

  const state = {
    profiles: [],
    current: null,
    hongyun: {
      baseUrl: "https://ai.hongyun.chat/v1",
      providerId: "hongyun",
      profileName: "Hongyun OpenAI",
    },
    selectedId: null,
    editingProfile: null,
    editorOpen: false,
    showApiKey: false,
    showHongyunKey: false,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function toast(message, tone) {
    const element = $("toast");
    element.textContent = message;
    element.className = `toast ${tone || "info"}`;
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => {
      element.className = "toast hidden";
    }, 3000);
  }

  async function run(action, successMessage) {
    try {
      const nextState = await action();
      if (nextState) {
        applyState(nextState);
      }
      if (successMessage) {
        toast(successMessage, "success");
      }
      return true;
    } catch (error) {
      toast(error && error.message ? error.message : String(error), "error");
      return false;
    }
  }

  function emptyProfile() {
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
      fullAccessEnabled: false,
      readonly: false,
      minimalConfig: false,
    };
  }

  function cloneProfile(profile) {
    if (!profile) {
      return emptyProfile();
    }
    return {
      name: profile.name || "",
      kind: profile.kind === "officialSnapshot" ? "followCurrent" : profile.kind || "followCurrent",
      providerId: profile.providerId || "",
      baseUrl: profile.baseUrl || "",
      apiKey: profile.apiKey || "",
      fastResponseEnabled: Boolean(profile.fastResponseEnabled),
      authStrategy: profile.authStrategy || "apikey",
      writePreferredAuthMethod: Boolean(profile.writePreferredAuthMethod),
      personality: profile.personality || "",
      fullAccessEnabled: Boolean(profile.fullAccessEnabled),
      readonly: Boolean(profile.readonly),
      minimalConfig: Boolean(profile.minimalConfig),
    };
  }

  function formData() {
    const currentEditing = editingProfile();
    return {
      name: $("name").value.trim(),
      kind: $("kind").value,
      providerId: $("providerId").value.trim(),
      baseUrl: $("baseUrl").value.trim(),
      apiKey: $("apiKey").value.trim(),
      fastResponseEnabled: $("fastResponseEnabled").checked,
      authStrategy: "apikey",
      writePreferredAuthMethod: $("writePreferredAuthMethod").checked,
      personality: $("personality").value,
      fullAccessEnabled: $("fullAccessEnabled").checked,
      minimalConfig: Boolean(currentEditing.minimalConfig),
    };
  }

  function selectedProfile() {
    return state.profiles.find((profile) => profile.id === state.selectedId) || null;
  }

  function editingProfile() {
    return state.editingProfile || emptyProfile();
  }

  function formatProviderKind(kind) {
    if (kind === "builtinOpenai") {
      return "官方线路";
    }
    if (kind === "customOpenaiAuth") {
      return "自定义 OpenAI 认证线路";
    }
    return "自定义线路";
  }

  function formatProfileKind(kind) {
    if (kind === "followCurrent") {
      return "沿用当前线路";
    }
    if (kind === "builtinOpenai") {
      return "官方线路地址";
    }
    if (kind === "officialSnapshot") {
      return "原有账号备份";
    }
    return "独立线路配置";
  }

  function formatAuthMode(mode) {
    if (mode === "apiKey") {
      return "API Key";
    }
    if (mode === "chatgpt") {
      return "已登录 OpenAI 账号";
    }
    if (mode === "accessToken") {
      return "访问令牌";
    }
    if (mode === "loggedOut") {
      return "未登录";
    }
    return "未识别";
  }

  function statusRows() {
    const current = state.current || {};
    return [
      ["当前配置", current.profileName || "未匹配到已保存配置"],
      ["线路类型", formatProviderKind(current.providerKind)],
      ["登录状态", formatAuthMode(current.authMode)],
      ["供应商", current.providerName || "默认"],
      ["服务地址", current.baseUrl || "使用默认地址"],
      ["快速响应", current.fastResponseEnabled ? "已开启" : "未开启"],
      ["原有账号备份", current.hasOfficialSnapshot ? "已保存" : "未保存"],
    ];
  }

  function renderStatus() {
    const current = state.current || {};
    $("activeProfileName").textContent = current.profileName || "未匹配到已保存配置";
    $("activeBaseUrl").textContent = current.baseUrl || "使用默认地址";
    $("activeAuthMode").textContent = formatAuthMode(current.authMode);
    $("snapshotState").textContent = current.hasOfficialSnapshot ? "已保存" : "未保存";
  }

  function isProfileCurrent(profile) {
    return Boolean(profile && state.current && profile.name === state.current.profileName);
  }

  function renderProfiles() {
    if (!state.profiles.length) {
      $("profileList").innerHTML = '<div class="empty">还没有保存的供应商。可以先点右上角加号添加，或直接一键配置 Hongyun。</div>';
      return;
    }

    $("profileList").innerHTML = state.profiles.map((profile) => {
      const active = profile.id === state.selectedId ? "active" : "";
      const fast = profile.minimalConfig ? "仅地址和 Key" : profile.fastResponseEnabled ? "快速响应" : "标准响应";
      const access = profile.fullAccessEnabled ? "Full Access" : "常规权限";
      const snapshot = profile.kind === "officialSnapshot" ? "snapshot" : "";
      const isCurrent = isProfileCurrent(profile);
      const current = isCurrent ? "current" : "";
      const switchLabel = isCurrent ? "已启用" : "启用";
      const switchDisabled = isCurrent ? "disabled aria-disabled=\"true\"" : "";
      const logoText = profile.kind === "officialSnapshot" ? "↩" : (profile.name || "G").trim().slice(0, 1).toUpperCase();
      return `
        <article class="provider-row ${active} ${snapshot} ${current}" data-id="${escapeHtml(profile.id)}">
          <div class="drag-dots" aria-hidden="true"></div>
          <div class="provider-logo">${escapeHtml(logoText)}</div>
          <div class="provider-main">
            <div class="provider-title-line">
              <div class="provider-name">${escapeHtml(profile.name)}</div>
              ${isCurrent ? '<span class="current-badge">当前使用</span>' : ""}
            </div>
            <div class="provider-url">${escapeHtml(profile.baseUrl || "启用此备份即可恢复原来的账号")}</div>
          </div>
          <div class="provider-side">
            <div class="provider-meta">
              <span>${escapeHtml(fast)}</span>
              <span>${escapeHtml(access)}</span>
              <span>${escapeHtml(formatProfileKind(profile.kind))}</span>
            </div>
            <div class="provider-actions">
              <button type="button" class="row-button" data-action="edit" data-id="${escapeHtml(profile.id)}">编辑</button>
              <button type="button" class="row-button primary" data-action="switch" data-id="${escapeHtml(profile.id)}" ${switchDisabled}>${switchLabel}</button>
            </div>
          </div>
        </article>
      `;
    }).join("");

    document.querySelectorAll(".provider-row").forEach((element) => {
      element.addEventListener("click", () => {
        state.selectedId = element.getAttribute("data-id");
        state.editingProfile = cloneProfile(selectedProfile());
        render();
      });
    });

    document.querySelectorAll(".provider-actions button").forEach((element) => {
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        const id = element.getAttribute("data-id");
        const action = element.getAttribute("data-action");
        state.selectedId = id;
        state.editingProfile = cloneProfile(selectedProfile());
        if (element.disabled) {
          render();
          return;
        }
        if (action === "edit") {
          state.editorOpen = true;
        }
        render();
        if (action === "switch") {
          run(() => api.switchProfile(id), "配置已启用。");
        }
      });
    });
  }

  function fillForm() {
    const profile = editingProfile();
    $("name").value = profile.name || "";
    $("kind").value = profile.kind || "followCurrent";
    $("providerId").value = profile.providerId || "";
    $("baseUrl").value = profile.baseUrl || "";
    $("apiKey").value = profile.apiKey || "";
    $("fastResponseEnabled").checked = Boolean(profile.fastResponseEnabled);
    $("writePreferredAuthMethod").checked = Boolean(profile.writePreferredAuthMethod);
    $("personality").value = profile.personality || "";
    $("fullAccessEnabled").checked = Boolean(profile.fullAccessEnabled);
    applyFormVisibility(Boolean(profile.readonly));
  }

  function applyFormVisibility(readonly) {
    const kind = $("kind").value;
    const showProvider = kind === "customProvider";
    $("providerIdField").classList.toggle("hidden", !showProvider);
    $("readonlyNotice").classList.toggle("hidden", !readonly);

    ["name", "kind", "providerId", "baseUrl", "apiKey", "fastResponseEnabled", "writePreferredAuthMethod", "fullAccessEnabled", "personality", "updateBtn"]
      .forEach((id) => {
        $(id).disabled = readonly;
      });

    const hints = [];
    if (kind === "followCurrent") {
      hints.push("切换时会沿用当前供应商，只改地址、Key、响应档位和表达风格。");
    } else if (kind === "builtinOpenai") {
      hints.push("会写入 model_provider = \"openai\" 和 openai_base_url。");
    } else {
      hints.push("会写入独立供应商配置，并只保留目标供应商段。");
    }
    hints.push("勾选 Full Access 会写入 sandbox_mode = \"danger-full-access\" 和 approval_policy = \"never\"。");
    hints.push("启用配置前会自动备份当前 config.toml 和 auth.json。");
    $("formHint").innerHTML = hints.map((item) => `<div>${escapeHtml(item)}</div>`).join("");
  }

  function render() {
    $("hongyunBaseUrl").textContent = state.hongyun.baseUrl;
    $("apiKey").type = state.showApiKey ? "text" : "password";
    $("hongyunApiKey").type = state.showHongyunKey ? "text" : "password";
    $("toggleApiKeyBtn").textContent = state.showApiKey ? "隐藏" : "显示";
    $("toggleHongyunKeyBtn").textContent = state.showHongyunKey ? "隐藏" : "显示";
    $("updateBtn").textContent = state.selectedId ? "保存修改" : "＋ 添加";
    $("modalTitle").textContent = state.selectedId ? "编辑 ChatGPT 供应商" : "添加 ChatGPT 供应商";
    const selected = selectedProfile();
    const selectedIsCurrent = isProfileCurrent(selected);
    $("deleteBtn").disabled = !state.selectedId;
    $("switchBtn").disabled = !state.selectedId || selectedIsCurrent;
    $("switchBtn").textContent = selectedIsCurrent ? "已启用" : "启用选中";
    $("providerModal").classList.toggle("hidden", !state.editorOpen);
    document.body.classList.toggle("modal-open", state.editorOpen);
    renderStatus();
    renderProfiles();
    fillForm();
  }

  function applyState(nextState) {
    state.profiles = nextState.profiles || [];
    state.current = nextState.current;
    state.hongyun = nextState.hongyun || state.hongyun;
    if (state.selectedId && !state.profiles.find((profile) => profile.id === state.selectedId)) {
      state.selectedId = null;
    }
    if (!state.editingProfile) {
      state.editingProfile = {
        ...emptyProfile(),
        name: state.hongyun.profileName,
        kind: "followCurrent",
        providerId: state.current?.providerName || "",
        baseUrl: state.hongyun.baseUrl,
        fastResponseEnabled: false,
        writePreferredAuthMethod: false,
        personality: "",
        fullAccessEnabled: true,
      };
    }
    render();
  }

  function bindStaticEvents() {
    $("refreshBtn").addEventListener("click", () => run(() => api.getState(), "已刷新。"));
    $("openConfigBtn").addEventListener("click", () => run(() => api.openPath(state.current.configPath)));
    $("openAuthBtn").addEventListener("click", () => run(() => api.openPath(state.current.authPath)));

    $("kind").addEventListener("change", () => {
      state.editingProfile = { ...formData(), readonly: Boolean(editingProfile().readonly) };
      applyFormVisibility(Boolean(editingProfile().readonly));
    });

    $("toggleApiKeyBtn").addEventListener("click", () => {
      state.editingProfile = { ...formData(), readonly: Boolean(editingProfile().readonly) };
      state.showApiKey = !state.showApiKey;
      render();
    });

    $("toggleHongyunKeyBtn").addEventListener("click", () => {
      state.showHongyunKey = !state.showHongyunKey;
      render();
    });

    $("autoHongyunBtn").addEventListener("click", () => {
      run(() => api.autoConfigureHongyun($("hongyunApiKey").value.trim()), "Hongyun 已沿用当前线路写入 baseUrl、Key 和 Full Access。");
    });

    $("addBtn").addEventListener("click", () => {
      state.selectedId = null;
      state.editingProfile = {
        ...emptyProfile(),
        name: state.hongyun.profileName,
        kind: "followCurrent",
        providerId: state.current?.providerName || "",
        baseUrl: state.hongyun.baseUrl,
        fastResponseEnabled: false,
        writePreferredAuthMethod: false,
        personality: "",
        fullAccessEnabled: true,
      };
      state.editorOpen = true;
      render();
    });

    $("updateBtn").addEventListener("click", async () => {
      let ok = false;
      if (state.selectedId) {
        ok = await run(() => api.updateProfile(state.selectedId, formData()), "配置已保存。");
      } else {
        ok = await run(() => api.addProfile(formData()), "配置已新增。");
      }
      if (ok) {
        state.editorOpen = false;
        render();
      }
    });

    $("deleteBtn").addEventListener("click", async () => {
      const ok = await run(async () => {
        if (!state.selectedId) {
          throw new Error("请先选择一个配置。");
        }
        return api.deleteProfile(state.selectedId);
      }, "配置已删除。");
      if (ok) {
        state.editorOpen = false;
        render();
      }
    });

    $("switchBtn").addEventListener("click", () => {
      run(async () => {
        if (!state.selectedId) {
          throw new Error("请先选择一个配置。");
        }
        return api.switchProfile(state.selectedId);
      }, "配置已启用。");
    });

    $("importBtn").addEventListener("click", () => {
      const current = state.current || {};
      state.selectedId = null;
      state.editingProfile = cloneProfile({
        name: `导入于 ${new Date().toLocaleTimeString("zh-CN", { hour12: false })}`,
        kind: "followCurrent",
        providerId: current.providerName || "",
        baseUrl: current.baseUrl || state.hongyun.baseUrl,
        apiKey: current.apiKey || "",
        fastResponseEnabled: Boolean(current.fastResponseEnabled),
        writePreferredAuthMethod: current.preferredAuthMethod === "apikey",
        personality: current.personality || "",
        fullAccessEnabled: Boolean(current.fullAccessEnabled),
      });
      state.editorOpen = true;
      render();
    });

    $("clearBtn").addEventListener("click", () => {
      state.editorOpen = false;
      render();
    });

    $("providerModal").addEventListener("click", (event) => {
      if (event.target === $("providerModal")) {
        state.editorOpen = false;
        render();
      }
    });

    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && state.editorOpen) {
        state.editorOpen = false;
        render();
      }
    });
  }

  bindStaticEvents();
  run(() => api.getState());

  function createPreviewApi() {
    const previewState = {
      profiles: [
        {
          id: "hongyun",
          name: "Hongyun OpenAI",
          kind: "followCurrent",
          baseUrl: "https://ai.hongyun.chat/v1",
          apiKey: "",
          fastResponseEnabled: false,
          providerId: "openai",
          authStrategy: "apikey",
          writePreferredAuthMethod: false,
          personality: "",
          fullAccessEnabled: true,
          readonly: false,
          minimalConfig: true,
        },
        {
          id: "backup",
          name: "原有账号配置备份",
          kind: "officialSnapshot",
          baseUrl: "https://api.openai.com/v1",
          apiKey: "",
          fastResponseEnabled: false,
          providerId: "openai",
          authStrategy: "preserve",
          writePreferredAuthMethod: false,
          personality: "",
          fullAccessEnabled: false,
          readonly: true,
        },
      ],
      current: {
        profileName: "Hongyun OpenAI",
        providerName: "openai",
        providerLabel: "openai",
        providerKind: "builtinOpenai",
        baseUrl: "https://ai.hongyun.chat/v1",
        apiKey: "",
        fastResponseEnabled: true,
        authMode: "apiKey",
        authStrategy: "apikey",
        preferredAuthMethod: "apikey",
        personality: "pragmatic",
        fullAccessEnabled: true,
        hasOfficialSnapshot: true,
        configPath: "~/.codex/config.toml",
        authPath: "~/.codex/auth.json",
      },
      hongyun: {
        baseUrl: "https://ai.hongyun.chat/v1",
        providerId: "hongyun",
        profileName: "Hongyun OpenAI",
      },
    };

    return {
      getState: async () => previewState,
      addProfile: async () => previewState,
      updateProfile: async () => previewState,
      deleteProfile: async () => previewState,
      switchProfile: async () => previewState,
      autoConfigureHongyun: async () => previewState,
      openPath: async () => undefined,
    };
  }
}());
