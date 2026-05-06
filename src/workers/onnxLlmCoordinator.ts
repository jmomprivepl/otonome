/**
 * ONNX / WebGPU chat LLM backend only. Loaded via dynamic import when NOT using native llama-cli,
 * so Tauri + native LLM never pull @huggingface/transformers into the dev optimizer or initial graph.
 */

function benchmarkGPU(): Promise<{ success: boolean; reason?: string; timeMs?: number }> {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');

    if (!gl) {
      resolve({ success: false, reason: 'WebGL/WebGL2 not supported' });
      return;
    }

    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') || gl.getExtension('EXT_disjoint_timer_query');
    if (!ext) {
      resolve({
        success: false,
        reason: 'Timer query extension not supported. Cannot accurately benchmark GPU time.',
      });
      return;
    }

    const vertexShaderSource = `#version 300 es
      in vec4 a_position;
      void main() {
        gl_Position = a_position;
      }
    `;

    const fragmentShaderSource = `#version 300 es
      precision highp float;
      out vec4 outColor;
      void main() {
        float sum = 0.0;
        for (int i = 0; i < 500000; i++) {
          sum += sin(float(i)) * cos(float(i)) * 0.00001;
        }
        outColor = vec4(fract(sum), fract(sum * 10.0), fract(sum * 100.0), 1.0);
      }
    `;

    function createShader(gl: WebGLRenderingContext | WebGL2RenderingContext, type: number, source: string) {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    }

    function createProgram(
      gl: WebGLRenderingContext | WebGL2RenderingContext,
      vShader: WebGLShader,
      fShader: WebGLShader,
    ) {
      const program = gl.createProgram();
      if (!program) return null;
      gl.attachShader(program, vShader);
      gl.attachShader(program, fShader);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        gl.deleteProgram(program);
        return null;
      }
      return program;
    }

    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
    if (!vertexShader || !fragmentShader) {
      resolve({ success: false, reason: 'Shader creation failed.' });
      return;
    }

    const program = createProgram(gl, vertexShader, fragmentShader);
    if (!program) {
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      resolve({ success: false, reason: 'Program creation failed.' });
      return;
    }

    const positionAttributeLocation = gl.getAttribLocation(program, 'a_position');
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 0, 0.5, 0.7, 0]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(positionAttributeLocation);
    gl.vertexAttribPointer(positionAttributeLocation, 2, gl.FLOAT, false, 0, 0);

    const isWebGL2 = gl instanceof WebGL2RenderingContext;
    const createQuery = isWebGL2 ? () => gl.createQuery() : () => ext.createQueryEXT();
    const deleteQuery = isWebGL2 ? (q: WebGLQuery) => gl.deleteQuery(q) : (q: WebGLQuery) => ext.deleteQueryEXT(q);
    const beginQuery = isWebGL2
      ? (q: WebGLQuery) => gl.beginQuery(ext.TIME_ELAPSED_EXT, q)
      : (q: WebGLQuery) => ext.beginQueryEXT(ext.TIME_ELAPSED_EXT, q);
    const endQuery = isWebGL2 ? () => gl.endQuery(ext.TIME_ELAPSED_EXT) : () => ext.endQueryEXT(ext.TIME_ELAPSED_EXT);
    const getQueryParameter = isWebGL2
      ? (q: WebGLQuery, p: number) => gl.getQueryParameter(q, p)
      : (q: WebGLQuery, p: number) => ext.getQueryObjectEXT(q, p);

    const QUERY_RESULT_AVAILABLE = isWebGL2 ? gl.QUERY_RESULT_AVAILABLE : ext.QUERY_RESULT_AVAILABLE_EXT;
    const QUERY_RESULT = isWebGL2 ? gl.QUERY_RESULT : ext.QUERY_RESULT_EXT;

    const query = createQuery();
    if (!query) {
      gl.deleteProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      resolve({ success: false, reason: 'Failed to create query object.' });
      return;
    }

    gl.useProgram(program);
    beginQuery(query);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    endQuery();

    const cleanup = () => {
      deleteQuery(query);
      gl.deleteProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      gl.deleteBuffer(positionBuffer);
      const loseContextExt = gl.getExtension('WEBGL_lose_context');
      if (loseContextExt) loseContextExt.loseContext();
    };

    const checkResult = () => {
      const available = getQueryParameter(query, QUERY_RESULT_AVAILABLE);
      if (available) {
        const timeElapsedNanos = getQueryParameter(query, QUERY_RESULT);
        cleanup();
        resolve({ success: true, timeMs: timeElapsedNanos / 1000000.0 });
      } else {
        setTimeout(checkResult, 10);
      }
    };

    setTimeout(checkResult, 0);
  });
}

async function determineOptimalModel(): Promise<string> {
  const result = await benchmarkGPU();
  if (!result.success) {
    return 'onnx-community/gemma-3-1b-it-ONNX';
  }
  if (result.timeMs! < 50) {
    return 'onnx-community/Phi-3.5-mini-instruct-onnx-web';
  }
  return 'onnx-community/Llama-3.2-1B-Instruct-q4f16';
}

export async function startOnnxLlmBackend(
  onMessage: (e: MessageEvent) => void,
): Promise<{ worker: Worker; modelId: string }> {
  const worker = new Worker(new URL('./enhanced-multichat.worker.ts', import.meta.url), {
    type: 'module',
  });
  worker.onmessage = onMessage;
  const modelId = await determineOptimalModel();
  return { worker, modelId };
}
