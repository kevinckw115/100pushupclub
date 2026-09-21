import { useEffect, useState } from 'react';
import type { PropsWithChildren } from 'react';
import { AccessibilityInfo, Animated, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import type { TextProps, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import Svg, { Circle } from 'react-native-svg';
import { theme as t, typography } from '../theme/theme';

export function Copy({ variant = 'body', style, ...props }: TextProps & { variant?: keyof typeof t.type }) {
  return <Text accessibilityRole={variant === 'title' || variant === 'section' ? 'header' : undefined} {...props} style={[typography(variant), style]} />;
}

export function AppScreen({ children, footer }: PropsWithChildren<{ footer?: React.ReactNode }>) {
  const { width } = useWindowDimensions();
  return <SafeAreaView edges={['top', 'left', 'right']} style={styles.fill}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingHorizontal: width < 375 ? t.layout.compactInset : t.layout.contentInset }]}>{children}</ScrollView>
    {footer}
  </SafeAreaView>;
}

export function Header({ onSettings }: { onSettings?: () => void }) {
  return <View style={styles.header}><Copy variant="wordmark" accessibilityRole="header" style={{ flex: 1 }}>100pushupclub</Copy>
    {onSettings && <IconButton name="settings-outline" label="Settings" onPress={onSettings} />}</View>;
}

export function Button({ label, onPress, secondary = false, disabled = false, busy = false, testID }: {
  label: string; onPress: () => void; secondary?: boolean; disabled?: boolean; busy?: boolean; testID?: string;
}) {
  return <Pressable testID={testID} accessibilityRole="button" accessibilityState={{ disabled: disabled || busy, busy }} disabled={disabled || busy} onPress={onPress}
    style={({ pressed }) => [styles.button, { backgroundColor: secondary || disabled ? t.colors.surface : pressed ? t.colors.accentPressed : t.colors.accent, borderColor: secondary || disabled ? t.colors.textSecondary : t.colors.accent }]}>
    <Copy variant="button" style={{ color: secondary || disabled ? t.colors.textPrimary : t.colors.onAccent, textAlign: 'center' }}>{busy ? 'Saving…' : label}</Copy>
  </Pressable>;
}

export function IconButton({ name, label, onPress, disabled }: { name: React.ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} onPress={onPress} disabled={disabled} style={styles.iconButton}>
    <Ionicons name={name} size={24} color={t.colors.textPrimary} accessible={false} />
  </Pressable>;
}

export function useReducedMotion() {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then(value => { if (alive) setReduced(value); });
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => { alive = false; listener.remove(); };
  }, []);
  return reduced;
}

export function ProgressRing({ total }: { total: string }) {
  const { width, fontScale } = useWindowDimensions();
  const size = width < 375 ? 200 : t.layout.ringDiameter;
  const fraction = BigInt(total) >= 100n ? 1 : Number(total) / 100;
  const [animated] = useState(() => new Animated.Value(fraction));
  const [progress, setProgress] = useState(fraction);
  const reduced = useReducedMotion();
  useEffect(() => {
    const id = animated.addListener(({ value }) => setProgress(value));
    Animated.timing(animated, { toValue: fraction, duration: reduced ? 0 : t.motion.progressMs, useNativeDriver: false }).start();
    return () => { animated.stopAnimation(); animated.removeListener(id); };
  }, [animated, fraction, reduced]);
  const radius = (size - t.layout.ringStroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const expanded = fontScale > 1.3 || total.length > 4;
  const label = <View style={expanded ? styles.expandedCount : styles.ringCount}>
    <Copy variant="count" style={{ textAlign: 'center', fontVariant: ['tabular-nums'] }}>{total}</Copy>
    <Copy style={{ textAlign: 'center' }}>of 100 today</Copy>
  </View>;
  return <View accessible accessibilityRole="image" accessibilityLabel={`${total} pushups today, goal 100.`} style={styles.ringWrap}>
    <View style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke={t.colors.track} strokeWidth={t.layout.ringStroke} fill="none" />
        {progress > 0 && <Circle cx={size / 2} cy={size / 2} r={radius} stroke={t.colors.accent} strokeWidth={t.layout.ringStroke} fill="none" strokeLinecap="round" strokeDasharray={`${circumference} ${circumference}`} strokeDashoffset={circumference * (1 - progress)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />}
      </Svg>
      {!expanded && label}
    </View>
    {expanded && label}
  </View>;
}

export function QuantityInput({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const step = (delta: number) => {
    const current = /^\d+$/.test(value.trim()) ? Number(value) : 10;
    onChange(String(Math.min(999, Math.max(1, current + delta))));
  };
  return <View style={{ gap: 16 }}>
    <View style={styles.quantityRow}>
      <IconButton name="remove" label="Decrease quantity" onPress={() => step(-1)} disabled={disabled} />
      <TextInput testID="quantity" accessibilityLabel="Pushup quantity" value={value} onChangeText={onChange} editable={!disabled} keyboardType="number-pad" selectTextOnFocus style={styles.input} />
      <IconButton name="add" label="Increase quantity" onPress={() => step(1)} disabled={disabled} />
    </View>
    <View style={styles.presets}>{[5, 10, 20, 25].map(quantity => <Pressable key={quantity} accessibilityRole="button" accessibilityLabel={`${quantity} pushups`} accessibilityState={{ selected: value === String(quantity), disabled: !!disabled }} disabled={disabled} onPress={() => onChange(String(quantity))} style={[styles.chip, value === String(quantity) && { borderColor: t.colors.accent, borderWidth: 2 }]}><Copy>{quantity}</Copy></Pressable>)}</View>
  </View>;
}

export function BottomSheet({ visible, onClose, title, children }: PropsWithChildren<{ visible: boolean; onClose: () => void; title: string }>) {
  const reduced = useReducedMotion();
  return <Modal visible={visible} transparent animationType={reduced ? 'none' : 'slide'} onRequestClose={onClose}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.sheetBackdrop}>
      <SafeAreaView edges={['bottom']} style={styles.sheet} accessibilityViewIsModal>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 24, gap: 24 }}>
          <View style={styles.header}><Copy variant="title" accessibilityRole="header" style={{ flex: 1 }}>{title}</Copy><IconButton name="close" label="Close" onPress={onClose} /></View>
          {children}
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  </Modal>;
}

