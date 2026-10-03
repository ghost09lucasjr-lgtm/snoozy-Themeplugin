(function (exports) {
  "use strict";

  const { findByProps } = vendetta.metro;
  const { after, before } = vendetta.patcher;
  const { storage } = vendetta.plugin;
  const { React, ReactNative: RN } = vendetta.metro.common;
  const { showToast } = vendetta.ui.toasts;

  storage.people ??= {}; // { userId: { avatar, nick? } }

  // ---------- theme settings (kept as a draft until SET is pressed) ----------
  const DEFAULTS = {
    themeName: "My Theme", themeDescription: "Made with Snoozy Studio", themeAuthor: "me", applyNow: true,
    accentColor: "", bgColor: "", bgSecondaryColor: "", bgTertiaryColor: "", inputColor: "",
    textColor: "", mutedTextColor: "", headerColor: "", iconColor: "", linkColor: "",
    outlineColor: "", highlightColor: "", dangerColor: "", positiveColor: "",
    dmImage: "", dmImageUrl: "", dmImageOpacity: 0.6, bgBlur: 0, animSpeed: 0.6,
  };
  for (const k in DEFAULTS) storage[k] ??= DEFAULTS[k];
  const KEYS = Object.keys(DEFAULTS);
  const draft = {};
  const loadDraft = () => { for (const k of KEYS) draft[k] = storage[k]; };
  loadDraft();
  const applyAll = () => { for (const k of KEYS) storage[k] = draft[k]; };

  const patches = [];
  const personCache = new Map();
  let hookStatus = "not tried yet";
  const seenSheets = [];

  // ---------- lookups ----------
  function getPerson(id) {
    const o = storage.people?.[id];
    return o && (o.nick || o.avatar) ? o : null;
  }

  function savePerson(id, patch) {
    const old = storage.people?.[id] || {};
    const next = { ...old, ...patch };
    const people = { ...storage.people };
    if (!next.avatar && !next.nick) delete people[id];
    else people[id] = next;
    storage.people = people;
    personCache.delete(id);
  }

  // ---------- make the app show the custom picture ----------
  function wrapUser(user) {
    if (!user || !user.id) return user;
    const o = getPerson(user.id);
    if (!o) return user;
    const key = (o.nick || "") + "|" + (o.avatar ? o.avatar.length : 0);
    const hit = personCache.get(user.id);
    if (hit && hit.orig === user && hit.key === key) return hit.clone;
    const c = Object.create(user);
    try {
      if (o.nick) {
        Object.defineProperty(c, "globalName", { value: o.nick, configurable: true });
        Object.defineProperty(c, "username", { value: o.nick, configurable: true });
      }
      if (o.avatar) {
        Object.defineProperty(c, "getAvatarURL", { value: () => o.avatar, configurable: true });
        Object.defineProperty(c, "avatarURL", { value: o.avatar, configurable: true });
      }
    } catch (e) { console.log("[PfpChanger] wrap", e); }
    personCache.set(user.id, { orig: user, key, clone: c });
    return c;
  }

  function patchAvatars() {
    const notes = [];
    try {
      const { findByStoreName } = vendetta.metro;
      const UserStore = findByStoreName("UserStore");
      if (UserStore?.getUser) {
        patches.push(after("getUser", UserStore, (args, ret) => wrapUser(ret)));
        notes.push("users");
      }
      const GMS = findByStoreName("GuildMemberStore");
      if (GMS?.getNick) {
        patches.push(after("getNick", GMS, (args, ret) => getPerson(args[1])?.nick || ret));
        notes.push("nicks");
      }
    } catch (e) { console.log("[PfpChanger] stores", e); }
    for (const fname of ["getUserAvatarURL", "getUserAvatarSource"]) {
      try {
        const mod = findByProps(fname);
        if (!mod || typeof mod[fname] !== "function") continue;
        patches.push(after(fname, mod, (args, ret) => {
          const o = getPerson(args[0]?.id);
          if (!o?.avatar) return ret;
          return fname === "getUserAvatarSource" ? { uri: o.avatar } : o.avatar;
        }));
        notes.push(fname);
      } catch (e) { console.log("[PfpChanger] avatar hook", fname, e); }
    }
    hookStatus = notes.length ? "avatar hooks: " + notes.join(", ") : "no avatar hooks found";
  }

  // ---------- device image picker ----------
  function getPicker() {
    try {
      const a = findByProps("launchImageLibrary");
      if (a) return { type: "rnip", mod: a };
      const b = findByProps("openPicker");
      if (b) return { type: "crop", mod: b };
    } catch {}
    return null;
  }

  async function pickFromDevice(size = 512) {
    const p = getPicker();
    if (!p) { showToast("No image picker found in this app build"); return ""; }
    try {
      if (p.type === "rnip") {
        const res = await p.mod.launchImageLibrary({ mediaType: "photo", includeBase64: true, quality: 0.8, maxWidth: size, maxHeight: size });
        const a = res?.assets?.[0];
        if (!a) return "";
        return a.base64 ? `data:${a.type || "image/jpeg"};base64,${a.base64}` : a.uri;
      }
      const a = await p.mod.openPicker({ mediaType: "photo", includeBase64: true, compressImageQuality: 0.8, width: size, height: size, cropping: true });
      if (!a) return "";
      return a.data ? `data:${a.mime || "image/jpeg"};base64,${a.data}` : (a.path?.startsWith("file") ? a.path : "file://" + a.path);
    } catch (e) {
      console.log("[PfpChanger] picker", e);
      showToast("Picker cancelled or failed");
      return "";
    }
  }

  function askAndImport(uid, done) {
    const run = async () => {
      const img = await pickFromDevice();
      if (!img) return;
      savePerson(uid, { avatar: img });
      showToast("Picture set. Close and reopen the profile to see it");
      done && done();
    };
    try {
      RN.Alert.alert("Import a picture", "Choose an image from your device to use as this person's profile picture. Only you will see it.", [
        { text: "Cancel", style: "cancel" },
        { text: "Import", onPress: run },
      ]);
    } catch { run(); }
  }

  // ---------- remember which profile is open (backup way to know the user) ----------
  let lastSeenUid = "";
  const patchedModules = new WeakSet();

  function patchSheets() {
    try {
      const LazyActionSheet = findByProps("openLazy", "hideActionSheet");
      if (!LazyActionSheet) { hookStatus += "; no sheet opener found"; return; }
      patches.push(
        before("openLazy", LazyActionSheet, ([component, key]) => {
          try {
            if (key && !seenSheets.includes(key)) { seenSheets.push(key); if (seenSheets.length > 10) seenSheets.shift(); }
            Promise.resolve(component).then((mod) => {
              if (!mod || typeof mod.default !== "function" || patchedModules.has(mod)) return;
              patchedModules.add(mod);
              patches.push(
                after("default", mod, (args, ret) => {
                  const p = args?.[0] || {};
                  const uid = p.userId ?? p.user?.id ?? p.member?.userId ?? p.profile?.userId;
                  if (uid && /^\d{5,25}$/.test(String(uid))) lastSeenUid = String(uid);
                  return ret;
                })
              );
            }).catch(() => {});
          } catch (e) { console.log("[PfpChanger] sheet", e); }
        })
      );
    } catch (e) { console.log("[PfpChanger] sheets", e); }
  }

  // ---------- clipboard helpers (used to read the user ID from "Copy User ID") ----------
  function clipModule() {
    try {
      return vendetta.metro.common.clipboard || findByProps("getString", "setString") || RN.Clipboard || null;
    } catch { return null; }
  }
  const getClip = async () => { try { return String((await clipModule()?.getString?.()) ?? ""); } catch { return ""; } };
  const setClip = async (t) => { try { await clipModule()?.setString?.(t); } catch {} };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const isId = (t) => /^\d{15,25}$/.test((t || "").trim());

  // ---------- add "snoozypfp" next to "Change Friend Nickname" ----------
  const ROW_LABEL = "snoozypfp";
  const ANCHORS = ["Change Friend Nickname", "Change Nickname", "Copy User ID"];
  let menuHits = 0;

  function textOf(node, depth = 0) {
    if (!node || typeof node !== "object" || depth > 2) return typeof node === "string" ? node : undefined;
    const p = node.props;
    if (!p) return undefined;
    if (typeof p.label === "string") return p.label;
    if (typeof p.title === "string") return p.title;
    if (typeof p.children === "string") return p.children;
    if (p.children && typeof p.children === "object" && !Array.isArray(p.children)) return textOf(p.children, depth + 1);
    return undefined;
  }

  async function onMenuPress(copyRow) {
    let uid = "";
    const handler = copyRow?.props?.onPress ?? copyRow?.props?.onSelect ?? copyRow?.props?.action;
    if (typeof handler === "function") {
      const prev = await getClip();
      try { handler(); } catch (e) { console.log("[PfpChanger] copy row", e); }
      await wait(250);
      const got = (await getClip()).trim();
      if (isId(got)) uid = got;
      await setClip(prev); // put the clipboard back how it was
    }
    if (!uid && lastSeenUid) uid = lastSeenUid;
    if (!uid) { showToast("Couldn't tell whose profile this is. Use the settings page instead"); return; }
    askAndImport(uid);
  }

  function injectRow(ret) {
    try {
      const kids = ret?.props?.children;
      if (!Array.isArray(kids) || kids.length < 2 || kids.length > 40) return ret;
      if (kids.some((k) => k && k.key === ROW_LABEL)) return ret;

      let anchorIdx = -1, copyRow = null;
      for (let i = 0; i < kids.length; i++) {
        const t = textOf(kids[i]);
        if (t === "Copy User ID") copyRow = kids[i];
        if (anchorIdx < 0 && ANCHORS.includes(t) && t !== "Copy User ID") anchorIdx = i;
      }
      if (anchorIdx < 0 && copyRow) anchorIdx = kids.indexOf(copyRow);
      if (anchorIdx < 0) return ret;

      const row = kids[anchorIdx];
      const p = row.props || {};
      const np = { key: ROW_LABEL };
      if ("label" in p) np.label = ROW_LABEL;
      else if ("title" in p) np.title = ROW_LABEL;
      else if (typeof p.children === "string") np.children = ROW_LABEL;
      else if (p.children && typeof p.children === "object" && !Array.isArray(p.children)) np.children = React.cloneElement(p.children, { children: ROW_LABEL });
      else np.label = ROW_LABEL;
      if ("id" in p) np.id = ROW_LABEL;
      if ("subLabel" in p) np.subLabel = undefined;
      if ("description" in p) np.description = undefined;
      const press = () => onMenuPress(copyRow);
      let set = false;
      for (const k of ["onPress", "onSelect", "action", "onClick", "onTap"]) if (k in p) { np[k] = press; set = true; }
      if (!set) np.onPress = press;

      const next = kids.slice();
      next.splice(anchorIdx + 1, 0, React.cloneElement(row, np));
      menuHits++;
      return React.cloneElement(ret, { children: next });
    } catch (e) {
      console.log("[PfpChanger] inject", e);
      return ret;
    }
  }

  function patchMenu() {
    const notes = [];
    try {
      const rt = findByProps("jsx", "jsxs");
      for (const fn of ["jsx", "jsxs"]) {
        if (rt && typeof rt[fn] === "function") {
          patches.push(after(fn, rt, (args, ret) => injectRow(ret)));
          notes.push(fn);
        }
      }
    } catch (e) { console.log("[PfpChanger] jsx", e); }
    try {
      patches.push(after("createElement", React, (args, ret) => injectRow(ret)));
      notes.push("createElement");
    } catch (e) { console.log("[PfpChanger] createElement", e); }
    hookStatus += "; menu hooks: " + (notes.join(", ") || "none");
  }

  // ---------- color helpers ----------
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const isHex = (v) => /^#([0-9a-f]{6}|[0-9a-f]{8})$/i.test((v || "").trim());

  function hslToHex(h, sat, l) {
    sat /= 100; l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = sat * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    const x = (v) => Math.round(255 * v).toString(16).padStart(2, "0");
    return "#" + x(f(0)) + x(f(8)) + x(f(4));
  }

  function hexToHsl(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0, sat = 0;
    if (max !== min) {
      const d = max - min;
      sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return { h, s: sat * 100, l: l * 100 };
  }

  // ---------- which app color names belong to which of our options ----------
  const TOKENS = {
    accentColor: ["BRAND_500", "BRAND_360", "BUTTON_BACKGROUND_BRAND", "TEXT_BRAND", "CONTROL_BRAND_FOREGROUND"],
    bgColor: ["BACKGROUND_PRIMARY", "BACKGROUND_MOBILE_PRIMARY", "CHAT_BACKGROUND", "BACKGROUND_BASE_LOWEST", "BACKGROUND_BASE_LOWER"],
    bgSecondaryColor: ["BACKGROUND_SECONDARY", "BACKGROUND_MOBILE_SECONDARY", "BACKGROUND_SECONDARY_ALT", "BACKGROUND_BASE_LOW"],
    bgTertiaryColor: ["BACKGROUND_TERTIARY"],
    inputColor: ["CHANNEL_TEXT_AREA_BACKGROUND", "INPUT_BACKGROUND"],
    textColor: ["TEXT_NORMAL", "TEXT_DEFAULT", "TEXT_STRONG", "CHANNELS_DEFAULT"],
    mutedTextColor: ["TEXT_MUTED", "TEXT_SECONDARY", "TEXT_SUBTLE"],
    headerColor: ["HEADER_PRIMARY", "HEADER_SECONDARY"],
    iconColor: ["INTERACTIVE_NORMAL", "INTERACTIVE_ACTIVE", "INTERACTIVE_MUTED", "ICON_DEFAULT", "ICON_STRONG"],
    linkColor: ["TEXT_LINK", "TEXT_LINK_LOW_SATURATION"],
    outlineColor: ["BORDER_FAINT", "BORDER_STRONG", "BORDER_SUBTLE", "BORDER_NORMAL", "BACKGROUND_MODIFIER_ACCENT"],
    highlightColor: ["BACKGROUND_MODIFIER_SELECTED", "BACKGROUND_MODIFIER_ACTIVE", "BACKGROUND_MODIFIER_HOVER"],
    dangerColor: ["TEXT_DANGER", "BUTTON_DANGER_BACKGROUND", "STATUS_DANGER_BACKGROUND"],
    positiveColor: ["STATUS_POSITIVE_BACKGROUND", "TEXT_POSITIVE"],
  };
  const COLOR_KEYS = Object.keys(TOKENS);

  // first matching rule wins
  const RULES = [
    ["outlineColor", /^BACKGROUND_MODIFIER_ACCENT$|BORDER|OUTLINE/],
    ["linkColor", /^TEXT_LINK/],
    ["accentColor", /BRAND/],
    ["dangerColor", /^(TEXT_DANGER|BUTTON_DANGER_BACKGROUND.*|STATUS_DANGER_BACKGROUND|INTERACTIVE_DANGER.*)$/],
    ["positiveColor", /^(STATUS_POSITIVE_BACKGROUND|STATUS_ONLINE.*|TEXT_POSITIVE)$/],
    ["highlightColor", /^BACKGROUND_MODIFIER_(SELECTED|ACTIVE|HOVER)$/],
    ["inputColor", /^(CHANNEL_TEXT_AREA_BACKGROUND|INPUT_BACKGROUND.*)$/],
    ["chat", /^CHAT_BACKGROUND/],
    [null, /DANGER|WARNING|POSITIVE|STATUS|MENTION|PREMIUM|CONFETTI|SCRIM|TOOLTIP|MODIFIER/],
    ["headerColor", /^HEADER_PRIMARY$/],
    ["mutedTextColor", /^(TEXT_(MUTED|SUBTLE|SECONDARY)|HEADER_SECONDARY)$/],
    ["textColor", /^(TEXT_(NORMAL|DEFAULT|STRONG)|CHANNELS_DEFAULT)$/],
    ["iconColor", /^(INTERACTIVE_(NORMAL|ACTIVE|HOVER|MUTED)|ICON_(DEFAULT|STRONG|SUBTLE|MUTED))$/],
    ["bgColor", /^(BACKGROUND_PRIMARY|BACKGROUND_MOBILE_PRIMARY|BACKGROUND_BASE_LOWEST|BACKGROUND_DEFAULT|BG_BASE_PRIMARY)$/],
    ["bgTertiaryColor", /^(BACKGROUND_TERTIARY|BG_BASE_TERTIARY)$/],
    ["bgSecondaryColor", /^(BACKGROUND_(SECONDARY.*|MOBILE_SECONDARY|BASE_LOW|BASE_LOWER|SURFACE_.*)|BG_(BASE_SECONDARY|SURFACE_.*))$/],
  ];

  function groupTokens() {
    const g = { chat: [] };
    for (const k of COLOR_KEYS) g[k] = TOKENS[k].slice();
    let names = [];
    try { names = Object.keys(findByProps("internal", "colors")?.colors || {}); } catch {}
    for (const n of names) {
      for (const [group, re] of RULES) {
        if (!re.test(n)) continue;
        if (group && !g[group].includes(n)) g[group].push(n);
        if (group === "chat" && !g.bgColor.includes(n)) g.bgColor.push(n);
        break;
      }
    }
    return { g, found: names.length };
  }

  // ---------- make a NEW theme and add it to the Themes app ----------
  async function applyTheme() {
    const T = vendetta.themes;
    if (!T) throw new Error("this build has no themes API");
    const { g, found } = groupTokens();
    const src = storage.dmImage || (storage.dmImageUrl || "").trim();

    const semantic = {};
    for (const setting of COLOR_KEYS) {
      const v = storage[setting];
      if (!isHex(v)) continue;
      let val = v.trim();
      if (src && setting === "bgColor" && val.length === 7) val += "99"; // let the image show through
      for (const name of g[setting]) semantic[name] = [val, val];
    }
    if (src) for (const name of g.chat) semantic[name] = ["#00000000", "#00000000"];

    const raw = {};
    if (isHex(storage.accentColor)) raw.BRAND_500 = storage.accentColor.trim().slice(0, 7);
    const shade = (hex, dl) => { const c = hexToHsl(hex); return hslToHex(c.h, c.s, clamp(c.l + dl, 0, 100)); };
    if (isHex(storage.bgColor)) {
      const b = storage.bgColor.trim().slice(0, 7);
      raw.PRIMARY_660 = shade(b, 4); raw.PRIMARY_700 = b; raw.PRIMARY_730 = shade(b, -2);
    }
    if (isHex(storage.bgSecondaryColor)) {
      const b = storage.bgSecondaryColor.trim().slice(0, 7);
      raw.PRIMARY_760 = shade(b, 2); raw.PRIMARY_800 = b; raw.PRIMARY_830 = shade(b, -3);
      raw.PRIMARY_860 = shade(b, -5); raw.PRIMARY_900 = shade(b, -7);
    }

    if (!Object.keys(semantic).length && !src) throw new Error("pick at least one color or an image first");

    const name = (storage.themeName || "").trim() || "My Theme";
    const data = {
      name,
      description: (storage.themeDescription || "").trim(),
      authors: [{ name: (storage.themeAuthor || "").trim() || "me" }],
      spec: 2,
      semanticColors: semantic,
      rawColors: raw,
    };
    if (src) {
      data.background = {
        url: src,
        blur: clamp(parseFloat(storage.bgBlur) || 0, 0, 20),
        alpha: clamp(parseFloat(storage.dmImageOpacity) || 0.6, 0.05, 1),
      };
    }

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "theme";
    const id = "https://theme-maker.invalid/" + slug + "-" + Date.now() + ".json"; // new id each time = new theme
    const store = T.themes;
    if (!store) throw new Error("themes store missing");
    store[id] = { id, selected: false, data };

    if (storage.applyNow) {
      try { await T.selectTheme(store[id]); }
      catch (e1) { await T.selectTheme(id); }
    }
    return "Theme \"" + name + "\" added (" + Object.keys(semantic).length + " colors, app lists " + found + ")" + (src ? " + image" : "") + (storage.applyNow ? " and selected" : "");
  }

  function reloadApp() {
    try {
      const m = RN.NativeModules.BundleUpdaterManager;
      if (m && m.reload) { m.reload(); return; }
    } catch (e) { console.log("[Studio] reload", e); }
    showToast("Saved. Fully close and reopen the app to apply");
  }

  // ---------- optional: faster animations ----------
  function patchAnimations() {
    try {
      const { instead } = vendetta.patcher;
      patches.push(
        instead("timing", RN.Animated, (args, orig) => {
          const speed = parseFloat(storage.animSpeed);
          if (speed > 0 && speed !== 1 && args[1]) args[1] = { ...args[1], duration: (args[1].duration ?? 300) * speed };
          return orig(...args);
        })
      );
    } catch (e) { console.log("[Studio] anim", e); }
  }

  // ---------- UI pieces ----------
  const card = { marginBottom: 12, padding: 12, borderRadius: 12, backgroundColor: "#2b2d31" };
  const Label = ({ children, style }) => React.createElement(RN.Text, { style: { color: "#fff", fontSize: 16, fontWeight: "600", ...style } }, children);
  const Btn = ({ label, onPress, danger }) =>
    React.createElement(
      RN.TouchableOpacity,
      { onPress, style: { paddingVertical: 9, paddingHorizontal: 14, borderRadius: 8, backgroundColor: danger ? "#8b2c2c" : "#4f5bd5", marginRight: 8, marginTop: 8 } },
      React.createElement(RN.Text, { style: { color: "#fff", fontWeight: "600" } }, label)
    );

  function Slider({ value, min, max, onChange, colors }) {
    const [w, setW] = React.useState(0);
    const live = React.useRef({});
    live.current = { w, min, max, onChange };
    const startX = React.useRef(0);
    const upd = (x) => {
      const c = live.current;
      if (!c.w) return;
      c.onChange(c.min + clamp(x / c.w, 0, 1) * (c.max - c.min));
    };
    const pan = React.useMemo(() => RN.PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => { startX.current = e.nativeEvent.locationX; upd(startX.current); },
      onPanResponderMove: (e, gs) => upd(startX.current + gs.dx),
    }), []);
    const t = clamp((value - min) / (max - min), 0, 1);
    return React.createElement(
      RN.View,
      { style: { height: 34, justifyContent: "center", marginVertical: 4 }, onLayout: (e) => setW(e.nativeEvent.layout.width), ...pan.panHandlers },
      React.createElement(
        RN.View,
        { pointerEvents: "none", style: { flexDirection: "row", height: 14, borderRadius: 7, overflow: "hidden", backgroundColor: "#555" } },
        ...(colors || []).map((c, i) => React.createElement(RN.View, { key: i, style: { flex: 1, backgroundColor: c } }))
      ),
      React.createElement(RN.View, {
        pointerEvents: "none",
        style: { position: "absolute", left: t * w - 13, top: 4, width: 26, height: 26, borderRadius: 13, backgroundColor: "#fff", borderWidth: 3, borderColor: "#222" },
      })
    );
  }

  const HUE_COLORS = Array.from({ length: 36 }, (_, i) => hslToHex(i * 10, 100, 50));

  function ColorRow({ id, label }) {
    const [open, setOpen] = React.useState(false);
    const [hsl, setHsl] = React.useState(isHex(draft[id]) ? hexToHsl(draft[id]) : { h: 210, s: 60, l: 50 });
    const [, tick] = React.useReducer((x) => x + 1, 0);
    const cur = isHex(draft[id]) ? draft[id] : null;
    const set = (p) => { const n = { ...hsl, ...p }; setHsl(n); draft[id] = hslToHex(n.h, n.s, n.l); };
    const sat = Array.from({ length: 12 }, (_, i) => hslToHex(hsl.h, (i / 11) * 100, hsl.l));
    const lig = Array.from({ length: 12 }, (_, i) => hslToHex(hsl.h, hsl.s, (i / 11) * 100));
    return React.createElement(
      RN.View, { style: card },
      React.createElement(
        RN.TouchableOpacity,
        { onPress: () => setOpen(!open), style: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" } },
        React.createElement(Label, null, label),
        React.createElement(RN.View, { style: { width: 44, height: 28, borderRadius: 8, borderWidth: 2, borderColor: "#888", backgroundColor: cur || "#00000000" } })
      ),
      open && React.createElement(
        RN.View, { style: { marginTop: 10 } },
        React.createElement(RN.Text, { style: { color: "#aaa" } }, "Hue"),
        React.createElement(Slider, { value: hsl.h, min: 0, max: 360, colors: HUE_COLORS, onChange: (v) => set({ h: v }) }),
        React.createElement(RN.Text, { style: { color: "#aaa" } }, "Saturation"),
        React.createElement(Slider, { value: hsl.s, min: 0, max: 100, colors: sat, onChange: (v) => set({ s: v }) }),
        React.createElement(RN.Text, { style: { color: "#aaa" } }, "Lightness"),
        React.createElement(Slider, { value: hsl.l, min: 0, max: 100, colors: lig, onChange: (v) => set({ l: v }) }),
        React.createElement(RN.Text, { style: { color: "#aaa", marginTop: 4 } }, cur || "default (not changed)"),
        React.createElement(Btn, { label: "Reset to default", danger: true, onPress: () => { draft[id] = ""; tick(); } })
      )
    );
  }

  function TextField({ id, label, multiline }) {
    const [val, setVal] = React.useState(String(draft[id] ?? ""));
    return React.createElement(
      RN.View, { style: { marginTop: 10 } },
      React.createElement(RN.Text, { style: { color: "#aaa", marginBottom: 4 } }, label),
      React.createElement(RN.TextInput, {
        value: val, multiline: !!multiline, autoCorrect: false, placeholderTextColor: "#777",
        onChangeText: (t) => { setVal(t); draft[id] = t; },
        style: { color: "#fff", borderWidth: 1, borderColor: "#555", borderRadius: 8, padding: 10, minHeight: multiline ? 70 : undefined, textAlignVertical: multiline ? "top" : "center" },
      })
    );
  }

  function ThemeInfo() {
    return React.createElement(
      RN.View, { style: card },
      React.createElement(Label, null, "Theme details"),
      React.createElement(TextField, { id: "themeName", label: "Theme name" }),
      React.createElement(TextField, { id: "themeDescription", label: "Description", multiline: true }),
      React.createElement(TextField, { id: "themeAuthor", label: "Author" })
    );
  }

  function BackgroundSection() {
    const [, tick] = React.useReducer((x) => x + 1, 0);
    const [op, setOp] = React.useState(clamp(parseFloat(draft.dmImageOpacity) || 0.6, 0.05, 1));
    const [blur, setBlur] = React.useState(clamp(parseFloat(draft.bgBlur) || 0, 0, 20));
    const src = draft.dmImage || (draft.dmImageUrl || "").trim();
    const noPicker = !getPicker();
    return React.createElement(
      RN.View, { style: card },
      React.createElement(Label, null, "Background image"),
      src ? React.createElement(RN.Image, { source: { uri: src }, resizeMode: "cover", style: { height: 140, borderRadius: 10, marginTop: 8, opacity: Math.max(op, 0.3) } }) : null,
      React.createElement(
        RN.View, { style: { flexDirection: "row", flexWrap: "wrap" } },
        React.createElement(Btn, { label: "Choose from device", onPress: async () => { const a = await pickFromDevice(1600); if (a) { draft.dmImage = a; draft.dmImageUrl = ""; tick(); } } }),
        src ? React.createElement(Btn, { label: "Remove", danger: true, onPress: () => { draft.dmImage = ""; draft.dmImageUrl = ""; tick(); } }) : null
      ),
      noPicker && React.createElement(
        RN.View, { style: { marginTop: 8 } },
        React.createElement(RN.Text, { style: { color: "#e9a" } }, "No device picker found here. Paste an image link instead:"),
        React.createElement(RN.TextInput, {
          defaultValue: draft.dmImageUrl, autoCapitalize: "none", autoCorrect: false, placeholder: "https://...", placeholderTextColor: "#777",
          onChangeText: (t) => { draft.dmImageUrl = t; },
          style: { color: "#fff", borderWidth: 1, borderColor: "#555", borderRadius: 8, padding: 10, marginTop: 6 },
        })
      ),
      React.createElement(RN.Text, { style: { color: "#aaa", marginTop: 10 } }, "Image strength: " + Math.round(op * 100) + "%"),
      React.createElement(Slider, { value: op, min: 0.05, max: 1, colors: ["#333", "#fff"], onChange: (v) => { setOp(v); draft.dmImageOpacity = v; } }),
      React.createElement(RN.Text, { style: { color: "#aaa", marginTop: 6 } }, "Blur: " + Math.round(blur)),
      React.createElement(Slider, { value: blur, min: 0, max: 20, colors: ["#fff", "#778"], onChange: (v) => { setBlur(v); draft.bgBlur = v; } })
    );
  }

  function AnimSection() {
    const [sp, setSp] = React.useState(clamp(parseFloat(draft.animSpeed) || 0.6, 0.15, 1));
    return React.createElement(
      RN.View, { style: card },
      React.createElement(Label, null, "Animation speed"),
      React.createElement(RN.Text, { style: { color: "#aaa", marginTop: 4 } }, sp >= 0.99 ? "Normal" : (1 / sp).toFixed(1) + "x faster"),
      React.createElement(Slider, { value: 1.15 - sp, min: 0, max: 1, colors: ["#555", "#4f5bd5"], onChange: (v) => { const x = clamp(1.15 - v, 0.15, 1); setSp(x); draft.animSpeed = x; } })
    );
  }

  const COLOR_FIELDS = [
    ["accentColor", "Theme / accent color"],
    ["bgColor", "Main background"],
    ["bgSecondaryColor", "Secondary background"],
    ["bgTertiaryColor", "Third background (side bars)"],
    ["inputColor", "Chat input box"],
    ["textColor", "Text color"],
    ["mutedTextColor", "Muted text color"],
    ["headerColor", "Header text color"],
    ["iconColor", "Icon color"],
    ["linkColor", "Link color"],
    ["outlineColor", "Outline color"],
    ["highlightColor", "Selected / pressed highlight"],
    ["dangerColor", "Danger / red color"],
    ["positiveColor", "Online / green color"],
  ];

  // ---------- pfp section ----------
  function PfpSection() {
    const [, tick] = React.useReducer((x) => x + 1, 0);
    const [uid, setUid] = React.useState("");
    const entries = Object.entries(storage.people || {}).filter(([, o]) => o.avatar);
    return React.createElement(
      RN.View, { style: card },
      React.createElement(Label, null, "Profile pictures (only you see them)"),
      React.createElement(RN.Text, { style: { color: "#bbb", marginTop: 6 } },
        "Open someone's profile, tap the three dots, and press snoozypfp (next to Change Friend Nickname). Tap Import and pick an image."),
      React.createElement(RN.Text, { style: { color: "#bbb", marginTop: 10 } },
        "Can't see snoozypfp? Backup: Developer Mode on, long-press a profile, Copy User ID, then paste it here."),
      React.createElement(RN.TextInput, {
        value: uid, onChangeText: setUid, placeholder: "User ID (numbers)", placeholderTextColor: "#777", autoCapitalize: "none", autoCorrect: false,
        style: { color: "#fff", borderWidth: 1, borderColor: "#555", borderRadius: 8, padding: 10, marginTop: 8 },
      }),
      React.createElement(Btn, {
        label: "Import picture for this ID",
        onPress: () => {
          const id = uid.trim();
          if (!/^\d{5,25}$/.test(id)) { showToast("That doesn't look like a user ID"); return; }
          askAndImport(id, () => { setUid(""); tick(); });
        },
      }),
      entries.length ? React.createElement(RN.Text, { style: { color: "#fff", fontWeight: "600", marginTop: 14 } }, "Saved pictures") : null,
      ...entries.map(([id, o]) =>
        React.createElement(
          RN.View, { key: id, style: { flexDirection: "row", alignItems: "center", marginTop: 10 } },
          React.createElement(RN.Image, { source: { uri: o.avatar }, style: { width: 40, height: 40, borderRadius: 20, marginRight: 10 } }),
          React.createElement(RN.Text, { style: { color: "#fff", flex: 1 } }, id),
          React.createElement(Btn, { label: "Remove", danger: true, onPress: () => { savePerson(id, { avatar: "" }); tick(); } })
        )
      ),
      React.createElement(RN.Text, { style: { color: "#888", marginTop: 12, fontSize: 12 } }, hookStatus),
      React.createElement(RN.Text, { style: { color: "#888", marginTop: 4, fontSize: 12 } },
        "Sheets seen: " + (seenSheets.length ? seenSheets.join(", ") : "none yet") + "  |  snoozypfp rows added: " + menuHits)
    );
  }

  // ---------- settings page ----------
  function Settings() {
    React.useState(() => { loadDraft(); return 0; });
    const [status, setStatus] = React.useState("");
    const [now, setNow] = React.useState(!!draft.applyNow);

    return React.createElement(
      RN.View, { style: { flex: 1 } },
      React.createElement(
        RN.ScrollView,
        { style: { flex: 1 }, contentContainerStyle: { padding: 16, paddingBottom: 190 } },
        React.createElement(RN.Text, { style: { color: "#fff", fontSize: 22, fontWeight: "700", marginBottom: 12 } }, "Snoozy Studio V4"),
        React.createElement(ThemeInfo, null),
        ...COLOR_FIELDS.map(([id, label]) => React.createElement(ColorRow, { key: id, id, label })),
        React.createElement(BackgroundSection, null),
        React.createElement(AnimSection, null),
        React.createElement(PfpSection, null),
        React.createElement(RN.Text, { style: { color: "#888" } }, "Pick your changes, then press SET. Each SET adds a new theme to your Themes app.")
      ),
      React.createElement(
        RN.View,
        { style: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 14, backgroundColor: "#1e1f22" } },
        status ? React.createElement(RN.Text, { style: { color: "#ccc", marginBottom: 8, textAlign: "center" } }, status) : null,
        React.createElement(
          RN.TouchableOpacity,
          { onPress: () => { draft.applyNow = !draft.applyNow; setNow(!!draft.applyNow); }, style: { marginBottom: 10, alignItems: "center" } },
          React.createElement(RN.Text, { style: { color: "#aab" } }, (now ? "[x]" : "[ ]") + " Use the new theme right away (restarts the app)")
        ),
        React.createElement(
          RN.TouchableOpacity,
          {
            onPress: async () => {
              applyAll();
              try {
                const msg = await applyTheme();
                setStatus(msg + (storage.applyNow ? ". Restarting..." : ". Find it in the Themes app."));
                showToast("Theme added");
                if (storage.applyNow) setTimeout(reloadApp, 2500);
              } catch (e) {
                setStatus("Couldn't make the theme: " + (e?.message || e));
              }
            },
            style: { paddingVertical: 14, borderRadius: 12, backgroundColor: "#4f5bd5", alignItems: "center" },
          },
          React.createElement(RN.Text, { style: { color: "#fff", fontSize: 18, fontWeight: "800" } }, "SET")
        )
      )
    );
  }

  exports.onLoad = () => {
    patchAvatars();
    patchSheets();
    patchMenu();
    patchAnimations();
  };
  exports.onUnload = () => {
    for (const unpatch of patches) { try { unpatch(); } catch {} }
    patches.length = 0;
  };
  exports.settings = Settings;

  return exports;
})({});
