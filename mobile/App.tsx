import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/contexts/AuthContext';
import RootNavigator from './src/navigation/RootNavigator';
import WebFrame from './src/components/WebFrame';

export default function App() {
  return (
    <SafeAreaProvider>
      <WebFrame>
        <AuthProvider>
          <RootNavigator />
        </AuthProvider>
      </WebFrame>
      <StatusBar style="light" />
    </SafeAreaProvider>
  );
}
