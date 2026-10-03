// SnoozyThemeMaker
// Theme maker for ShiggyCord / Vendetta-style clients.

const React = vendetta.metro.common.React;
const ReactNative = vendetta.metro.common.ReactNative;
const { navigation } = vendetta.navigation;
const storage = vendetta.storage;
const themes = vendetta.themes;

const STORAGE_KEY = "SnoozyThemeMaker.themes.v1";

const DEFAULT_THEME = {
    name: "Snoozy Theme",
    description: "A custom SnoozyCord theme.",
    colors: {
        background: "#111214",
        backgroundSecondary: "#18191C",
        backgroundTertiary: "#202225",
        dmBackground: "#111214",
        channelBackground: "#111214",
        messageBackground: "#111214",
        imageOutline: "#5865F2",
        theme: "#5865F2",
        accent: "#5865F2",
        text: "#FFFFFF",
        textSecondary: "#B9BBBE",
        textMuted: "#72767D",
        link: "#00AFF4",
        mention: "#5865F2",
        inputBackground: "#202225",
        buttonBackground: "#5865F2",
        divider: "#2F3136",
        border: "#2F3136",
        success: "#3BA55D",
        warning: "#FAA61A",
        danger: "#ED4245"
    }
};

let savedThemes = [];

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function loadThemes() {
    try {
        const value = storage.getItem(STORAGE_KEY);
        savedThemes = Array.isArray(value) ? value : [];
    } catch {
        savedThemes = [];
    }
}

function saveThemes() {
    try {
        storage.setItem(STORAGE_KEY, savedThemes);
    } catch (e) {
        console.log("[SnoozyThemeMaker] Could not save themes:", e);
    }
}

function hex(value) {
    value = String(value || "").trim();
    if (!value.startsWith("#")) value = "#" + value;

    if (/^#[0-9a-f]{3}$/i.test(value)) {
        value = "#" + value[1] + value[1] + value[2] + value[2] + value[3] + value[3];
    }

    return /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : "#000000";
}

function makeTheme(theme) {
    const c = theme.colors;

    return {
        spec: 2,
        name: theme.name,
        description: theme.description,
        author: "S-N-Ø-Ö-Z-Y",
        version: "1.0.0",
        type: "dark",

        semanticColors: {
            BACKGROUND_MOBILE_PRIMARY: c.background,
            BACKGROUND_MOBILE_SECONDARY: c.backgroundSecondary,
            BACKGROUND_PRIMARY: c.background,
            BACKGROUND_SECONDARY: c.backgroundSecondary,
            BACKGROUND_TERTIARY: c.backgroundTertiary,

            CHAT_BACKGROUND: c.dmBackground,
            CHANNELS_DEFAULT: c.textSecondary,

            TEXT_NORMAL: c.text,
            TEXT_MUTED: c.textMuted,
            TEXT_LINK: c.link,
            TEXT_POSITIVE: c.success,
            TEXT_WARNING: c.warning,
            TEXT_DANGER: c.danger,

            INTERACTIVE_NORMAL: c.textSecondary,
            INTERACTIVE_HOVER: c.text,
            INTERACTIVE_ACTIVE: c.text,

            BRAND_500: c.theme,
            BRAND_560: c.theme,
            BRAND_600: c.theme,
            BRAND_630: c.theme,
            BRAND_660: c.theme,
            BRAND_700: c.theme,

            INPUT_BACKGROUND: c.inputBackground,
            BUTTON_FILLED_BACKGROUND: c.buttonBackground,

            DIVIDER: c.divider,
            BORDER_STRONG: c.border,

            MENTION_BACKGROUND: c.mention,
            LINK: c.link
        },

        rawColors: {
            PRIMARY_100: c.text,
            PRIMARY_200: c.textSecondary,
            PRIMARY_300: c.textSecondary,
            PRIMARY_400: c.textMuted,

            PRIMARY_500: c.background,
            PRIMARY_600: c.backgroundSecondary,
            PRIMARY_630: c.backgroundSecondary,
            PRIMARY_645: c.backgroundTertiary,
            PRIMARY_660: c.backgroundTertiary,
            PRIMARY_700: c.background,
            PRIMARY_800: c.background,

            BRAND_260: c.theme,
            BRAND_360: c.theme,
            BRAND_430: c.theme,
            BRAND_500: c.theme,
            BRAND_530: c.theme,
            BRAND_560: c.theme,
            BRAND_600: c.theme,

            GREEN_360: c.success,
            GREEN_430: c.success,
            GREEN_530: c.success,

            YELLOW_300: c.warning,
            YELLOW_360: c.warning,

            RED_400: c.danger,
            RED_430: c.danger,
            RED_500: c.danger,
            RED_530: c.danger,

            BLUE_345: c.link,
            BLUE_330: c.link,

            WHITE_500: c.text,
            BLACK_500: c.background
        }
    };
}

