window.__ModuleLoader__.load({ id: "@sugarforever/dsh-lark", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
//#region rolldown:runtime
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));

//#endregion
let react = require("react");
react = __toESM(react);
let __deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
__deepseek_ai_dsh_client_ui_primitives = __toESM(__deepseek_ai_dsh_client_ui_primitives);
let react_jsx_runtime = require("react/jsx-runtime");
react_jsx_runtime = __toESM(react_jsx_runtime);

//#region src/client/LarkSettingsSection.tsx
const EMPTY_FORM = {
	appId: "",
	appSecret: "",
	domain: "feishu",
	requireMention: true,
	dmMode: "open",
	groupAllowlist: "",
	dmAllowlist: "",
	provider: "",
	model: "",
	workspace: "",
	agentPreset: "",
	errorMessage: ""
};
function adoptForm(next) {
	return {
		appId: next.appId,
		appSecret: "",
		domain: next.domain,
		requireMention: next.requireMention,
		dmMode: next.dmMode,
		groupAllowlist: next.groupAllowlist.join("\n"),
		dmAllowlist: next.dmAllowlist.join("\n"),
		provider: next.provider ?? "",
		model: next.model ?? "",
		workspace: next.workspace ?? "",
		agentPreset: next.agentPreset ?? "",
		errorMessage: next.errorMessage
	};
}
function LarkSettingsSection({ t, loadModels, channel }) {
	const [settings, setSettings] = react.useState(null);
	const [credential, setCredential] = react.useState();
	const [runtime, setRuntime] = react.useState({ state: "connecting" });
	const [form, setForm] = react.useState(EMPTY_FORM);
	const [modelCatalog, setModelCatalog] = react.useState(null);
	const [modelCatalogFailed, setModelCatalogFailed] = react.useState(false);
	const [busy, setBusy] = react.useState(false);
	const [notice, setNotice] = react.useState("");
	const busyRef = react.useRef(false);
	const writable = channel.getSettings()?.writable ?? true;
	react.useEffect(() => {
		const snapshot = channel.getSettings();
		if (snapshot?.value !== void 0) {
			setSettings(snapshot.value);
			setForm(adoptForm(snapshot.value));
		}
		return channel.subscribeSettings(() => {
			const value = channel.getSettings()?.value;
			if (value !== void 0) {
				setSettings(value);
				setForm((current) => busyRef.current ? current : adoptForm(value));
			}
		});
	}, [channel]);
	react.useEffect(() => {
		let active = true;
		const refresh = () => {
			channel.describeCredential().then((value) => {
				if (active) setCredential(value);
			}).catch(() => void 0);
			channel.status().then((value) => {
				if (active) setRuntime(value);
			}).catch(() => void 0);
		};
		refresh();
		const unsubscribe = channel.subscribeCredential(() => {
			refresh();
		});
		return () => {
			active = false;
			unsubscribe();
		};
	}, [channel, settings?.appSecretRef]);
	react.useEffect(() => {
		if (loadModels === void 0) return;
		let active = true;
		setModelCatalogFailed(false);
		loadModels().then((value) => {
			if (active) setModelCatalog(value);
		}).catch(() => {
			if (active) setModelCatalogFailed(true);
		});
		return () => {
			active = false;
		};
	}, [loadModels]);
	const update = (key, value) => setForm((current) => ({
		...current,
		[key]: value
	}));
	const lines = (value) => value.split(/\n/u).map((item) => item.trim()).filter(Boolean);
	const save = async (event) => {
		event.preventDefault();
		busyRef.current = true;
		setBusy(true);
		setNotice(t("saving"));
		const body = {
			expectedRevision: channel.getSettings()?.revision ?? 0,
			appId: form.appId.trim(),
			domain: form.domain,
			requireMention: form.requireMention,
			dmMode: form.dmMode,
			groupAllowlist: lines(form.groupAllowlist),
			dmAllowlist: lines(form.dmAllowlist),
			errorMessage: form.errorMessage
		};
		for (const key of [
			"provider",
			"model",
			"workspace",
			"agentPreset"
		]) body[key] = form[key].trim() === "" ? null : form[key].trim();
		if (form.appSecret !== "") body.appSecret = form.appSecret;
		try {
			const status = await channel.apply(body);
			busyRef.current = false;
			setRuntime(status);
			setBusy(false);
			setNotice(t("saved"));
		} catch (error) {
			busyRef.current = false;
			setBusy(false);
			setNotice(error instanceof Error ? error.message : String(error));
		}
	};
	const removeSecret = async () => {
		busyRef.current = true;
		setBusy(true);
		setNotice(t("removing"));
		try {
			await channel.removeSecret();
			busyRef.current = false;
			setBusy(false);
			setNotice(t("removed"));
		} catch (error) {
			busyRef.current = false;
			setBusy(false);
			setNotice(error instanceof Error ? error.message : String(error));
		}
	};
	const runtimeState = runtime.state;
	const dotState = runtimeState === "connected" ? "done" : runtimeState === "error" ? "error" : runtimeState === "connecting" ? "ongoing" : "warning";
	const providerGroup = modelCatalog?.groups.find((group) => group.id === form.provider);
	const providerIsUnknown = form.provider !== "" && modelCatalog !== null && providerGroup === void 0;
	const modelIsUnknown = form.model !== "" && modelCatalog !== null && providerGroup?.models.some((model) => model.id === form.model) !== true;
	const useModelSelects = loadModels !== void 0 && !modelCatalogFailed;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
		className: "dsh-lark-settings",
		"aria-labelledby": "dsh-lark-title",
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
				className: "dsh-lark-header",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
					id: "dsh-lark-title",
					children: t("title")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("subtitle") })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsh-lark-runtime",
					"aria-label": t("runtimeStatus"),
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(__deepseek_ai_dsh_client_ui_primitives.StateDot, {
						state: dotState,
						size: 8
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: runtimeState })]
				})]
			}),
			settings === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: "dsh-lark-loading",
				children: t("loading")
			}) : null,
			settings !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
				onSubmit: save,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-lark-card",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: t("application") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-lark-grid",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("appId") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(__deepseek_ai_dsh_client_ui_primitives.Input, {
									"aria-label": "appId",
									value: form.appId,
									onChange: (event) => update("appId", event.target.value),
									autoComplete: "off"
								})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("domain") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
									"aria-label": "domain",
									value: form.domain,
									onChange: (event) => update("domain", event.target.value),
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "feishu",
										children: "Feishu"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "lark",
										children: "Lark"
									})]
								})] })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("appSecret") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(__deepseek_ai_dsh_client_ui_primitives.Input, {
								"aria-label": "appSecret",
								type: "password",
								disabled: credential?.writable !== true,
								value: form.appSecret,
								onChange: (event) => update("appSecret", event.target.value),
								autoComplete: "new-password",
								placeholder: t("secretPlaceholder")
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-lark-credential",
								"aria-label": credential?.configured ? t("credentialConfigured") : t("credentialMissing"),
								"data-state": credential?.configured ? "configured" : "missing",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: "dsh-lark-credential-badge",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dsh-lark-credential-dot",
											"aria-hidden": "true"
										}), credential?.configured ? t("credentialConfigured") : t("credentialMissing")]
									}),
									credential?.source !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: credential.source }) : null,
									credential?.writable === false ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("readOnly") }) : null
								]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-lark-card",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: t("access") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "dsh-lark-check",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "checkbox",
									checked: form.requireMention,
									onChange: (event) => update("requireMention", event.target.checked)
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("requireMention") })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("dmMode") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
								value: form.dmMode,
								onChange: (event) => update("dmMode", event.target.value),
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "open",
										children: t("open")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "allowlist",
										children: t("allowlist")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "disabled",
										children: t("disabled")
									})
								]
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-lark-grid",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("groupAllowlist") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
									value: form.groupAllowlist,
									onChange: (event) => update("groupAllowlist", event.target.value),
									placeholder: t("onePerLine")
								})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("dmAllowlist") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
									value: form.dmAllowlist,
									onChange: (event) => update("dmAllowlist", event.target.value),
									placeholder: t("onePerLine")
								})] })]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-lark-card",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: t("agent") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-lark-grid",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("provider") }), useModelSelects ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
										"aria-label": t("provider"),
										disabled: modelCatalog === null,
										value: form.provider,
										onChange: (event) => setForm((current) => ({
											...current,
											provider: event.target.value,
											model: ""
										})),
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: "",
												children: modelCatalog === null ? t("modelCatalogLoading") : t("harnessDefault")
											}),
											providerIsUnknown ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
												value: form.provider,
												children: [
													form.provider,
													" (",
													t("notInCatalog"),
													")"
												]
											}) : null,
											modelCatalog?.groups.map((group) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: group.id,
												children: group.name
											}, group.id))
										]
									}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(__deepseek_ai_dsh_client_ui_primitives.Input, {
										"aria-label": t("provider"),
										value: form.provider,
										onChange: (event) => update("provider", event.target.value)
									})] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("model") }), useModelSelects ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
										"aria-label": t("model"),
										disabled: modelCatalog === null || form.provider === "",
										value: form.model,
										onChange: (event) => update("model", event.target.value),
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: "",
												children: form.provider === "" ? t("selectProviderFirst") : t("harnessDefault")
											}),
											modelIsUnknown ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
												value: form.model,
												children: [
													form.model,
													" (",
													t("notInCatalog"),
													")"
												]
											}) : null,
											providerGroup?.models.map((model) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: model.id,
												children: model.name
											}, model.id))
										]
									}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(__deepseek_ai_dsh_client_ui_primitives.Input, {
										"aria-label": t("model"),
										value: form.model,
										onChange: (event) => update("model", event.target.value)
									})] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("workspace") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(__deepseek_ai_dsh_client_ui_primitives.Input, {
										value: form.workspace,
										onChange: (event) => update("workspace", event.target.value)
									})] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("agentPreset") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(__deepseek_ai_dsh_client_ui_primitives.Input, {
										value: form.agentPreset,
										onChange: (event) => update("agentPreset", event.target.value)
									})] })
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("errorMessage") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
								maxLength: 500,
								value: form.errorMessage,
								onChange: (event) => update("errorMessage", event.target.value)
							})] })
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("footer", {
						className: "dsh-lark-actions",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(__deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "primary",
								type: "submit",
								disabled: busy || !writable,
								children: busy ? t("saving") : t("save")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(__deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "outline",
								type: "button",
								disabled: busy || !credential?.configured || credential?.writable !== true,
								onClick: removeSecret,
								children: t("removeSecret")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								role: "status",
								"aria-live": "polite",
								children: notice
							})
						]
					}),
					runtime.message !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsh-lark-detail",
						children: runtime.message
					}) : null
				]
			}) : null
		]
	});
}

