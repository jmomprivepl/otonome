import { useState, useEffect } from 'react';
import { HotTable } from '@handsontable/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import 'handsontable/dist/handsontable.full.css';
import PythonTerminal from './PythonTerminal'; // Import the terminal component

export type TaskResultType = 'spreadsheet' | 'slides' | 'text' | 'python';

export interface TaskResult {
  type: TaskResultType;
  data: {
    sheets?: {
      name: string;
      headers: string[];
      rows: string[][];
    }[];
    slides?: {
      title: string;
      image?: string;
      content: string;
    }[];
    text?: {
      title: string;
      content: string;
    };
    python?: {
      code: string;
      output?: string;
      fullResponse?: string;
    };
  };
}

interface TaskResultViewProps {
  result: TaskResult;
  className?: string;
  onExecutePython?: (code: string, taskId?: string) => void;
  taskId?: string;
  isExecuting?: boolean;
  liveOutput?: string; // Add liveOutput prop
}

export function TaskResultView({ result, className = '', onExecutePython, taskId, isExecuting = false, liveOutput = '' }: TaskResultViewProps) {
  // Auto-scroll to the bottom of Python output when it updates
  useEffect(() => {
    if (result.type === 'python' && result.data.python?.output) {
      const anchor = document.getElementById('python-output-anchor');
      if (anchor) {
        anchor.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }, [result.type === 'python' && result.data.python?.output]);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [showTerminal, setShowTerminal] = useState(false);

  if (!result) {
    return (
      <div className={`flex items-center justify-center ${className}`}>
        <p className="text-gray-500">No result to display</p>
      </div>
    );
  }

  if (result.type === 'spreadsheet' && result.data.sheets) {
    const sheet = result.data.sheets[0];
    return (
      <div className={`w-full ${className}`}>
        <HotTable
          data={sheet.rows}
          width={800}
          height={400}
          colWidths={160}
          colHeaders={sheet.headers}
          rowHeaders={true}
          autoColumnSize={true}
          licenseKey="non-commercial-and-evaluation"
          stretchH="all"
          contextMenu={true}
          className="htCenter"
        />
      </div>
    );
  }

  if (result.type === 'slides' && result.data.slides) {
    const slides = result.data.slides;
    const currentSlideData = slides[currentSlide];

    return (
      <div className={`w-full flex justify-center ${className}`}>
        <div className="relative min-h-[200px] w-[800px] bg-slate-50 dark:bg-sky-950 rounded-lg shadow-lg p-12">
          <div className="slide px-6 pb-6 min-h-[400px]">
            <h2 className="text-3xl font-bold mb-6 text-gray-800 dark:text-gray-200">{currentSlideData.title}</h2>
            {currentSlideData.image !== undefined ? (
              <div className="flex flex-row">
                <div className="w-2/3">
                  <p className="text-xl whitespace-pre-wrap text-gray-800 dark:text-gray-200 leading-10">{currentSlideData.content}</p>
                </div>
                <img
                  src={currentSlideData.image}
                  alt={currentSlideData.title}
                  className="mb-6"
                />
              </div>
            ) : (
              <p className="text-xl whitespace-pre-wrap text-gray-800 dark:text-gray-200 leading-10">{currentSlideData.content}</p>
            )}
          </div>
          
          {slides.length > 1 && (
            <>
              <button
                onClick={() => setCurrentSlide(prev => Math.max(0, prev - 1))}
                disabled={currentSlide === 0}
                className="absolute left-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-gray-100 dark:bg-sky-800 hover:bg-gray-200 dark:hover:bg-sky-700 disabled:opacity-50"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
              <button
                onClick={() => setCurrentSlide(prev => Math.min(slides.length - 1, prev + 1))}
                disabled={currentSlide === slides.length - 1}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-gray-100 dark:bg-sky-800 hover:bg-gray-200 dark:hover:bg-sky-700 disabled:opacity-50"
              >
                <ChevronRight className="w-6 h-6" />
              </button>
              <div className="absolute bottom-4 left-0 right-0 flex justify-center">
                <span className="px-3 py-1 bg-gray-100 dark:bg-sky-950 rounded-full text-sm">
                  {currentSlide + 1} / {slides.length}
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  if (result.type === 'text' && result.data.text) {
    return (
      <div className={`w-full ${className}`}>
        <div className="bg-white dark:bg-blue-950 rounded-lg shadow-lg p-6 max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold mb-6 text-gray-800 dark:text-gray-200">{result.data.text.title}</h2>
          <p className="text-gray-800 dark:text-gray-200 whitespace-pre-wrap text-base leading-relaxed">
            {result.data.text.content}
          </p>
        </div>
      </div>
    );
  }

  if (result.type === 'python' && result.data.python) {
    
    // Use the isExecuting prop if provided, or infer from the output message
    const isCurrentlyExecuting = isExecuting || result.data.python.output === 'Executing Python code...';
    
    // Consider code executed if there's any output that's not empty and not the executing message
    const hasExecuted = result.data.python.output && 
                      result.data.python.output !== '' && 
                      result.data.python.output !== 'Executing Python code...';
    
    const pythonData = result?.data as { python?: { code: string; output?: string; fullResponse?: string } };
    const pythonCode = pythonData?.python?.code;

    const handleExecuteClick = () => {
      if (pythonCode) {
        setShowTerminal(true); // Show terminal when execution starts
        onExecutePython?.(pythonCode, taskId); // Pass taskId
      }
    };

    return (
      <div className={`w-full ${className}`}>
        <div className="bg-white dark:bg-blue-950 rounded-lg shadow-lg p-6 max-w-3xl mx-auto">
          {result.data.python.fullResponse && (
            <>
              <h2 className="text-3xl font-bold mb-6 text-gray-800 dark:text-gray-200">Agent Response</h2>
              <div className="bg-gray-100 dark:bg-blue-900 rounded-lg p-4 mb-6">
                <p className="text-gray-800 dark:text-gray-200 whitespace-pre-wrap text-base leading-relaxed">
                  {result.data.python.fullResponse}
                </p>
              </div>
            </>
          )}
          
          <h2 className="text-3xl font-bold mb-6 text-gray-800 dark:text-gray-200">Code</h2>
          <div className="bg-gray-100 dark:bg-blue-900 rounded-lg p-4 mb-6 font-mono">
            <pre className="text-gray-800 dark:text-gray-200 whitespace-pre-wrap text-base leading-relaxed overflow-auto">
              {pythonCode}
            </pre>
          </div>
          
          {!hasExecuted && !isCurrentlyExecuting && onExecutePython && (
            <div className="mb-6 flex justify-center">
              <button 
                onClick={handleExecuteClick}
                className="bg-violet-600 hover:bg-violet-700 dark:bg-blue-600 dark:hover:bg-blue-700 text-white py-2 px-4 rounded-md transition-colors duration-200"
              >
                Execute Code
              </button>
            </div>
          )}
          
          {showTerminal && (
            <PythonTerminal 
              output={liveOutput} 
              className="task-result-terminal mt-4" // Pass output and optionally className
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex items-center justify-center ${className}`}>
      <p className="text-gray-500">Unsupported result type</p>
    </div>
  );
}