function applyTheme(theme) {
    const built = makeTheme(theme);

    try {
        if (themes && typeof themes.applyTheme === "function") {
            themes.applyTheme(built);
            return true;
        }

        if (themes && typeof themes.updateTheme === "function") {
            themes.updateTheme(built);
            return true;
        }

        console.log("[SnoozyThemeMaker] Theme API not found.");
        return false;
    } catch (e) {
        console.log("[SnoozyThemeMaker] Theme apply error:", e);
        return false;
    }
}

function Field({label, value, onChange, placeholder}) {
    return React.createElement(
        ReactNative.View,
        {style: {marginBottom: 12}},
        React.createElement(
            ReactNative.Text,
            {style: {color: "#B9BBBE", fontSize: 13, marginBottom: 5}},
            label
        ),
        React.createElement(ReactNative.TextInput, {
            value: String(value ?? ""),
            placeholder,
            placeholderTextColor: "#72767D",
            onChangeText: onChange,
            style: {
                backgroundColor: "#202225",
                color: "#FFFFFF",
                borderRadius: 8,
                paddingHorizontal: 12,
                paddingVertical: 10
            }
        })
    );
}

function ColorField({label, value, onChange}) {
    return React.createElement(
        ReactNative.View,
        {style: {marginBottom: 12}},
        React.createElement(
            ReactNative.Text,
            {style: {color: "#B9BBBE", fontSize: 13, marginBottom: 5}},
            label
        ),
        React.createElement(
            ReactNative.View,
            {style: {flexDirection: "row", alignItems: "center"}},
            React.createElement(ReactNative.View, {
                style: {
                    width: 38,
                    height: 38,
                    borderRadius: 8,
                    backgroundColor: hex(value),
                    marginRight: 8
                }
            }),
            React.createElement(ReactNative.TextInput, {
                value: value,
                onChangeText: text => onChange(hex(text)),
                autoCapitalize: "none",
                style: {
                    flex: 1,
                    backgroundColor: "#202225",
                    color: "#FFFFFF",
                    borderRadius: 8,
                    paddingHorizontal: 12,
                    paddingVertical: 9
                }
            })
        )
    );
}

