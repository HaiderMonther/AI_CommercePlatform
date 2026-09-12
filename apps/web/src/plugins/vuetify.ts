import '@mdi/font/css/materialdesignicons.css';
import 'vuetify/styles';
import { createVuetify } from 'vuetify';
import { ar } from 'vuetify/locale';
import { aliases, mdi } from 'vuetify/iconsets/mdi';

/**
 * Arabic-first, RTL by default. The palette is intentionally calm: a merchant looks at
 * this dashboard all day, so status colours carry the meaning and everything else stays
 * neutral.
 */
const lightTheme = {
  dark: false,
  colors: {
    background: '#F4F6FA',
    surface: '#FFFFFF',
    'surface-variant': '#EEF1F6',
    primary: '#1867C0',
    'primary-darken-1': '#14549E',
    secondary: '#0F766E',
    success: '#16A34A',
    warning: '#D97706',
    error: '#DC2626',
    info: '#0284C7',
    'on-surface': '#1A202C',
  },
};

const darkTheme = {
  dark: true,
  colors: {
    background: '#0F1419',
    surface: '#161C24',
    'surface-variant': '#1F2733',
    primary: '#5599E8',
    'primary-darken-1': '#3D7FCC',
    secondary: '#2DD4BF',
    success: '#4ADE80',
    warning: '#FBBF24',
    error: '#F87171',
    info: '#38BDF8',
    'on-surface': '#E6EAF0',
  },
};

export const vuetify = createVuetify({
  locale: {
    locale: 'ar',
    fallback: 'ar',
    messages: { ar },
    // Drives dir="rtl" on every Vuetify component; index.html sets it for the document.
    rtl: { ar: true },
  },
  icons: {
    defaultSet: 'mdi',
    aliases,
    sets: { mdi },
  },
  theme: {
    defaultTheme: 'light',
    themes: { light: lightTheme, dark: darkTheme },
  },
  defaults: {
    VCard: { rounded: 'lg', elevation: 0, border: true },
    VBtn: { rounded: 'lg', variant: 'flat' },
    VTextField: { variant: 'outlined', density: 'comfortable', hideDetails: 'auto' },
    VSelect: { variant: 'outlined', density: 'comfortable', hideDetails: 'auto' },
    VTextarea: { variant: 'outlined', density: 'comfortable', hideDetails: 'auto' },
    VAutocomplete: { variant: 'outlined', density: 'comfortable', hideDetails: 'auto' },
    VChip: { rounded: 'md' },
    VDataTable: { density: 'comfortable' },
    VAlert: { rounded: 'lg', variant: 'tonal' },
  },
});
