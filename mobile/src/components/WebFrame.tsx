import React from 'react';
import { Platform, View, StyleSheet } from 'react-native';

// Web MVP shell: on the web (Safari/Chrome soft launch) center the app at
// phone width against a dark page so it reads as a native app on desktop too.
// On iOS/Android this is a passthrough - the device already is phone-width.
export default function WebFrame({ children }: { children: React.ReactNode }) {
  if (Platform.OS !== 'web') return <>{children}</>;
  return (
    <View style={styles.page}>
      <View style={styles.frame}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#06080f' },
  frame: {
    flex: 1,
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    backgroundColor: '#0b0f1a',
    // Subtle "device" edges on wide screens (ignored on native).
    ...Platform.select({
      web: {
        borderLeftWidth: 1,
        borderRightWidth: 1,
        borderColor: '#141b2b',
      },
      default: {},
    }),
  },
});
