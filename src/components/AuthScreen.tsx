import { useState } from 'react';
import { useKanbanStore } from '@/store';
import { ThemeToggle } from './ThemeToggle';
import { useThemeStore } from '../themeStore';
import { useNavigate } from 'react-router-dom';

export function AuthScreen() {
  const { setLoggedIn } = useKanbanStore();
  const [isSignUp, setIsSignUp] = useState(false);
  const { isDark } = useThemeStore();
  const navigate = useNavigate();
  
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoggedIn(true); // Immediately log in
    navigate('/');
  };

  const handleGoogleSignIn = () => {
    setLoggedIn(true); // Immediately log in for now
    navigate('/');
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8 bg-white/50 dark:bg-slate-950/50 backdrop-blur-lg p-6 rounded-xl border border-violet-200/50 dark:border-violet-800/50">
        <div className="flex justify-between items-center">
          <img src={`/${isDark ? 'workmates_logo_light.png' : 'workmates_logo.png'}`} alt="Workmates.pro" className="h-20 w-auto" />
          <ThemeToggle />
        </div>
        
        <p className="text-gray-600 dark:text-gray-400 text-center">Your AI-powered task management solution</p>

        <div className="flex gap-4 justify-center">
          <button 
            onClick={() => setIsSignUp(false)}
            className={`px-4 py-2 rounded-lg transition-colors ${!isSignUp ? 'bg-violet-500 text-white' : 'text-gray-600 dark:text-gray-400'}`}
          >
            Sign In
          </button>
          <button 
            onClick={() => setIsSignUp(true)}
            className={`px-4 py-2 rounded-lg transition-colors ${isSignUp ? 'bg-violet-500 text-white' : 'text-gray-600 dark:text-gray-400'}`}
          >
            Sign Up
          </button>
        </div>

        <button
          onClick={handleGoogleSignIn}
          className="w-full flex items-center justify-center gap-2 bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200 
            py-2 px-4 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
          </svg>
          Continue with Google
        </button>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-300 dark:border-gray-600"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-white/50 dark:bg-slate-950/50 text-gray-500">Or continue with email</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {isSignUp && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Full Name
              </label>
              <input
                type="text"
                placeholder="John Doe"
                className="w-full px-3 py-2 bg-white/50 dark:bg-slate-800/50 border border-violet-200/50 dark:border-violet-800/50 rounded-lg"
              />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Email
            </label>
            <input
              type="email"
              placeholder="you@example.com"
              className="w-full px-3 py-2 bg-white/50 dark:bg-slate-800/50 border border-violet-200/50 dark:border-violet-800/50 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Password
            </label>
            <input
              type="password"
              className="w-full px-3 py-2 bg-white/50 dark:bg-slate-800/50 border border-violet-200/50 dark:border-violet-800/50 rounded-lg"
            />
          </div>
          {isSignUp && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Confirm Password
              </label>
              <input
                type="password"
                className="w-full px-3 py-2 bg-white/50 dark:bg-slate-800/50 border border-violet-200/50 dark:border-violet-800/50 rounded-lg"
              />
            </div>
          )}
          <button
            type="submit"
            className="w-full bg-violet-500 hover:bg-violet-600 text-white py-2 px-4 rounded-lg transition-colors"
          >
            {isSignUp ? "Create Account" : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
