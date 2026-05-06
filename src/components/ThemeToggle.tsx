import { Moon, Sun } from 'lucide-react';
import { useThemeStore } from '../themeStore';

export const ThemeToggle = () => {
  const { isDark, toggleTheme } = useThemeStore();

  return (
    <button
      onClick={toggleTheme}
      className="p-2 rounded-lg bg-opacity-20 hover:bg-opacity-30 transition-all duration-200
        dark:text-blue-300 text-blue-600
        dark:bg-gray-900 bg-blue-200 cursor-pointer hover:opacity-80 transition-opacity"
    >
      {isDark ? (
        <Sun className="w-5 h-5" />
      ) : (
        <Moon className="w-5 h-5" />
      )}
    </button>
  );
};
