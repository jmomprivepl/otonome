// -------------------------------------------------------------------------
// Python execution worker using Pyodide
// -------------------------------------------------------------------------
interface PyProxy {
  toJs(options?: { create_proxies?: boolean; dict_converter?: any }): any;
  destroy(): void;
  type: string;
}

interface PyodideInterface {
  globals: any;
  runPython(code: string): PyProxy;
  runPythonAsync(code: string): Promise<PyProxy>;
  loadPackage(names: string | string[]): Promise<any>;
  loadPackagesFromImports(code: string): Promise<any>;
  toPy(obj: any, options?: { depth?: number }): PyProxy;
  pyimport(mod_name: string): PyProxy;
  registerJsModule(name: string, module: object): void;
  unregisterJsModule(name: string): void;
  setInterruptBuffer?(buffer: Int32Array): void;
}

let pyodide: PyodideInterface | null = null;
let isPyodideLoading = false;
let isPyodideLoaded = false;

// -------------------------------------------------------------------------
// Initialize Pyodide and load packages
// -------------------------------------------------------------------------
async function initPyodide() {
  if (isPyodideLoaded) return;
  if (isPyodideLoading) {
    while (isPyodideLoading) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return;
  }

  try {
    isPyodideLoading = true;
    self.postMessage({ status: 'loading', message: 'Loading Pyodide...' });

    // Import the installed Pyodide package from npm
    // @ts-ignore
    const { loadPyodide } = await import('pyodide');

    // Initialize Pyodide using an explicit CDN URL
    pyodide = await loadPyodide({
      indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.27.4/full/',
      stdout: (text: string) => {
        // Send stdout directly to the main thread
        const currentNodeId = (self as any).currentNodeId;
        self.postMessage({ 
          type: 'stdout', 
          nodeId: currentNodeId,
          output: text  // Use a consistent field name
        });
      },
      stderr: (text: string) => {
        // Send stderr directly to the main thread
        const currentNodeId = (self as any).currentNodeId;
        self.postMessage({ 
          type: 'stderr', 
          nodeId: currentNodeId,
          output: text  // Use a consistent field name
        });
      },
    });

    if (pyodide) {
      // Ensure micropip is available
      await pyodide.loadPackage('micropip');

      // Reset Python stdout/stderr
      await pyodide.runPythonAsync(`
import sys, io
sys.stdout = io.StringIO()
sys.stderr = io.StringIO()
      `);

      // Prepare an asynchronous install & configuration script
      const installScript = `
      import sys, io, traceback
      import micropip

      sys.stdout = io.StringIO()
      sys.stderr = io.StringIO()

      print('Python version:', sys.version)
      print('Pyodide loaded successfully!')

      async def install_and_configure():
          print('Installing required packages...')
          # Ensure numpy is installed
          await micropip.install('numpy')
          print('Packages installed successfully')

      # Await the async installation/configuration function.
      await install_and_configure()
      print('Setup script finished successfully.')
      `;
      try {
        await pyodide.runPythonAsync(installScript);
      } catch (pyError) {
        // Capture the Python stderr to include in the error
        const pythonStderr = await pyodide.runPythonAsync("sys.stderr.getvalue()");
        throw new Error(`Pyodide DSPy setup failed:\n${pythonStderr}`);
      }

      isPyodideLoaded = true;
      isPyodideLoading = false;
      self.postMessage({ status: 'ready', message: 'Pyodide environment ready' });
    }
  } catch (error) {
    isPyodideLoading = false;
    self.postMessage({ status: 'error', error: (error as Error).message });
    console.error('Pyodide initialization error:', error);
  }
}