function Editor({existing}) {
    const [theme, setTheme] = React.useState(clone(existing || DEFAULT_THEME));

    const setColor = (key, value) => {
        setTheme(old => ({
            ...old,
            colors: {...old.colors, [key]: value}
        }));
    };

    const save = () => {
        const clean = clone(theme);
        clean.name = clean.name.trim() || "Snoozy Theme";
        clean.description = clean.description.trim();

        const id = existing && existing.id ? existing.id : Date.now().toString();

        const record = {
            ...clean,
            id,
            theme: makeTheme(clean)
        };

        const index = savedThemes.findIndex(x => x.id === id);

        if (index >= 0) savedThemes[index] = record;
        else savedThemes.push(record);

        saveThemes();
        applyTheme(record);

        navigation.pop();
    };

    const colorGroups = [
        ["Main", [
            ["background", "Main background"],
            ["backgroundSecondary", "Secondary background"],
            ["backgroundTertiary", "Tertiary background"],
            ["dmBackground", "DM background"],
            ["channelBackground", "Channel background"],
            ["messageBackground", "Message background"]
        ]],
        ["Appearance", [
            ["imageOutline", "Image outline"],
            ["theme", "Theme / brand"],
            ["accent", "Accent"],
            ["text", "Text"],
            ["textSecondary", "Secondary text"],
            ["textMuted", "Muted text"],
            ["link", "Links"],
            ["mention", "Mentions"]
        ]],
        ["Controls", [
            ["inputBackground", "Input background"],
            ["buttonBackground", "Button background"],
            ["divider", "Divider"],
            ["border", "Border"]
        ]],
        ["Status", [
            ["success", "Success"],
            ["warning", "Warning"],
            ["danger", "Danger"]
        ]]
    ];

    return React.createElement(
        ReactNative.ScrollView,
        {style: {flex: 1, backgroundColor: "#111214"}, contentContainerStyle: {padding: 16, paddingBottom: 40}},
        React.createElement(
            ReactNative.Text,
            {style: {color: "#FFFFFF", fontSize: 24, fontWeight: "700", marginBottom: 18}},
            "SnoozyThemeMaker"
        ),

        React.createElement(Field, {
            label: "Theme name",
            value: theme.name,
            onChange: value => setTheme({...theme, name: value}),
            placeholder: "My Theme"
        }),

        React.createElement(Field, {
            label: "Theme description",
            value: theme.description,
            onChange: value => setTheme({...theme, description: value}),
            placeholder: "Describe your theme"
        }),

        colorGroups.map(group =>
            React.createElement(
                ReactNative.View,
                {key: group[0], style: {marginTop: 8, marginBottom: 12}},
                React.createElement(
                    ReactNative.Text,
                    {style: {color: "#FFFFFF", fontSize: 17, fontWeight: "700", marginBottom: 10}},
                    group[0]
                ),
                group[1].map(([key, label]) =>
                    React.createElement(ColorField, {
                        key,
                        label,
                        value: theme.colors[key],
                        onChange: value => setColor(key, value)
                    })
                )
            )
        ),

        React.createElement(
            ReactNative.View,
            {style: {marginTop: 8}},
            React.createElement(
                ReactNative.TouchableOpacity,
                {
                    onPress: save,
                    style: {
                        backgroundColor: theme.colors.theme,
                        paddingVertical: 14,
                        borderRadius: 10,
                        alignItems: "center"
                    }
                },
                React.createElement(
                    ReactNative.Text,
                    {style: {color: "#FFFFFF", fontSize: 16, fontWeight: "700"}},
                    existing ? "SET / UPDATE THEME" : "SET / SAVE THEME"
                )
            )
        )
    );
}

