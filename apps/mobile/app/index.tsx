import { StyleSheet, Text, View } from 'react-native';
import tokens from '../../../design/tokens.json';

export default function Home() {
  if (__DEV__) {
    const Gallery = require('../src/testing/ComponentGallery').default;
    return <Gallery />;
  }
  return <View style={styles.screen}>
    <Text accessibilityRole="header" style={styles.title}>100pushupclub</Text>
    <Text style={styles.body}>100 is the goal. Start with what you can.</Text>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: tokens.colors.canvas, justifyContent: 'center', padding: tokens.layout.contentInset, gap: 16 },
  title: { fontSize: 28, fontWeight: '700', color: tokens.colors.textPrimary },
  body: { fontSize: 16, lineHeight: 24, color: tokens.colors.textSecondary },
});
