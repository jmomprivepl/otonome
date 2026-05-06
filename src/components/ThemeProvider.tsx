import { ReactNode } from 'react';
import { useThemeStore } from '../themeStore';

interface ThemeProviderProps {
  children: ReactNode;
}

export const ThemeProvider = ({ children }: ThemeProviderProps) => {
  const isDark = useThemeStore((state) => state.isDark);

  return (
    <div className={isDark ? 'dark' : ''}>
      {children}
    </div>
  );
};
