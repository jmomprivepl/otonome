import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface ThemeStore {
  isDark: boolean;
  toggleTheme: () => void;
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set) => ({
      isDark: false,
      toggleTheme: () => set((state) => ({ isDark: !state.isDark })),
    }),
    {
      name: 'theme-storage',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
