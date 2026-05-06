import { useState, useEffect } from 'react';
import { ThemeToggle } from './ThemeToggle';
import { useThemeStore } from '../themeStore';
import { useNavigate } from 'react-router-dom';

export function Landing() {
  const { isDark } = useThemeStore();
  const navigate = useNavigate();
  const [inputValue, setInputValue] = useState('');
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [typewriterText, setTypewriterText] = useState('');
  const [typewriterIndex, setTypewriterIndex] = useState(0);
  const typewriterTexts = [
    'What would you like to delegate to your new workmates?',
    'Need help with marketing, research, or data analysis?',
    'Your AI team is ready to assist with any task!'
  ];
  
  // Image captions
  const imageCaptions = [
    "Your new Office Manager",
    "Your new Data Analyst",
    "Your new Project Manager",
    "Your new Software Expert",
    "Your new Researcher"
  ];
  
  // Animation cycle for the images
  useEffect(() => {
    const interval = setInterval(() => {
      setActiveImageIndex((prev) => (prev + 1) % 5);
    }, 4000); // Change image every 4 seconds for a more comfortable viewing pace
    
    return () => clearInterval(interval);
  }, []);
  
  // Typewriter effect
  useEffect(() => {
    let currentCharIndex = 0;
    let currentTextIndex = typewriterIndex;
    let isTyping = true;
    let pauseCounter = 0;
    
    const typingInterval = setInterval(() => {
      const currentFullText = typewriterTexts[currentTextIndex];
      
      if (isTyping) {
        // Typing phase
        if (currentCharIndex <= currentFullText.length) {
          setTypewriterText(currentFullText.slice(0, currentCharIndex));
          currentCharIndex++;
        } else {
          // Finished typing, start pause
          isTyping = false;
          pauseCounter = 0;
        }
      } else {
        // Pause phase after typing completes
        pauseCounter++;
        
        // After 2.5 seconds (50ms * 50 = 2500ms)
        if (pauseCounter >= 50) {
          // Move to next text
          const nextTextIndex = (currentTextIndex + 1) % typewriterTexts.length;
          setTypewriterIndex(nextTextIndex);
          
          // Reset for next text
          currentCharIndex = 0;
          isTyping = true;
          setTypewriterText('');
          clearInterval(typingInterval);
        }
      }
    }, 50); // Speed of typing
    
    return () => clearInterval(typingInterval);
  }, [typewriterIndex]);
  
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    navigate('/auth');
  };

  const handleButtonClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    navigate('/auth');
  };

  return (
    <div className="min-h-screen w-[95%] sm:w-[90%] md:w-[85%] lg:w-[80%] xl:w-[70%] mx-auto flex flex-col">
      {/* Header with logo */}
      <header className="p-4 flex flex-col sm:flex-row justify-between items-center gap-4">
        <img 
          src={`/${isDark ? 'workmates_logo_light.png' : 'workmates_logo.png'}`} 
          alt="Workmates.pro"
          className="h-20 w-auto" 
        />
        <div className="flex items-center gap-2 sm:gap-4 flex-wrap justify-center">
          <button 
            className="border-2 border-[#1B014E] dark:border-violet-400/30 px-4 py-1 rounded-lg transition-colors cursor-pointer text-[#1B014E] dark:text-violet-400 hover:bg-indigo-200 dark:hover:bg-indigo-600"
            onClick={handleButtonClick}
          >
            Sign in
          </button>
          <button 
            className="border-2 border-[#1B014E] dark:border-violet-400/30 px-4 py-1 rounded-lg transition-colors cursor-pointer bg-blue-900 dark:bg-violet-600 hover:bg-indigo-600 dark:hover:bg-violet-700 text-white"
            onClick={handleButtonClick}
          >
            Sign up
          </button>
          <ThemeToggle />
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 flex flex-col justify-center p-4 md:p-8 gap-8 sm:gap-10 md:gap-12 lg:gap-16 xl:gap-20">
        <div className="w-full flex flex-col md:flex-row">
          {/* Left side with images */}
          <div className="w-full md:w-1/2 flex justify-center items-center md:mr-6 lg:mr-10 mb-10 md:mb-0">
            <div className="relative flex flex-row">
              {/* Image container - maintains consistent total width */}
              <div className="flex w-full max-w-[600px] h-[250px] sm:h-[300px] md:h-[350px] lg:h-[400px] relative gap-1 sm:gap-2 md:gap-3 lg:gap-5 font-semibold">
                {/* Image 1 - Office Manager */}
                <div 
                  className={`h-100 rounded-xl overflow-hidden relative transition-all duration-700 ease-in-out ${activeImageIndex === 0 ? 'w-100 z-10 shadow-lg animate-expand' : 'w-[15%] cursor-pointer'}`}
                  onClick={() => setActiveImageIndex(0)}
                  style={{ transformOrigin: 'left center' }}
                >
                  <img 
                    src="/avatars/office_manager.png" 
                    alt="Office Manager"
                    className="h-full w-full object-cover" 
                  />
                  {/* Diagonal glare reflection overlay */}
                  <div className={`absolute inset-0 bg-gradient-to-br from-white/30 via-white/50 to-transparent ${activeImageIndex === 0 ? 'shiny' : 'opacity-0'}`}></div>
                  {/* Caption with reduced opacity */}
                  {activeImageIndex === 0 && (
                    <div className="absolute bottom-0 left-0 right-0 bg-black/20 text-white text-center py-2 fade-in">
                      <p className="text-shadow">{imageCaptions[0]}</p>
                    </div>
                  )}
                </div>
                
                {/* Image 2 - Data analyst */}
                <div 
                  className={`h-100 rounded-xl overflow-hidden relative transition-all duration-700 ease-in-out ${activeImageIndex === 1 ? 'w-100 z-10 shadow-lg animate-expand' : 'w-[15%] cursor-pointer'}`}
                  onClick={() => setActiveImageIndex(1)}
                  style={{ transformOrigin: 'left center' }}
                >
                  <img 
                    src="/avatars/developer.png" 
                    alt="Data Analyst" 
                    className="h-full w-full object-cover" 
                  />
                  {/* Diagonal glare reflection overlay */}
                  <div className={`absolute inset-0 bg-gradient-to-br from-white/30 via-white/50 to-transparent ${activeImageIndex === 1 ? 'shiny' : 'opacity-0'}`}></div>
                  {/* Caption with reduced opacity */}
                  {activeImageIndex === 1 && (
                    <div className="absolute bottom-0 left-0 right-0 bg-black/20 text-white text-center py-2 fade-in">
                      <p className="text-shadow">{imageCaptions[1]}</p>
                    </div>
                  )}
                </div>
                
                {/* Image 3 - Task Manager */}
                <div 
                  className={`h-100 rounded-xl overflow-hidden relative transition-all duration-700 ease-in-out ${activeImageIndex === 2 ? 'w-100 z-10 shadow-lg animate-expand' : 'w-[15%] cursor-pointer'}`}
                  onClick={() => setActiveImageIndex(2)}
                  style={{ transformOrigin: 'left center' }}
                >
                  <img 
                    src="/avatars/worker6.png" 
                    alt="Task Manager" 
                    className="h-full w-full object-cover" 
                  />
                  {/* Diagonal glare reflection overlay */}
                  <div className={`absolute inset-0 bg-gradient-to-br from-white/30 via-white/50 to-transparent ${activeImageIndex === 2 ? 'shiny' : 'opacity-0'}`}></div>
                  {/* Caption with reduced opacity */}
                  {activeImageIndex === 2 && (
                    <div className="absolute bottom-0 left-0 right-0 bg-black/20 text-white text-center py-2 fade-in">
                      <p className="text-shadow">{imageCaptions[2]}</p>
                    </div>
                  )}
                </div>
                
                {/* Image 4 - Developer */}
                <div 
                  className={`h-100 rounded-xl overflow-hidden relative transition-all duration-700 ease-in-out ${activeImageIndex === 3 ? 'w-100 z-10 shadow-lg animate-expand' : 'w-[15%] cursor-pointer'}`}
                  onClick={() => setActiveImageIndex(3)}
                  style={{ transformOrigin: 'left center' }}
                >
                  <img 
                    src="/avatars/worker4.png" 
                    alt="Developer" 
                    className="h-full w-full object-cover" 
                  />
                  {/* Diagonal glare reflection overlay */}
                  <div className={`absolute inset-0 bg-gradient-to-br from-white/30 via-white/50 to-transparent ${activeImageIndex === 3 ? 'shiny' : 'opacity-0'}`}></div>
                  {/* Caption with reduced opacity */}
                  {activeImageIndex === 3 && (
                    <div className="absolute bottom-0 left-0 right-0 bg-black/20 text-white text-center py-2 fade-in">
                      <p className="text-shadow">{imageCaptions[3]}</p>
                    </div>
                  )}
                </div>

                {/* Image 5 - Researcher */}
                <div 
                  className={`h-100 rounded-xl overflow-hidden relative transition-all duration-700 ease-in-out ${activeImageIndex === 4 ? 'w-100 z-10 shadow-lg animate-expand' : 'w-[15%] cursor-pointer'}`}
                  onClick={() => setActiveImageIndex(4)}
                  style={{ transformOrigin: 'left center' }}
                >
                  <img 
                    src="/avatars/researcher.png" 
                    alt="Researcher" 
                    className="h-full w-full object-cover" 
                  />
                  {/* Diagonal glare reflection overlay */}
                  <div className={`absolute inset-0 bg-gradient-to-br from-white/30 via-white/50 to-transparent ${activeImageIndex === 4 ? 'shiny' : 'opacity-0'}`}></div>
                  {/* Caption with reduced opacity */}
                  {activeImageIndex === 4 && (
                    <div className="absolute bottom-0 left-0 right-0 bg-black/20 text-white text-center py-2 fade-in">
                      <p className="text-shadow">{imageCaptions[4]}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Right side with key messae */}
          <div className="w-full mt-40 md:mt-0 md:ml-20 xl:ml-0 md:w-1/2 flex flex-col max-w-full lg:max-w-2xl justify-center text-center md:text-right items-center md:items-end">
            <h1 className="text-4xl sm:text-4xl md:text-5xl lg:text-6xl xl:text-7xl font-semibold text-[#1B014E] dark:text-violet-100 mb-4 md:mb-6 lg:mb-8">
              AI that works<br />
              <span className="bg-gradient-to-r from-cyan-400 via-emerald-400 to-purple-700 dark:from-cyan-300 via-emerald-400 to-purple-600 bg-clip-text text-transparent">with you</span>, <span className="bg-gradient-to-r from-purple-600 via-cyan-500 to-indigo-400 bg-[length:100%_6px] bg-no-repeat bg-bottom">for you!</span>
            </h1>
            
            <p className="text-lg sm:text-xl md:text-2xl lg:text-3xl xl:text-4xl text-gray-700 dark:text-gray-300 mb-6">
              Assign tasks{' '}
              <span className="bg-gradient-to-r from-cyan-500 via-emerald-400 to-purple-600 dark:from-cyan-400 dark:via-emerald-400 dark:to-purple-500 bg-clip-text text-transparent font-semibold">
                easily
              </span>
              {' '}to one of your<br />
              <span className="bg-gradient-to-r from-violet-600 via-indigo-500 to-cyan-500 dark:from-violet-400 dark:via-indigo-400 dark:to-cyan-400 bg-clip-text text-transparent font-semibold tabular-nums">
                7,625,597,484,987
              </span>
              {' '}virtual colleagues,<br />
              monitor results and get jobs done
            </p>
          </div>
        </div>

        <div className="w-full flex flex-col justify-center items-center sm:mt-20 md:mt-10 lg:mt-0">
          {/* Chat-like input */}
          <div className="w-full sm:w-[90%] md:w-[80%] lg:w-[70%] xl:w-[60%] bg-gradient-to-br from-[#F3F3F3] to-[#FAFAFA] dark:from-gray-800 dark:to-gray-700 text-start rounded-xl p-4 md:p-8 shadow-sm border border-white dark:border-gray-700 mb-8">
              <p className="text-xl text-gray-600 dark:text-gray-400 mb-6">
                <span>Office Manager:</span> {typewriterText}
              </p>
              <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-4 sm:gap-6">
                <div className="flex-1">
                  <input
                    type="text"
                    value={inputValue.length < 5 ? "You: " + inputValue : inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    placeholder="You: I want to..."
                    className="w-full focus:outline-none text-indigo-800 dark:text-indigo-300 text-xl"
                    autoFocus
                  />
                </div>
                <button
                  type="submit"
                  className="border border-violet-800 dark:border-violet-600 bg-gradient-to-br from-violet-400 via-violet-700 to-violet-500 dark:from-violet-800 dark:via-violet-600 dark:to-violet-700 text-sm text-white px-4 py-2 rounded-lg cursor-pointer hover:opacity-80 transition-opacity"
                >
                  &raquo; Get started
                </button>
              </form>
            </div>
        </div>

        <div className="w-full flex flex-col gap-5 sm:gap-10 md:gap-20">

          {/* Steps */}
          <div>
              <div className="flex flex-wrap justify-center items-center mb-2 gap-4 sm:gap-2">
                <div className="flex flex-col items-center mb-2 sm:mb-0">
                  <div className="cursor-pointer w-12 h-12 sm:w-14 sm:h-14 text-2xl sm:text-3xl rounded-lg bg-gradient-to-br from-[#F3F3F3] to-[#FAFAFA] dark:from-gray-800 dark:to-gray-700 shadow-sm border border-white dark:border-gray-700 flex items-center justify-center text-gray-800 dark:text-gray-200 font-semibold hover:opacity-80 transition-opacity">
                    1
                  </div>
                  <p className="text-center text-sm sm:text-base md:text-lg lg:text-xl mt-2 sm:mt-3 text-gray-600 dark:text-gray-400">Define your goals</p>
                </div>
                <div className="hidden sm:block h-0.5 w-8 md:w-12 lg:w-20 xl:w-24 mb-5 bg-gray-50 dark:bg-gray-100"></div>
                <div className="flex flex-col items-center mb-2 sm:mb-0">
                  <div className="cursor-pointer w-12 h-12 sm:w-14 sm:h-14 text-2xl sm:text-3xl rounded-lg bg-gradient-to-br from-[#F3F3F3] to-[#FAFAFA] dark:from-gray-800 dark:to-gray-700 shadow-sm border border-white dark:border-gray-700 flex items-center justify-center text-gray-800 dark:text-gray-200 font-semibold hover:opacity-80 transition-opacity">
                    2
                  </div>
                  <p className="text-center text-sm sm:text-base md:text-lg lg:text-xl mt-2 sm:mt-3 text-gray-600 dark:text-gray-400">Assemble the team</p>
                </div>
                <div className="hidden sm:block h-0.5 w-8 md:w-12 lg:w-20 xl:w-24 mb-5 bg-gray-50 dark:bg-gray-100"></div>
                <div className="flex flex-col items-center mb-2 sm:mb-0">
                  <div className="cursor-pointer w-12 h-12 sm:w-14 sm:h-14 text-2xl sm:text-3xl rounded-lg bg-gradient-to-br from-[#F3F3F3] to-[#FAFAFA] dark:from-gray-800 dark:to-gray-700 shadow-sm border border-white dark:border-gray-700 flex items-center justify-center text-gray-800 dark:text-gray-200 font-semibold hover:opacity-80 transition-opacity">
                    3
                  </div>
                  <p className="text-center text-sm sm:text-base md:text-lg lg:text-xl mt-2 sm:mt-3 text-gray-600 dark:text-gray-400">Monitor the results</p>
                </div>
                <div className="hidden sm:block h-0.5 w-8 md:w-12 lg:w-20 xl:w-24 mb-5 bg-gray-50 dark:bg-gray-100"></div>
                <div className="flex flex-col items-center mb-2 sm:mb-0">
                  <div className="cursor-pointer w-12 h-12 sm:w-14 sm:h-14 text-2xl sm:text-3xl rounded-lg bg-gradient-to-br from-[#F3F3F3] to-[#FAFAFA] dark:from-gray-800 dark:to-gray-700 shadow-sm border border-white dark:border-gray-700 flex items-center justify-center text-gray-800 dark:text-gray-200 font-semibold hover:opacity-80 transition-opacity">
                    4
                  </div>
                  <p className="text-center text-sm sm:text-base md:text-lg lg:text-xl mt-2 sm:mt-3 text-gray-600 dark:text-gray-400">The job is done!</p>
                </div>
              </div>
            </div>

            {/* Demo section */}
            <div>
              <h2 className="text-4xl text-[#1B014E] dark:text-violet-100 font-semibold mb-8">See it for yourself!</h2>
              <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-violet-200 dark:border-violet-800/30 relative overflow-hidden h-[250px] sm:h-[300px] md:h-[400px] lg:h-[500px] xl:h-[600px]">
                {/* This would be a placeholder for the demo video/animation */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-0 h-0 cursor-pointer hover:opacity-80 border-[#1B014E] dark:border-[#1B014E] border-t-24 sm:border-t-32 md:border-t-48 lg:border-t-64 border-t-transparent dark:border-t-transparent border-l-48 sm:border-l-64 md:border-l-96 lg:border-l-128 border-b-24 sm:border-b-32 md:border-b-48 lg:border-b-64 border-b-transparent dark:border-b-transparent ml-8 flex items-center justify-center cursor-pointer transition-colors">
                  </div>
                  <span className="absolute text-white text-sm sm:text-base font-medium">60s tour</span>
                </div>
              </div>

              <div className="mt-8 flex justify-center">
              <button
                  type="submit"
                  onClick={handleButtonClick}
                  className="border border-violet-800 dark:border-violet-600 bg-gradient-to-br from-violet-400 via-violet-700 to-violet-500 dark:from-violet-800 dark:via-violet-600 dark:to-violet-700 text-lg text-white px-4 py-2 rounded-lg cursor-pointer hover:opacity-80 transition-opacity"
                >
                  &raquo; Set up your AI team!
                </button>
              </div>
            </div>
        </div>
      </main>
    </div>
  );
}