function ThemeList() {
    loadThemes();

    const openEditor = theme => {
        navigation.push("SnoozyThemeMakerEditor", {
            title: "SnoozyThemeMaker",
            existing: theme
        });
    };

    return React.createElement(
        ReactNative.ScrollView,
        {
            style: {flex: 1, backgroundColor: "#111214"},
            contentContainerStyle: {padding: 16}
        },

        React.createElement(
            ReactNative.View,
            {
                style: {
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 18
                }
            },

            React.createElement(
                ReactNative.Text,
                {
                    style: {
                        color: "#FFFFFF",
                        fontSize: 24,
                        fontWeight: "700"
                    }
                },
                "Themes"
            ),

            React.createElement(
                ReactNative.TouchableOpacity,
                {
                    onPress: () => openEditor(null),
                    accessibilityLabel: "SnoozyThemeMaker",
                    accessibilityHint: "Open SnoozyThemeMaker",
                    style: {
                        minWidth: 52,
                        height: 40,
                        paddingHorizontal: 12,
                        borderRadius: 10,
                        backgroundColor: "#5865F2",
                        alignItems: "center",
                        justifyContent: "center"
                    }
                },
                React.createElement(
                    ReactNative.Text,
                    {
                        style: {
                            color: "#FFFFFF",
                            fontSize: 17,
                            fontWeight: "800"
                        }
                    },
                    "Zz"
                )
            )
        ),

        React.createElement(
            ReactNative.Text,
            {
                style: {
                    color: "#B9BBBE",
                    fontSize: 13,
                    marginBottom: 14
                }
            },
            "Tap Zz to create your own theme."
        ),

        savedThemes.map(theme =>
            React.createElement(
                ReactNative.View,
                {
                    key: theme.id,
                    style: {
                        backgroundColor: "#18191C",
                        borderRadius: 12,
                        padding: 14,
                        marginBottom: 10
                    }
                },

                React.createElement(
                    ReactNative.View,
                    {
                        style: {
                            flexDirection: "row",
                            alignItems: "center"
                        }
                    },

                    React.createElement(ReactNative.View, {
                        style: {
                            width: 36,
                            height: 36,
                            borderRadius: 8,
                            backgroundColor: theme.colors.theme,
                            marginRight: 10
                        }
                    }),

                    React.createElement(
                        ReactNative.View,
                        {style: {flex: 1}},

                        React.createElement(
                            ReactNative.Text,
                            {
                                style: {
                                    color: "#FFFFFF",
                                    fontSize: 16,
                                    fontWeight: "700"
                                }
                            },
                            theme.name
                        ),

                        React.createElement(
                            ReactNative.Text,
                            {
                                style: {
                                    color: "#B9BBBE",
                                    marginTop: 3
                                }
                            },
                            theme.description || "No description"
                        )
                    )
                ),

                React.createElement(
                    ReactNative.View,
                    {
                        style: {
                            flexDirection: "row",
                            marginTop: 12
                        }
                    },

                    React.createElement(
                        ReactNative.TouchableOpacity,
                        {
                            onPress: () => applyTheme(theme),
                            style: {
                                flex: 1,
                                backgroundColor: theme.colors.theme,
                                padding: 10,
                                borderRadius: 8,
                                alignItems: "center",
                                marginRight: 6
                            }
                        },
                        React.createElement(
                            ReactNative.Text,
                            {
                                style: {
                                    color: "#FFFFFF",
                                    fontWeight: "700"
                                }
                            },
                            "APPLY"
                        )
                    ),

                    React.createElement(
                        ReactNative.TouchableOpacity,
                        {
                            onPress: () => openEditor(theme),
                            style: {
                                flex: 1,
                                backgroundColor: "#2F3136",
                                padding: 10,
                                borderRadius: 8,
                                alignItems: "center",
                                marginLeft: 6
                            }
                        },
                        React.createElement(
                            ReactNative.Text,
                            {
                                style: {
                                    color: "#FFFFFF",
                                    fontWeight: "700"
                                }
                            },
                            "EDIT"
                        )
                    )
                )
            )
        )
    );
}

function openMaker() {
    loadThemes();

    navigation.push("SnoozyThemeMaker", {
        title: "SnoozyThemeMaker"
    });
}

function patchNavigation() {
    /*
     * Register our two internal screens.
     * ShiggyCord/Vendetta navigation implementations differ between builds,
     * so this is intentionally kept isolated.
     */
    try {
        if (navigation.addScreen) {
            navigation.addScreen("SnoozyThemeMaker", ThemeList);
            navigation.addScreen("SnoozyThemeMakerEditor", Editor);
            return true;
        }
    } catch (e) {
        console.log("[SnoozyThemeMaker] Navigation registration failed:", e);
    }

    return false;
}

function start() {
    loadThemes();
    patchNavigation();

    console.log("[SnoozyThemeMaker] Loaded.");
}

function stop() {
    try {
        if (navigation.removeScreen) {
            navigation.removeScreen("SnoozyThemeMaker");
            navigation.removeScreen("SnoozyThemeMakerEditor");
        }
    } catch {}

    console.log("[SnoozyThemeMaker] Stopped.");
}

start();

module.exports = {
    onLoad: start,
    onUnload: stop,
    openMaker,
    getThemes: () => savedThemes
};
