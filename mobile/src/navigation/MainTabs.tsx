import React from 'react';
import { Text } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import LobbyScreen from '../screens/LobbyScreen';
import WalletScreen from '../screens/WalletScreen';
import LeaderboardScreen from '../screens/LeaderboardScreen';
import ReferEarnScreen from '../screens/ReferEarnScreen';
import { theme } from '../theme';
import type { MainTabParamList } from '../types';

const Tab = createBottomTabNavigator<MainTabParamList>();

const ICONS: Record<keyof MainTabParamList, string> = {
  Home: '🏠',
  Wallet: '💰',
  Leaderboard: '🏆',
  Refer: '🎁',
};

export default function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: theme.gold,
        tabBarInactiveTintColor: theme.textMuted,
        tabBarStyle: { backgroundColor: theme.surface, borderTopColor: theme.border },
        tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>{ICONS[route.name]}</Text>,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
      })}
    >
      <Tab.Screen name="Home" component={LobbyScreen} options={{ title: 'Games' }} />
      <Tab.Screen name="Wallet" component={WalletScreen} options={{ title: 'Wallet' }} />
      <Tab.Screen name="Leaderboard" component={LeaderboardScreen} options={{ title: 'Leaders' }} />
      <Tab.Screen name="Refer" component={ReferEarnScreen} options={{ title: 'Refer' }} />
    </Tab.Navigator>
  );
}
