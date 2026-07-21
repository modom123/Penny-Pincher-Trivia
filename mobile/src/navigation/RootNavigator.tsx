import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../contexts/AuthContext';
import AuthScreen from '../screens/AuthScreen';
import UsernamePickerScreen from '../screens/UsernamePickerScreen';
import MainTabs from './MainTabs';
import GameScreen from '../screens/GameScreen';
import ResultsScreen from '../screens/ResultsScreen';
import { theme } from '../theme';
import type { RootStackParamList } from '../types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  const { session, loading, needsUsername } = useAuth();

  if (loading) return null;

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: theme.bg }, headerTintColor: theme.text }}>
        {!session ? (
          <Stack.Screen name="Auth" component={AuthScreen} options={{ headerShown: false }} />
        ) : needsUsername ? (
          <Stack.Screen name="Username" component={UsernamePickerScreen} options={{ headerShown: false }} />
        ) : (
          <>
            <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
            <Stack.Screen name="Game" component={GameScreen} options={{ title: 'Live Game' }} />
            <Stack.Screen name="Results" component={ResultsScreen} options={{ title: 'Results', headerBackVisible: false }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