//#endregion
//#region src/client/styles.ts
const CLIENT_CSS = `
.dsh-lark-settings{max-width:880px;padding:8px 2px 36px;color:var(--text-primary,#16181d)}
.dsh-lark-header{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:20px}.dsh-lark-header h2{margin:0;font-size:22px}.dsh-lark-header p{margin:6px 0 0;color:var(--text-secondary,#586174)}
.dsh-lark-runtime{display:flex;align-items:center;gap:8px;border:1px solid var(--border-subtle,#dfe3ea);border-radius:999px;padding:7px 12px;font-size:13px;font-weight:600;white-space:nowrap}
.dsh-lark-card{display:grid;gap:16px;margin:0 0 14px;padding:20px;border:1px solid var(--border-subtle,#dfe3ea);border-radius:12px;background:var(--surface-primary,#fff)}.dsh-lark-card h3{margin:0;font-size:15px}
.dsh-lark-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px}.dsh-lark-card label{display:grid;gap:7px;font-size:13px;font-weight:600}.dsh-lark-card select,.dsh-lark-card textarea{box-sizing:border-box;width:100%;border:1px solid var(--border-default,#cbd1dc);border-radius:8px;background:var(--surface-primary,#fff);color:inherit;font:inherit;padding:9px 11px}.dsh-lark-card textarea{min-height:82px;resize:vertical}.dsh-lark-card select:focus-visible,.dsh-lark-card textarea:focus-visible{outline:2px solid var(--accent-primary,#3b72e8);outline-offset:2px}
.dsh-lark-check{display:flex!important;align-items:center;gap:9px}.dsh-lark-check input{width:16px;height:16px}.dsh-lark-credential{display:flex;align-items:center;gap:9px;color:var(--text-secondary,#586174);font-size:12px}.dsh-lark-credential-badge{display:inline-flex;align-items:center;gap:7px;border:1px solid currentColor;border-radius:999px;padding:4px 9px;font-weight:700}.dsh-lark-credential[data-state=configured] .dsh-lark-credential-badge{color:var(--success-text,#137333);background:var(--success-surface,#e8f5e9)}.dsh-lark-credential[data-state=missing] .dsh-lark-credential-badge{color:var(--warning-text,#9a6700);background:var(--warning-surface,#fff4ce)}.dsh-lark-credential-dot{width:7px;height:7px;border-radius:50%;background:currentColor}.dsh-lark-credential code{padding:2px 6px;border-radius:5px;background:var(--surface-secondary,#f2f4f7)}
.dsh-lark-actions{display:flex;align-items:center;gap:10px;min-height:36px}.dsh-lark-actions [role=status]{font-size:13px;color:var(--text-secondary,#586174)}.dsh-lark-detail,.dsh-lark-loading{color:var(--text-secondary,#586174);font-size:13px}
@media(max-width:680px){.dsh-lark-header{align-items:stretch;flex-direction:column}.dsh-lark-runtime{align-self:flex-start}.dsh-lark-grid{grid-template-columns:1fr}.dsh-lark-actions{align-items:stretch;flex-direction:column}.dsh-lark-actions button{width:100%}}
@media(prefers-reduced-motion:reduce){.dsh-lark-settings *{scroll-behavior:auto!important;transition:none!important}}
`;