// -------------------------------------------------------------------------
// Execute Python code provided by the user
// -------------------------------------------------------------------------
async function executePython(code: string, nodeId: string, context?: Record<string, any>) {
  if (!pyodide) {
    self.postMessage({ status: 'error', message: 'Pyodide not initialized', nodeId });
    return;
  }
  
  // Store the current nodeId globally so stdout/stderr handlers can access it
  (self as any).currentNodeId = nodeId;

  try {
    // Setup stdout and stderr interception using a polling approach
    await pyodide.runPythonAsync(`
import sys, io
import asyncio

# Create a simple buffer for stdout/stderr that we'll check periodically
class StreamCapture(io.StringIO):
    def __init__(self):
        super().__init__()
        self._last_read_position = 0

    def write(self, text):
        super().write(text)
        return len(text)

    def get_new_output(self):
        current_value = self.getvalue()
        if self._last_read_position < len(current_value):
            new_output = current_value[self._last_read_position:]
            self._last_read_position = len(current_value)
            return new_output
        return ''

    def flush(self):
        pass

stdout_capture = StreamCapture()
stderr_capture = StreamCapture()

sys.stdout = stdout_capture
sys.stderr = stderr_capture
    `);

    // Pass context to Python if provided
    if (context) {
      const globals = pyodide.globals as any;
      if (typeof globals.set === 'function') {
        globals.set('js_context', pyodide.toPy(context));
      } else {
        await pyodide.runPythonAsync(`js_context = ${JSON.stringify(context)}`);
      }
    }

    let pollingInterval: number | null = null;
    const pollOutput = async () => {
      if (!pyodide) return;
      try {
        const stdout = await pyodide.runPythonAsync('stdout_capture.get_new_output()');
        if (stdout) await pyodide.runPythonAsync('sys.stdout.flush()'); // Explicit flush
        if (stdout) {
          self.postMessage({ type: 'stdout', nodeId: nodeId, output: stdout });
        }
        const stderr = await pyodide.runPythonAsync('stderr_capture.get_new_output()');
        if (stderr) await pyodide.runPythonAsync('sys.stderr.flush()'); // Explicit flush
        if (stderr) {
          self.postMessage({ type: 'stderr', nodeId: nodeId, output: stderr });
        }
      } catch (e) {
        console.error("Polling error:", e);
        // Optionally stop polling on error, or just log it
        if (pollingInterval) {
          self.clearInterval(pollingInterval);
          pollingInterval = null;
        }
      }
    };

    console.log('Executing Python code...');
    let pyResult: any = null;
    let executionError: any = null;

    // Start polling every 200ms
    pollingInterval = self.setInterval(pollOutput, 200);

    try {
      // Initialize "result" in Python
      await pyodide.runPythonAsync(`result = None`);

      // --- Async modification --- 
      let finalCode = code;
      if (code.includes('time.sleep')) {
        // Basic replacement - might need refinement for complex cases
        const asyncCode = code.replace(/time\.sleep/g, 'await asyncio.sleep');
        // Wrap in async main function
        finalCode = `
import asyncio
async def main():
  global result
${asyncCode.split('\n').map(line => '  ' + line).join('\n')}

asyncio.ensure_future(main())
        `;
        console.log("Running code asynchronously with asyncio wrapper.");
      }

      // Run the user-provided code
      await pyodide.runPythonAsync(finalCode);

      // If we ran async, the result might be set within the `main` function
      // We still attempt to get it from globals.
      pyResult = await pyodide.runPythonAsync('globals().get("result", None)'); 
    } catch (error) {
      console.error('Error during Python execution:', error);
      executionError = error; // Store JS error

      // Attempt to capture Python traceback within the Python environment
      await pyodide.runPythonAsync(`
import traceback
try:
  # Use a variable name that won't conflict with the error variable
  error_message_py = ${JSON.stringify(error instanceof Error ? error.message : String(error))}
  result = {
    'error': error_message_py,
    'traceback': traceback.format_exc()
  }
except Exception as capture_error_py:
  # Fallback if traceback capture fails
  result = {
    'error': 'Error capturing traceback: ' + str(capture_error_py),
    'traceback': '' # Provide empty traceback if capture failed
  }
`);
      pyResult = await pyodide.runPythonAsync('result');
    } finally {
      // Stop polling AFTER execution finishes or errors
      if (pollingInterval) {
        self.clearInterval(pollingInterval);
        pollingInterval = null;
      }
      // Ensure one final poll to catch any remaining output
      await pollOutput();

      // Send final result or error message
      // Convert PyProxy to JS object if necessary
      const resultData = pyResult?.toJs ? pyResult.toJs() : pyResult;
      
      if (executionError || (resultData && typeof resultData === 'object' && resultData.error)) {
        // Prioritize error from Python result if available (contains traceback)
        const finalError = resultData?.error || (executionError instanceof Error ? executionError.message : String(executionError));
        const finalTraceback = resultData?.traceback || '';
        self.postMessage({ type: 'error', nodeId: nodeId, error: finalError, traceback: finalTraceback });
      } else {
        self.postMessage({ type: 'python_result', nodeId: nodeId, result: resultData });
      }

      console.log('Python execution finished.');
      (self as any).currentNodeId = null; // Clear node ID
    }
  } catch (error) {
    self.postMessage({
      status: 'error',
      error: (error as Error).message,
      nodeId,
      isFinalResult: true // Flag to indicate this is the final result
    });
  }
}

