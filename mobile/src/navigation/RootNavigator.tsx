import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../contexts/AuthContext';
import AuthScreen from '../screens/AuthScreen';
import LobbyScreen from '../screens/LobbyScreen';
import WalletScreen from '../screens/WalletScreen';
import GameScreen from '../screens/GameScreen';
import ResultsScreen from '../screens/ResultsScreen';
import type { RootStackParamList } from '../types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  const { session, loading } = useAuth();

  if (loading) return null;

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: '#0f0f14' }, headerTintColor: '#fff' }}>
        {!session ? (
          <Stack.Screen name="Auth" component={AuthScreen} options={{ headerShown: false }} />
        ) : (
          <>
            <Stack.Screen name="Lobby" component={LobbyScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Wallet" component={WalletScreen} options={{ title: 'Wallet' }} />
            <Stack.Screen name="Game" component={GameScreen} options={{ title: 'Live Game' }} />
            <Stack.Screen name="Results" component={ResultsScreen} options={{ title: 'Results', headerBackVisible: false }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
