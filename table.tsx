import { React, ReactNative as RN } from "@vendetta/metro/common";

export const Stack = ({ spacing = 8, children, style }: any) => (
    <RN.View style={[{ gap: spacing }, style]}>{children}</RN.View>
);

export const SettingsScrollView = RN.ScrollView;

export function TableRowGroup({ title, children }: any) {
    return (
        <RN.View style={{
            marginBottom: 10,
            borderRadius: 12,
            overflow: "hidden",
            backgroundColor: "rgba(127,127,127,0.08)",
        }}>
            {title ? (
                <RN.Text style={{
                    paddingHorizontal: 14,
                    paddingTop: 12,
                    paddingBottom: 8,
                    fontSize: 12,
                    fontWeight: "700",
                    opacity: 0.65,
                }}>{title}</RN.Text>
            ) : null}
            {children}
        </RN.View>
    );
}

export function TableRow({ label, subLabel, onPress }: any) {
    return (
        <RN.Pressable
            onPress={onPress}
            style={({ pressed }: any) => ({
                paddingHorizontal: 14,
                paddingVertical: 12,
                minHeight: 56,
                justifyContent: "center",
                opacity: pressed ? 0.72 : 1,
                transform: [{ scale: pressed ? 0.995 : 1 }],
            })}
        >
            <RN.Text style={{ fontSize: 16, fontWeight: "600" }}>{label}</RN.Text>
            {subLabel ? (
                <RN.Text style={{ marginTop: 3, fontSize: 12, opacity: 0.55 }}>{subLabel}</RN.Text>
            ) : null}
        </RN.Pressable>
    );
}

export function TableSwitchRow({ label, subLabel, value, onValueChange }: any) {
    return (
        <RN.View style={{
            minHeight: 58,
            paddingHorizontal: 14,
            paddingVertical: 9,
            flexDirection: "row",
            alignItems: "center",
        }}>
            <RN.View style={{ flex: 1 }}>
                <RN.Text style={{ fontSize: 16, fontWeight: "600" }}>{label}</RN.Text>
                {subLabel ? <RN.Text style={{ marginTop: 3, fontSize: 12, opacity: 0.55 }}>{subLabel}</RN.Text> : null}
            </RN.View>
            <RN.Switch value={value} onValueChange={onValueChange} />
        </RN.View>
    );
}
