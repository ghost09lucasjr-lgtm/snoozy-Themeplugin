(function (exports) {
  "use strict";

  const { findByProps } = vendetta.metro;
  const { after, before } = vendetta.patcher;
  const { storage } = vendetta.plugin;
  const { React, ReactNative: RN } = vendetta.metro.common;
  const { showToast } = vendetta.ui.toasts;

  storage.people ??= {}; // { userId: { avatar, nick? } }

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

  async function pickFromDevice() {
    const p = getPicker();
    if (!p) { showToast("No image picker found in this app build"); return ""; }
    try {
      if (p.type === "rnip") {
        const res = await p.mod.launchImageLibrary({ mediaType: "photo", includeBase64: true, quality: 0.8, maxWidth: 512, maxHeight: 512 });
        const a = res?.assets?.[0];
        if (!a) return "";
        return a.base64 ? `data:${a.type || "image/jpeg"};base64,${a.base64}` : a.uri;
      }
      const a = await p.mod.openPicker({ mediaType: "photo", includeBase64: true, compressImageQuality: 0.8, width: 512, height: 512, cropping: true });
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

  // ---------- settings page (backup way + status) ----------
  const Btn = ({ label, onPress, danger }) =>
    React.createElement(
      RN.TouchableOpacity,
      { onPress, style: { paddingVertical: 9, paddingHorizontal: 14, borderRadius: 8, backgroundColor: danger ? "#8b2c2c" : "#4f5bd5", marginRight: 8, marginTop: 8 } },
      React.createElement(RN.Text, { style: { color: "#fff", fontWeight: "600" } }, label)
    );

  function Settings() {
    const [, tick] = React.useReducer((x) => x + 1, 0);
    const [uid, setUid] = React.useState("");
    const entries = Object.entries(storage.people || {}).filter(([, o]) => o.avatar);
    const card = { marginBottom: 12, padding: 12, borderRadius: 12, backgroundColor: "#2b2d31" };

    return React.createElement(
      RN.ScrollView,
      { style: { flex: 1 }, contentContainerStyle: { padding: 16, paddingBottom: 60 } },
      React.createElement(RN.Text, { style: { color: "#fff", fontSize: 22, fontWeight: "700", marginBottom: 12 } }, "Snoozy pfp changer V3"),

      React.createElement(
        RN.View, { style: card },
        React.createElement(RN.Text, { style: { color: "#fff", fontSize: 16, fontWeight: "600" } }, "How to use"),
        React.createElement(RN.Text, { style: { color: "#bbb", marginTop: 6 } },
          "Open someone's profile, tap the three dots, and press snoozypfp (next to Change Friend Nickname). Tap Import and pick an image. Only you see the change."),
        React.createElement(RN.Text, { style: { color: "#bbb", marginTop: 10 } },
          "Can't see snoozypfp? Use the backup below: Developer Mode on, long-press a profile, Copy User ID."),
        React.createElement(RN.TextInput, {
          value: uid, onChangeText: setUid, placeholder: "User ID (numbers)", placeholderTextColor: "#777",
          autoCapitalize: "none", autoCorrect: false,
          style: { color: "#fff", borderWidth: 1, borderColor: "#555", borderRadius: 8, padding: 10, marginTop: 8 },
        }),
        React.createElement(Btn, {
          label: "Import picture for this ID",
          onPress: () => {
            const id = uid.trim();
            if (!/^\d{5,25}$/.test(id)) { showToast("That doesn't look like a user ID"); return; }
            askAndImport(id, () => { setUid(""); tick(); });
          },
        })
      ),

      React.createElement(
        RN.View, { style: card },
        React.createElement(RN.Text, { style: { color: "#fff", fontSize: 16, fontWeight: "600" } }, "Saved pictures"),
        entries.length === 0 ? React.createElement(RN.Text, { style: { color: "#888", marginTop: 6 } }, "None yet") : null,
        ...entries.map(([id, o]) =>
          React.createElement(
            RN.View, { key: id, style: { flexDirection: "row", alignItems: "center", marginTop: 10 } },
            React.createElement(RN.Image, { source: { uri: o.avatar }, style: { width: 40, height: 40, borderRadius: 20, marginRight: 10 } }),
            React.createElement(RN.Text, { style: { color: "#fff", flex: 1 } }, id),
            React.createElement(Btn, { label: "Remove", danger: true, onPress: () => { savePerson(id, { avatar: "" }); tick(); } })
          )
        ),
        React.createElement(Btn, {
          label: "Restart app to refresh",
          onPress: () => {
            try { RN.NativeModules.BundleUpdaterManager.reload(); }
            catch { showToast("Please close and reopen the app"); }
          },
        })
      ),

      React.createElement(
        RN.View, { style: card },
        React.createElement(RN.Text, { style: { color: "#fff", fontSize: 16, fontWeight: "600" } }, "Status"),
        React.createElement(RN.Text, { style: { color: "#999", marginTop: 6, fontSize: 12 } }, hookStatus),
        React.createElement(RN.Text, { style: { color: "#999", marginTop: 6, fontSize: 12 } },
          "Sheets seen: " + (seenSheets.length ? seenSheets.join(", ") : "none yet (open a profile)")),
        React.createElement(RN.Text, { style: { color: "#999", marginTop: 6, fontSize: 12 } },
          "snoozypfp rows added so far: " + menuHits)
      )
    );
  }

  exports.onLoad = () => {
    patchAvatars();
    patchSheets();
    patchMenu();
  };
  exports.onUnload = () => {
    for (const unpatch of patches) { try { unpatch(); } catch {} }
    patches.length = 0;
  };
  exports.settings = Settings;

  return exports;
})({});
