(function (exports) {
  "use strict";

  const { findByProps, findByName } = vendetta.metro;
  const { after, instead } = vendetta.patcher;
  const { storage } = vendetta.plugin;
  const { React, ReactNative: RN } = vendetta.metro.common;
  const { showToast } = vendetta.ui.toasts;

  const DEFAULTS = {
    textColor: "", mutedTextColor: "", headerColor: "", outlineColor: "",
    accentColor: "", bgColor: "", bgSecondaryColor: "",
    dmImage: "", dmImageUrl: "", dmImageOpacity: 0.3, animSpeed: 0.6,
  };
  for (const k in DEFAULTS) storage[k] ??= DEFAULTS[k];

  const TOKENS = {
    textColor: ["TEXT_NORMAL", "INTERACTIVE_NORMAL"],
    mutedTextColor: ["TEXT_MUTED", "INTERACTIVE_MUTED"],
    headerColor: ["HEADER_PRIMARY", "HEADER_SECONDARY"],
    outlineColor: ["BORDER_FAINT", "BORDER_STRONG", "BORDER_SUBTLE", "BACKGROUND_MODIFIER_ACCENT"],
    accentColor: ["BRAND_500", "BUTTON_BACKGROUND_BRAND", "TEXT_BRAND", "CONTROL_BRAND_FOREGROUND"],
    bgColor: ["BACKGROUND_PRIMARY", "BACKGROUND_BASE_LOWEST"],
    bgSecondaryColor: ["BACKGROUND_SECONDARY", "BACKGROUND_BASE_LOW", "BACKGROUND_TERTIARY"],
  };

  // ---------- color helpers ----------
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const isHex = (s) => /^#([0-9a-f]{6}|[0-9a-f]{8})$/i.test((s || "").trim());

  function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
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
    let h = 0, s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return { h, s: s * 100, l: l * 100 };
  }

  const patches = [];
  const KEYS = Object.keys(DEFAULTS);
  const draft = {};
  const loadDraft = () => { for (const k of KEYS) draft[k] = storage[k]; };
  loadDraft();

  function applyAll() {
    for (const k of KEYS) storage[k] = draft[k];
  }

  function reloadApp() {
    try {
      const m = RN.NativeModules.BundleUpdaterManager;
      if (m && m.reload) { m.reload(); return; }
    } catch (e) { console.log("[ThemeMaker] reload", e); }
    showToast("Saved. Fully close and reopen the app to apply");
  }

  let dmStatus = "not tried yet";

  // ---------- patch: colors ----------
  function patchColors() {
    try {
      const tokens = findByProps("internal", "colors");
      if (!tokens?.internal?.resolveSemanticColor) throw new Error("no resolver");
      patches.push(
        after("resolveSemanticColor", tokens.internal, (args, ret) => {
          const colorObj = args[1];
          for (const setting in TOKENS) {
            const val = storage[setting];
            if (!isHex(val)) continue;
            for (const name of TOKENS[setting]) {
              if (tokens.colors[name] && tokens.colors[name] === colorObj) return val.trim();
            }
          }
          return ret;
        })
      );
    } catch (e) {
      showToast("Theme Maker: color patch failed");
      console.log("[ThemeMaker] colors", e);
    }
  }

  // ---------- patch: animation speed ----------
  function patchAnimations() {
    try {
      patches.push(
        instead("timing", RN.Animated, (args, orig) => {
          const speed = parseFloat(storage.animSpeed);
          if (speed > 0 && speed !== 1 && args[1]) {
            args[1] = { ...args[1], duration: (args[1].duration ?? 300) * speed };
          }
          return orig(...args);
        })
      );
    } catch (e) {
      console.log("[ThemeMaker] anim", e);
    }
  }

  // ---------- patch: DM background ----------
  const ChannelStore = (() => {
    try { return findByProps("getChannel", "getDMFromUserId") || findByProps("getChannel"); }
    catch { return null; }
  })();

  function isDM(props) {
    try {
      const id = props?.channelId ?? props?.channel?.id;
      const ch = props?.channel ?? (id && ChannelStore?.getChannel?.(id));
      if (!ch) return true;
      return ch.type === 1 || ch.type === 3;
    } catch { return true; }
  }

  const CHAT_NAMES = ["MessagesWrapper", "ChatView", "ChannelView", "MessagesView", "ChatScreen", "ChannelScreen", "Messages", "ChannelContent"];

  function patchDMBackground() {
    const tried = [];
    for (const name of CHAT_NAMES) {
      let mod;
      try { mod = findByName(name, false); } catch {}
      if (!mod || typeof mod.default !== "function") { tried.push(name); continue; }
      try {
        patches.push(
          after("default", mod, (args, ret) => {
            const src = storage.dmImage || (storage.dmImageUrl || "").trim();
            if (!src || !isDM(args[0])) return ret;
            return React.createElement(
              RN.View, { style: { flex: 1 } }, ret,
              React.createElement(
                RN.View,
                { pointerEvents: "none", style: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 } },
                React.createElement(RN.Image, {
                  source: { uri: src }, resizeMode: "cover",
                  style: { flex: 1, opacity: clamp(parseFloat(storage.dmImageOpacity) || 0.3, 0, 1) },
                })
              )
            );
          })
        );
        dmStatus = "hooked into: " + name;
        return;
      } catch (e) { tried.push(name); }
    }
    dmStatus = "no chat view found. Tried: " + tried.join(", ");
    showToast("Theme Maker: DM background not supported on this build");
  }

  // ---------- image picker ----------
  function getPicker() {
    try {
      const a = findByProps("launchImageLibrary");
      if (a) return { type: "rnip", mod: a };
      const b = findByProps("openPicker");
      if (b) return { type: "crop", mod: b };
    } catch {}
    return null;
  }

  async function pickImage() {
    const p = getPicker();
    if (!p) { showToast("No image picker found in this build"); return false; }
    try {
      if (p.type === "rnip") {
        const res = await p.mod.launchImageLibrary({
          mediaType: "photo", includeBase64: true, quality: 0.7, maxWidth: 1600, maxHeight: 1600,
        });
        const a = res?.assets?.[0];
        if (!a) return false;
        draft.dmImage = a.base64 ? `data:${a.type || "image/jpeg"};base64,${a.base64}` : a.uri;
      } else {
        const a = await p.mod.openPicker({ mediaType: "photo", includeBase64: true, compressImageQuality: 0.7, width: 1600, height: 1600 });
        if (!a) return false;
        draft.dmImage = a.data ? `data:${a.mime || "image/jpeg"};base64,${a.data}` : (a.path?.startsWith("file") ? a.path : "file://" + a.path);
      }
      draft.dmImageUrl = "";
      showToast("Image set. Open a DM to see it");
      return true;
    } catch (e) {
      console.log("[ThemeMaker] picker", e);
      showToast("Picker cancelled or failed");
      return false;
    }
  }

  // ---------- UI: slider ----------
  function Slider({ value, min, max, onChange, colors }) {
    const [w, setW] = React.useState(0);
    const live = React.useRef({});
    live.current = { w, min, max, onChange };
    const startX = React.useRef(0);

    const upd = (x) => {
      const c = live.current;
      if (!c.w) return;
      const t = clamp(x / c.w, 0, 1);
      c.onChange(c.min + t * (c.max - c.min));
    };

    const pan = React.useMemo(() => RN.PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => { startX.current = e.nativeEvent.locationX; upd(startX.current); },
      onPanResponderMove: (e, g) => upd(startX.current + g.dx),
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

  const Btn = ({ label, onPress, danger }) =>
    React.createElement(
      RN.TouchableOpacity,
      { onPress, style: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, backgroundColor: danger ? "#8b2c2c" : "#4f5bd5", marginRight: 8, marginTop: 6 } },
      React.createElement(RN.Text, { style: { color: "#fff", fontWeight: "600" } }, label)
    );

  const Label = ({ children, style }) =>
    React.createElement(RN.Text, { style: { color: "#fff", fontSize: 16, fontWeight: "600", ...style } }, children);

  // ---------- UI: color row ----------
  const HUE_COLORS = Array.from({ length: 36 }, (_, i) => hslToHex(i * 10, 100, 50));

  function ColorRow({ id, label }) {
    const [open, setOpen] = React.useState(false);
    const [hsl, setHsl] = React.useState(isHex(draft[id]) ? hexToHsl(draft[id]) : { h: 210, s: 60, l: 50 });
    const [, tick] = React.useReducer((x) => x + 1, 0);
    const cur = isHex(draft[id]) ? draft[id] : null;

    const set = (p) => {
      const n = { ...hsl, ...p };
      setHsl(n);
      draft[id] = hslToHex(n.h, n.s, n.l);
    };

    const sat = Array.from({ length: 12 }, (_, i) => hslToHex(hsl.h, (i / 11) * 100, hsl.l));
    const lig = Array.from({ length: 12 }, (_, i) => hslToHex(hsl.h, hsl.s, (i / 11) * 100));

    return React.createElement(
      RN.View,
      { style: { marginBottom: 12, padding: 12, borderRadius: 12, backgroundColor: "#2b2d31" } },
      React.createElement(
        RN.TouchableOpacity,
        { onPress: () => setOpen(!open), style: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" } },
        React.createElement(Label, null, label),
        React.createElement(RN.View, {
          style: { width: 44, height: 28, borderRadius: 8, borderWidth: 2, borderColor: "#888", backgroundColor: cur || "#00000000" },
        })
      ),
      open && React.createElement(
        RN.View,
        { style: { marginTop: 10 } },
        React.createElement(RN.Text, { style: { color: "#aaa" } }, "Hue"),
        React.createElement(Slider, { value: hsl.h, min: 0, max: 360, colors: HUE_COLORS, onChange: (v) => set({ h: v }) }),
        React.createElement(RN.Text, { style: { color: "#aaa" } }, "Saturation"),
        React.createElement(Slider, { value: hsl.s, min: 0, max: 100, colors: sat, onChange: (v) => set({ s: v }) }),
        React.createElement(RN.Text, { style: { color: "#aaa" } }, "Lightness"),
        React.createElement(Slider, { value: hsl.l, min: 0, max: 100, colors: lig, onChange: (v) => set({ l: v }) }),
        React.createElement(RN.Text, { style: { color: "#aaa", marginTop: 4 } }, cur || "default"),
        React.createElement(Btn, { label: "Reset to default", danger: true, onPress: () => { draft[id] = ""; tick(); } })
      )
    );
  }

  // ---------- UI: image section ----------
  function ImageSection() {
    const [, tick] = React.useReducer((x) => x + 1, 0);
    const [op, setOp] = React.useState(clamp(parseFloat(draft.dmImageOpacity) || 0.3, 0, 1));
    const src = draft.dmImage || (draft.dmImageUrl || "").trim();
    const noPicker = !getPicker();

    return React.createElement(
      RN.View,
      { style: { marginBottom: 12, padding: 12, borderRadius: 12, backgroundColor: "#2b2d31" } },
      React.createElement(Label, null, "DM background image"),
      src ? React.createElement(RN.Image, { source: { uri: src }, resizeMode: "cover", style: { height: 140, borderRadius: 10, marginTop: 8, opacity: Math.max(op, 0.25) } }) : null,
      React.createElement(
        RN.View,
        { style: { flexDirection: "row", flexWrap: "wrap" } },
        React.createElement(Btn, { label: "Choose from device", onPress: async () => { await pickImage(); tick(); } }),
        src ? React.createElement(Btn, { label: "Remove", danger: true, onPress: () => { draft.dmImage = ""; draft.dmImageUrl = ""; tick(); } }) : null
      ),
      noPicker && React.createElement(
        RN.View,
        { style: { marginTop: 8 } },
        React.createElement(RN.Text, { style: { color: "#e9a" } }, "No device picker found here. Paste an image link instead:"),
        React.createElement(RN.TextInput, {
          defaultValue: draft.dmImageUrl, autoCapitalize: "none", autoCorrect: false, placeholder: "https://...",
          placeholderTextColor: "#777",
          onChangeText: (t) => { draft.dmImageUrl = t; },
          style: { color: "#fff", borderWidth: 1, borderColor: "#555", borderRadius: 8, padding: 10, marginTop: 6 },
        })
      ),
      React.createElement(RN.Text, { style: { color: "#aaa", marginTop: 10 } }, "Image strength: " + Math.round(op * 100) + "%"),
      React.createElement(Slider, { value: op, min: 0, max: 1, colors: ["#333", "#fff"], onChange: (v) => { setOp(v); draft.dmImageOpacity = v; } }),
      React.createElement(RN.Text, { style: { color: "#888", marginTop: 6, fontSize: 12 } }, "Status: " + dmStatus)
    );
  }

  // ---------- UI: animation section ----------
  function AnimSection() {
    const [sp, setSp] = React.useState(clamp(parseFloat(draft.animSpeed) || 0.6, 0.15, 1));
    return React.createElement(
      RN.View,
      { style: { marginBottom: 12, padding: 12, borderRadius: 12, backgroundColor: "#2b2d31" } },
      React.createElement(Label, null, "Animation speed"),
      React.createElement(RN.Text, { style: { color: "#aaa", marginTop: 4 } }, sp >= 0.99 ? "Normal" : (1 / sp).toFixed(1) + "x faster"),
      React.createElement(Slider, { value: 1.15 - sp, min: 0, max: 1, colors: ["#555", "#4f5bd5"], onChange: (v) => { const s = clamp(1.15 - v, 0.15, 1); setSp(s); draft.animSpeed = s; } })
    );
  }

  const COLOR_FIELDS = [
    ["accentColor", "Theme / accent color"],
    ["bgColor", "Main background"],
    ["bgSecondaryColor", "Secondary background"],
    ["textColor", "Text color"],
    ["mutedTextColor", "Muted text color"],
    ["headerColor", "Header text color"],
    ["outlineColor", "Outline color"],
  ];

  function Settings() {
    React.useState(() => { loadDraft(); return 0; });
    return React.createElement(
      RN.View,
      { style: { flex: 1 } },
      React.createElement(
        RN.ScrollView,
        { style: { flex: 1 }, contentContainerStyle: { padding: 16, paddingBottom: 110 } },
        React.createElement(RN.Text, { style: { color: "#fff", fontSize: 22, fontWeight: "700", marginBottom: 12 } }, "Theme Maker v3"),
        ...COLOR_FIELDS.map(([id, label]) => React.createElement(ColorRow, { key: id, id, label })),
        React.createElement(ImageSection, null),
        React.createElement(AnimSection, null),
        React.createElement(RN.Text, { style: { color: "#888" } },
          "Pick your changes, then press SET. The app restarts to apply them."
        )
      ),
      React.createElement(
        RN.View,
        { style: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 14, backgroundColor: "#1e1f22" } },
        React.createElement(
          RN.TouchableOpacity,
          {
            onPress: () => {
              applyAll();
              showToast("Set! Restarting...");
              setTimeout(reloadApp, 900);
            },
            style: { paddingVertical: 14, borderRadius: 12, backgroundColor: "#4f5bd5", alignItems: "center" },
          },
          React.createElement(RN.Text, { style: { color: "#fff", fontSize: 18, fontWeight: "800" } }, "SET")
        )
      )
    );
  }

  exports.onLoad = () => {
    patchColors();
    patchAnimations();
    patchDMBackground();
  };
  exports.onUnload = () => {
    for (const unpatch of patches) unpatch();
    patches.length = 0;
  };
  exports.settings = Settings;

  return exports;
})({});
