// Crux PrimeVue theme preset.
//
// Extracted from main.js so the configuration is importable/testable without
// booting the app (main.js calls bootstrap() at module load).
//
// Surface ramps follow Aura's convention: index 0 is the lightest, index 950
// the darkest, in BOTH colorSchemes. Aura's component tokens select different
// indices per scheme (dark dialogs use surface.900 for background, surface.0
// for text), so an inverted dark ramp renders overlays unreadable. Keep both
// ramps monotonic light -> dark.
export const adaptPresetConfig = {
  semantic: {
    primary: {
      50: '#FFF1EF',
      100: '#FFD9D2',
      200: '#FFB5A8',
      300: '#FF8F7C',
      400: '#FF7766',
      500: '#FF6B5C',
      600: '#E25A4A',
      700: '#B5413A',
      800: '#842922',
      900: '#4D1611',
      950: '#2B0A07',
    },
    formField: {
      borderRadius: '14px',
    },
    content: {
      borderRadius: '20px',
    },
    colorScheme: {
      light: {
        surface: {
          0: '#FFFFFF',
          50: '#F7F8FB',
          100: '#EEF0F6',
          200: '#DDE2EE',
          300: '#B7BFD2',
          400: '#7E8AA3',
          500: '#58637A',
          600: '#3F485E',
          700: '#2A3142',
          800: '#1B2030',
          900: '#141826',
          950: '#0A0D17',
        },
      },
      dark: {
        // Same monotonic light -> dark ramp as the light scheme. Aura selects
        // the dark-appropriate indices itself (overlay/content background ->
        // surface.900, text -> surface.0), so the palette must NOT be
        // pre-inverted. The previous reversed ramp made surface.900 near-white
        // and rendered every PrimeVue overlay (ConfirmDialog, Toast, dropdowns)
        // white-on-white in dark mode.
        surface: {
          0: '#FFFFFF',
          50: '#F7F8FB',
          100: '#EEF0F6',
          200: '#DDE2EE',
          300: '#B7BFD2',
          400: '#7E8AA3',
          500: '#58637A',
          600: '#3F485E',
          700: '#2A3142',
          800: '#1B2030',
          900: '#141826',
          950: '#0A0D17',
        },
      },
    },
  },
}