// -------------------------------------------------------------------------
// Install a Python package at runtime using micropip
// -------------------------------------------------------------------------
async function installPackage(packageName: string, nodeId: string) {
  if (!pyodide) {
    self.postMessage({ status: 'error', message: 'Pyodide not initialized', nodeId });
    return;
  }
  try {
    self.postMessage({ status: 'loading', message: `Installing ${packageName}...`, nodeId });
    const escapedPackageName = packageName.replace(/'/g, "\\'");
    await pyodide.runPythonAsync(`
import micropip
await micropip.install('${escapedPackageName}')
    `);
    self.postMessage({
      status: 'success',
      message: `Package ${packageName} installed successfully`,
      nodeId,
    });
  } catch (error) {
    self.postMessage({
      status: 'error',
      error: `Failed to install ${packageName}: ${(error as Error).message}`,
      nodeId,
    });
  }
}

// -------------------------------------------------------------------------
// Handle messages from the main thread
// -------------------------------------------------------------------------
self.onmessage = async (event) => {
  const { type, code, nodeId, context, packageName, requestId, result, error } = event.data;
  try {
    switch (type) {
      case 'load':
        if (!isPyodideLoaded && !isPyodideLoading) {
          await initPyodide();
        } else if (isPyodideLoaded) {
          self.postMessage({ status: 'ready', message: 'Pyodide environment ready' });
        }
        break;
      case 'execute':
        if (!isPyodideLoaded) {
          self.postMessage({ status: 'error', message: 'Pyodide not initialized', nodeId });
          return;
        }
        await executePython(code, nodeId, context);
        break;
      case 'install':
        if (!isPyodideLoaded) {
          self.postMessage({ status: 'error', message: 'Pyodide not initialized', nodeId });
          return;
        }
        await installPackage(packageName, nodeId);
        break;
      case 'reset':
        isPyodideLoaded = false;
        isPyodideLoading = false;
        pyodide = null;
        self.postMessage({ status: 'reset', message: 'Pyodide environment reset' });
        break;
      case 'llm_response':
        if (pyodide && requestId) {
          if (error) {
            await pyodide.runPythonAsync(`
if hasattr(pyodide, 'set_error'):
    pyodide.set_error(${JSON.stringify(error)})
`);
          } else {
            await pyodide.runPythonAsync(`
if hasattr(pyodide, 'set_result'):
    pyodide.set_result(${JSON.stringify(result)})
`);
          }
        }
        break;
      default:
        self.postMessage({ status: 'error', message: `Unknown command: ${type}`, nodeId });
    }
  } catch (err) {
    console.error('Worker error:', err);
    self.postMessage({
      status: 'error',
      message: `Error in worker: ${err instanceof Error ? err.message : String(err)}`,
      nodeId,
    });
  }
};

// -------------------------------------------------------------------------
// Listen for LLM requests from Python code and forward them to the main thread
// -------------------------------------------------------------------------
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'llm_request') {
    self.postMessage({
      type: 'llm_request',
      prompt: event.data.prompt,
      requestId: event.data.requestId
    });
  }
});