//#endregion
//#region src/client/index.ts
const NS = "dsh-lark";
const NAMESPACE = "lark-channel";
const SECRET_REF = "DSH_LARK_APP_SECRET";
const dictionaries = {
	zh: {
		nav: "飞书与 Lark",
		title: "飞书与 Lark",
		subtitle: "配置消息渠道，保存后无需重启 Harness",
		runtimeStatus: "运行状态",
		loading: "正在读取配置......",
		application: "应用凭据",
		appId: "App ID",
		domain: "平台",
		appSecret: "App Secret",
		secretPlaceholder: "留空表示保留现有 Secret",
		credentialConfigured: "Secret 已配置",
		credentialMissing: "Secret 未配置",
		readOnly: "由配置或启动环境提供，只读",
		access: "访问策略",
		requireMention: "群聊中必须 @机器人",
		dmMode: "单聊策略",
		open: "开放",
		allowlist: "仅白名单",
		disabled: "关闭",
		groupAllowlist: "群聊白名单",
		dmAllowlist: "用户白名单",
		onePerLine: "每行一个 ID",
		agent: "Agent 配置",
		provider: "Provider",
		model: "Model",
		workspace: "Workspace",
		agentPreset: "Agent Preset",
		errorMessage: "失败提示",
		modelCatalogLoading: "正在加载模型目录......",
		harnessDefault: "跟随 Harness 默认配置",
		selectProviderFirst: "请先选择 Provider",
		notInCatalog: "当前目录中不可见",
		save: "保存并重新连接",
		saving: "正在保存......",
		saved: "已保存",
		saveFailed: "保存失败",
		loadFailed: "配置读取失败",
		removeSecret: "删除已保存的 Secret",
		removing: "正在删除......",
		removed: "Secret 已删除",
		removeFailed: "删除失败"
	},
	en: {
		nav: "Lark",
		title: "Feishu & Lark",
		subtitle: "Configure the message channel without restarting Harness",
		runtimeStatus: "Runtime status",
		loading: "Loading settings...",
		application: "Application credentials",
		appId: "App ID",
		domain: "Platform",
		appSecret: "App Secret",
		secretPlaceholder: "Leave blank to keep the stored secret",
		credentialConfigured: "Secret configured",
		credentialMissing: "Secret missing",
		readOnly: "Provided by config or launch environment; read-only",
		access: "Access policy",
		requireMention: "Require @mention in group chats",
		dmMode: "Direct messages",
		open: "Open",
		allowlist: "Allowlist only",
		disabled: "Disabled",
		groupAllowlist: "Group allowlist",
		dmAllowlist: "User allowlist",
		onePerLine: "One ID per line",
		agent: "Agent configuration",
		provider: "Provider",
		model: "Model",
		workspace: "Workspace",
		agentPreset: "Agent Preset",
		errorMessage: "Failure message",
		modelCatalogLoading: "Loading model catalog...",
		harnessDefault: "Use Harness default",
		selectProviderFirst: "Select a provider first",
		notInCatalog: "Not in current catalog",
		save: "Save and reconnect",
		saving: "Saving...",
		saved: "Saved",
		saveFailed: "Save failed",
		loadFailed: "Unable to load settings",
		removeSecret: "Remove stored secret",
		removing: "Removing...",
		removed: "Secret removed",
		removeFailed: "Remove failed"
	}
};
const name = "dsh-lark";
const inject = [
	"slots",
	"locale",
	"connection",
	"settingsScope",
	"remote"
];
function fetchJson(url, init) {
	return fetch(url, {
		headers: { accept: "application/json" },
		cache: "no-store",
		...init
	}).then(async (response) => {
		const value = await response.json();
		if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`);
		return value;
	});
}
function buildChannel(ctx) {
	const scope = ctx.settingsScope.bind({ namespace: NAMESPACE });
	const credentialRef = () => scope.getSnapshot()?.value?.appSecretRef ?? SECRET_REF;
	const unwrap = (response) => {
		if (!response.result.ok) throw new Error(`${response.result.error.code}: ${response.result.error.message}`);
		return response.result.value;
	};
	return {
		getSettings: () => scope.getSnapshot(),
		subscribeSettings: (onChange) => scope.subscribe(onChange),
		describeCredential: async () => {
			const ref = credentialRef();
			return unwrap(await ctx.connection.api.credentials.describe({ refs: [ref] })).credentials[ref] ?? {
				configured: false,
				writable: true
			};
		},
		subscribeCredential: (onChange) => {
			const listener = (ref) => {
				if (ref === credentialRef()) onChange();
			};
			const disposeLegacy = ctx.remote.$on("credentials/updated", listener);
			const disposeCurrent = ctx.remote.$on("credentials/reference-updated", listener);
			return () => {
				disposeLegacy();
				disposeCurrent();
			};
		},
		status: () => fetchJson("/dsh-lark/status"),
		apply: async (input) => {
			return (await fetchJson("/dsh-lark/apply", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(input)
			})).status;
		},
		removeSecret: async () => {
			await ctx.connection.api.credentials.unset({ ref: credentialRef() });
		}
	};
}
function apply(ctx) {
	ctx.effect(() => ctx.locale.register(NS, dictionaries), "dsh-lark: client dictionaries");
	ctx.effect(() => {
		const style = document.createElement("style");
		style.dataset.plugin = NS;
		style.textContent = CLIENT_CSS;
		document.head.appendChild(style);
		return () => style.remove();
	}, "dsh-lark: client styles");
	const t = ctx.locale.bind(NS);
	const loadModels = async () => {
		const response = await ctx.connection.api.llm.models({});
		if (!response.result.ok) throw new Error(`${response.result.error.code}: ${response.result.error.message}`);
		return response.result.value;
	};
	ctx.slots.inject("settings.action", () => ctx.slots.register({
		name: "settings.action",
		id: "open-document",
		priority: -1
	}, () => null));
	ctx.slots.inject("settings.section", () => ctx.slots.register({
		name: "settings.section",
		id: "lark",
		order: 45,
		label: () => t("nav"),
		locale: NS
	}, () => (0, react.createElement)(LarkSettingsSection, {
		t,
		loadModels,
		channel: buildChannel(ctx)
	})));
}

//#endregion
exports.apply = apply;
exports.inject = inject;
exports.name = name;
return module.exports; } });
//# sourceMappingURL=client.js.map