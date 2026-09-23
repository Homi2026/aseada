import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Slot } from 'expo-router';
import Head from 'expo-router/head';
import React from 'react';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { TITULO_SITIO } from '@/constants/sitio';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      {/* El titulo se escribe aca y no en +html.tsx: expo-router inyecta su
          propio <title> al inicio del head y el navegador usa el primero. */}
      <Head>
        <title>{TITULO_SITIO}</title>
      </Head>
      <AnimatedSplashOverlay />
      <Slot />
    </ThemeProvider>
  );
}