export function Row({ title, detail, onPress }: { title: string; detail?: string; onPress?: () => void }) {
  const content = <><Copy style={{ flex: 1 }}>{title}</Copy>{detail && <Copy variant="caption" style={{ color: t.colors.textSecondary }}>{detail}</Copy>}{onPress && <Ionicons name="chevron-forward" size={20} color={t.colors.textSecondary} accessible={false} />}</>;
  return onPress ? <Pressable accessibilityRole="button" onPress={onPress} style={styles.row}>{content}</Pressable> : <View style={styles.row}>{content}</View>;
}

export function Notice({ children, error = false }: PropsWithChildren<{ error?: boolean }>) {
  return <View accessibilityRole={error ? 'alert' : undefined} style={styles.notice}><Copy style={{ color: error ? t.colors.accent : t.colors.textSecondary }}>{children}</Copy></View>;
}

export function Section({ title, children, style }: PropsWithChildren<{ title?: string; style?: ViewStyle }>) {
  return <View style={[{ gap: 16 }, style]}>{title && <Copy variant="section" accessibilityRole="header">{title}</Copy>}{children}</View>;
}

export const tabs = [
  { id: 'today', label: 'Today', icon: 'home' },
  { id: 'club', label: 'Club', icon: 'people' },
  { id: 'circles', label: 'Circles', icon: 'ellipse' },
  { id: 'you', label: 'You', icon: 'person' },
] as const;

export function TabBar({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  return <SafeAreaView edges={['bottom']} style={{ backgroundColor: t.colors.canvas, borderTopWidth: 1, borderColor: t.colors.divider }}>
    <View style={{ flexDirection: 'row', maxWidth: t.layout.maxContentWidth, width: '100%', alignSelf: 'center' }}>
      {tabs.map(tab => <Pressable key={tab.id} accessibilityRole="tab" accessibilityLabel={tab.label} aria-selected={selected === tab.id} accessibilityState={{ selected: selected === tab.id }} onPress={() => onSelect(tab.id)} style={{ flex: 1, minHeight: 64, minWidth: 48, alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 8 }}>
        <Ionicons name={selected === tab.id ? tab.icon : `${tab.icon}-outline`} size={24} color={selected === tab.id ? t.colors.accent : t.colors.textSecondary} accessible={false} />
        <Copy variant="navigation" style={{ color: selected === tab.id ? t.colors.accent : t.colors.textSecondary, fontWeight: selected === tab.id ? '700' : '500' }}>{tab.label}</Copy>
      </Pressable>)}
    </View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: t.colors.canvas },
  content: { flexGrow: 1, width: '100%', maxWidth: t.layout.maxContentWidth, alignSelf: 'center', paddingBottom: 32, gap: 24 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  button: { minHeight: t.layout.buttonHeight, borderRadius: t.layout.buttonRadius, borderWidth: 1, justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  iconButton: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  ringWrap: { alignItems: 'center', gap: 16 },
  ringCount: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' },
  expandedCount: { width: '100%', alignItems: 'center' },
  quantityRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { ...typography('headline'), flex: 1, minWidth: 0, width: 0, minHeight: 64, borderColor: t.colors.textSecondary, borderWidth: 1, borderRadius: 12, textAlign: 'center', padding: 12 },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexGrow: 1, minWidth: 48, minHeight: 48, borderColor: t.colors.textSecondary, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center', padding: 12 },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: t.colors.textPrimary + '66' },
  sheet: { maxHeight: '92%', width: '100%', maxWidth: t.layout.maxContentWidth, alignSelf: 'center', backgroundColor: t.colors.surface, borderTopLeftRadius: t.layout.sheetRadius, borderTopRightRadius: t.layout.sheetRadius },
  row: { minHeight: 56, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomColor: t.colors.divider, borderBottomWidth: 1 },
  notice: { padding: 16, borderWidth: 1, borderColor: t.colors.divider, borderRadius: 12 },
});
