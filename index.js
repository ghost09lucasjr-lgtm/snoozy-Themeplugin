(function (exports) {
  "use strict";

  const { findByProps, findByName } = vendetta.metro;
  const { after, instead } = vendetta.patcher;
  const { storage } = vendetta.plugin;
  const { React, ReactNative: RN } = vendetta.metro.common;
  const { showToast } = vendetta.ui.toasts;

  // ---------- defaults ----------
  const DEFAULTS = {
    textColor: "",      // TEXT_NORMAL
    mutedTextColor: "", // TEXT_MUTED
    headerColor: "",    // HEADER_PRIMARY
    outlineColor: "",   // borders
    accentColor: "",    // brand / buttons
    bgColor: "",        // main background
    bgSecondaryColor: "",
    dmImageUrl: "",
    dmImageOpacity: "0.5",
    animSpeed: "0.5",   // 1 = normal, 0.5 = twice as fast
  };
  for (const k in DEFAULTS) storage[k] ??= DEFAULTS[k];

  // ---------- color token map ----------
  const TOKENS = {
    textColor: ["TEXT_NORMAL", "INTERACTIVE_NORMAL"],
    mutedTextColor: ["TEXT_MUTED", "INTERACTIVE_MUTED"],
    headerColor: ["HEADER_PRIMARY", "HEADER_SECONDARY"],
    outlineColor: ["BORDER_FAINT", "BORDER_STRONG", "BORDER_SUBTLE", "BACKGROUND_MODIFIER_ACCENT"],
    accentColor: ["BRAND_500", "BUTTON_BACKGROUND_BRAND", "TEXT_BRAND", "CONTROL_BRAND_FOREGROUND"],
    bgColor: ["BACKGROUND_PRIMARY", "BACKGROUND_BASE_LOWEST"],
    bgSecondaryColor: ["BACKGROUND_SECONDARY", "BACKGROUND_BASE_LOW", "BACKGROUND_TERTIARY"],
  };

  const isHex = (s) => /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test((s || "").trim());
  const patches = [];

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

  // ---------- faster animations ----------
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

  // ---------- DM background image ----------
  function patchDMBackground() {
    try {
      const Wrapper = findByName("MessagesWrapper", false) || findByName("ChatView", false);
      if (!Wrapper) throw new Error("chat view not found");
      const holder = Wrapper.default ? Wrapper : { default: Wrapper };

      patches.push(
        after("default", holder, (args, ret) => {
          const url = (storage.dmImageUrl || "").trim();
          if (!url) return ret;
          return React.createElement(
            RN.View,
            { style: { flex: 1 } },
            React.createElement(RN.Image, {
              source: { uri: url },
              resizeMode: "cover",
              style: {
                position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
                opacity: parseFloat(storage.dmImageOpacity) || 0.5,
              },
            }),
            ret
          );
        })
      );
    } catch (e) {
      showToast("Theme Maker: DM background not supported on this build");
      console.log("[ThemeMaker] dm bg", e);
    }
  }

  // ---------- settings page ----------
  const FIELDS = [
    ["textColor", "Text color (#hex)"],
    ["mutedTextColor", "Muted text color (#hex)"],
    ["headerColor", "Header text color (#hex)"],
    ["outlineColor", "Outline color (#hex)"],
    ["accentColor", "Accent / theme color (#hex)"],
    ["bgColor", "Main background (#hex)"],
    ["bgSecondaryColor", "Secondary background (#hex)"],
    ["dmImageUrl", "DM background image URL"],
    ["dmImageOpacity", "DM image opacity (0 to 1)"],
    ["animSpeed", "Animation duration multiplier (0.5 = 2x faster)"],
  ];

  function Field({ id, label }) {
    const [val, setVal] = React.useState(String(storage[id] ?? ""));
    const isColor = id.endsWith("Color");
    const bad = isColor && val && !isHex(val);
    return React.createElement(
      RN.View,
      { style: { marginBottom: 14 } },
      React.createElement(RN.Text, { style: { color: bad ? "#ff5555" : "#aaaaaa", marginBottom: 4 } }, label),
      React.createElement(RN.TextInput, {
        value: val,
        autoCapitalize: "none",
        autoCorrect: false,
        placeholder: isColor ? "#rrggbb" : "",
        placeholderTextColor: "#666666",
        onChangeText: (t) => { setVal(t); storage[id] = t; },
        style: {
          color: "#ffffff", borderWidth: 1, borderRadius: 8, padding: 10,
          borderColor: isColor && isHex(val) ? val : "#555555",
        },
      })
    );
  }

  function Settings() {
    return React.createElement(
      RN.ScrollView,
      { style: { flex: 1 }, contentContainerStyle: { padding: 16 } },
      ...FIELDS.map(([id, label]) => React.createElement(Field, { key: id, id, label })),
      React.createElement(RN.Text, { style: { color: "#888888", marginTop: 8 } },
        "Leave a color blank to keep the default. Restart the app after changing colors or the image."
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
