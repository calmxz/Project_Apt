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
      50: '#EEF3FD',
      100: '#E6ECFA',
      200: '#C6D6F5',
      300: '#A9C2FF',
      400: '#8FB0FF',
      500: '#3B63D6',
      600: '#2A4FC0',
      700: '#1D4FC4',
      800: '#173FA0',
      900: '#12307A',
      950: '#0B1F50',
    },
    formField: {
      borderRadius: '4px',
    },
    content: {
      borderRadius: '4px',
    },
    colorScheme: {
      light: {
        surface: {
          0: '#FFFFFF',
          50: '#FCFCFA',
          100: '#F3F3EF',
          200: '#E4E4DF',
          300: '#C9C9C2',
          400: '#A3A39C',
          500: '#7C7C76',
          600: '#63635E',
          700: '#4A4A46',
          800: '#2E2F33',
          900: '#1F2126',
          950: '#141518',
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
          50: '#FCFCFA',
          100: '#F3F3EF',
          200: '#E4E4DF',
          300: '#C9C9C2',
          400: '#A3A39C',
          500: '#7C7C76',
          600: '#63635E',
          700: '#4A4A46',
          800: '#2E2F33',
          900: '#1F2126',
          950: '#141518',
        },
      },
    },
  },
}
