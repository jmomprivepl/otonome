import { pipeline, WhisperTextStreamer } from '@huggingface/transformers';

// Define model factories
// Ensures only one model is created of each type
class PipelineFactory {
  static task: string | null = null;
  static model: string | null = null;
  static instance: any = null;
  tokenizer: any;
  model: any;

  constructor(tokenizer: any, model: any) {
    this.tokenizer = tokenizer;
    this.model = model;
  }

  static async getInstance(progress_callback: ((progress: any) => void) | null = null) {
    if (this.instance === null) {
      this.instance = await pipeline(this.task as any, this.model as string, {
        dtype: {
          encoder_model: this.model === "onnx-community/whisper-large-v3-turbo" ? "fp16" : "fp32",
          decoder_model_merged: "q4", // or 'fp32' ('fp16' is broken)
        },
        device: "webgpu",
        progress_callback: (progress: any) => {
          const percentage = Math.round(progress.progress);
          if (progress_callback && !Number.isNaN(percentage)) {
            progress_callback(progress);
          }
          self.postMessage({ 
            status: 'loading', 
            data: Number.isNaN(percentage) ? '' : `${percentage}%`
          });
        }
      });
    }

    return this.instance;
  }
}

interface WorkerMessage {
  type: 'load' | 'transcribe';
  data?: Float32Array | Int16Array | Int32Array | Uint8Array;
  audio?: Float32Array | Int16Array | Int32Array | Uint8Array;
  model?: string;
  subtask?: 'transcribe' | 'translate';
  language?: string;
}

self.addEventListener("message", async (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;

  // Process the message based on its type
  switch (message.type) {
    case 'load':
      try {
        const { model } = message;
        
        // Update model if specified
        if (model) {
          AutomaticSpeechRecognitionPipelineFactory.model = model;
          
          // Invalidate existing instance if model changed
          if (AutomaticSpeechRecognitionPipelineFactory.instance !== null) {
            (await AutomaticSpeechRecognitionPipelineFactory.getInstance()).dispose();
            AutomaticSpeechRecognitionPipelineFactory.instance = null;
          }
        }
        
        await AutomaticSpeechRecognitionPipelineFactory.getInstance((progress) => {
          const percentage = Math.round(progress.progress);
          self.postMessage({ 
            status: 'loading', 
            data: Number.isNaN(percentage) ? '' : `${percentage}%` 
          });
        });
        self.postMessage({ status: 'ready' });
      } catch (error) {
        console.error('Error loading Whisper model:', error);
        self.postMessage({ 
          status: 'error', 
          error: String(error) 
        });
      }
      break;
      
    case 'transcribe':
      // Handle both formats: { audio } and { data }
      const audioData = message.audio || message.data;
      if (!audioData) {
        self.postMessage({ 
          status: 'error', 
          error: 'No audio data provided' 
        });
        break;
      }
      
      const result = await transcribe({
        audio: audioData,
        model: message.model,
        subtask: message.subtask,
        language: message.language
      });
      
      if (result) {
        self.postMessage({ 
          status: 'transcription', 
          data: result.text || result.toString() 
        });
      }
      break;
      
    default:
      console.warn('Unknown message type:', message.type);
  }
});

class AutomaticSpeechRecognitionPipelineFactory extends PipelineFactory {
  static task: string = 'automatic-speech-recognition' as const;
  static model: string = 'onnx-community/whisper-large-v3-turbo' as const; // Use the best model available
}

interface TranscribeParams {
  audio: Float32Array | Int16Array | Int32Array | Uint8Array;
  model?: string;
  subtask?: 'transcribe' | 'translate';
  language?: string;
}

interface TranscribeChunk {
  text: string;
  offset: number;
  timestamp: [number, number | null];
  finalised: boolean;
}

const transcribe = async ({ audio, model, subtask = 'transcribe', language = 'en' }: TranscribeParams) => {
  try {
    // Normalize audio to prevent issues with very quiet recordings
    const normalizedAudio = normalizeAudio(audio);
    
    const isDistilWhisper = model?.startsWith("distil-whisper/");

    const p = AutomaticSpeechRecognitionPipelineFactory;
    if (p.model !== model && model) {
      // Invalidate model if different
      p.model = model;

      if (p.instance !== null) {
        (await p.getInstance()).dispose();
        p.instance = null;
      }
    }

    // Load transcriber model
    const transcriber = await p.getInstance((data) => {
      self.postMessage(data);
    });

    const time_precision =
      transcriber.processor.feature_extractor.config.chunk_length /
      transcriber.model.config.max_source_positions;

    // Storage for chunks to be processed. Initialise with an empty chunk.
    const chunks: TranscribeChunk[] = [];

    const chunk_length_s = isDistilWhisper ? 20 : 30;
    const stride_length_s = isDistilWhisper ? 3 : 5;

    let chunk_count = 0;
    let start_time;
    let num_tokens = 0;
    let tps: number | null = null;
    const streamer = new WhisperTextStreamer(transcriber.tokenizer, {
      time_precision,
      on_chunk_start: (x) => {
        const offset = (chunk_length_s - stride_length_s) * chunk_count;
        chunks.push({
          text: "",
          timestamp: [offset + x, null],
          finalised: false,
          offset,
        });
      },
      token_callback_function: (x) => {
        start_time ??= performance.now();
        if (num_tokens++ > 0) {
          tps = (num_tokens / (performance.now() - start_time)) * 1000;
        }
      },
      callback_function: (x) => {
        if (chunks.length === 0) return;
        // Append text to the last chunk
        chunks[chunks.length - 1].text += x;

        self.postMessage({
          status: "update",
          data: {
            text: chunks.map(c => c.text).join(' ').trim(),
            chunks,
            tps,
          },
        });
      },
      on_chunk_end: (x) => {
        const current = chunks[chunks.length - 1];
        current.timestamp[1] = x + current.offset;
        current.finalised = true;
      },
      on_finalize: () => {
        start_time = null;
        num_tokens = 0;
        ++chunk_count;
      },
    });

    // Actually run transcription
    const output = await transcriber(normalizedAudio, {
      // Greedy
      top_k: 0,
      do_sample: false,

      // Sliding window
      chunk_length_s,
      stride_length_s,

      // Language and task
      language,
      task: subtask,

      // Return timestamps
      return_timestamps: true,
      force_full_sequences: false,

      // Callback functions
      streamer, // after each generation step
    }).catch((error: any) => {
      console.error('[STT] Transcription error:', error);
      self.postMessage({ 
        status: "error",
        error: String(error),
      });
      return null;
    });

    if (!output) return null;
    
    console.log('[STT] Transcription complete:', output);
    
    // Ensure we have a text property in the result
    const result = {
      tps,
      text: output.text || chunks.map(c => c.text).join(' ').trim(),
      ...output,
    };
    
    // Send final transcription
    const finalTranscription = chunks.map(c => c.text).join(' ').trim();
    self.postMessage({
      status: 'transcription', 
      data: finalTranscription 
    });
    
    return result;
  } catch (error) {
    console.error('[STT] Error in transcribe function:', error);
    self.postMessage({
      status: "error",
      error: String(error),
    });
    return null;
  }
};

// Helper function to normalize audio data
function normalizeAudio(audioData: Float32Array | Int16Array | Int32Array | Uint8Array): Float32Array {
  // Convert to Float32Array if it's not already
  const floatData = audioData instanceof Float32Array ? 
    audioData : 
    new Float32Array(Array.from(audioData).map(v => 
      audioData instanceof Int16Array ? v / 32768 : 
      audioData instanceof Int32Array ? v / 2147483648 : 
      v / 255
    ));
  
  // Find the maximum absolute value
  let maxAbs = 0;
  for (let i = 0; i < floatData.length; i++) {
    const absValue = Math.abs(floatData[i]);
    if (absValue > maxAbs) {
      maxAbs = absValue;
    }
  }
  
  // If the audio is too quiet, normalize it
  if (maxAbs < 0.1) {
    const gain = 0.8 / maxAbs; // Target 80% of maximum
    for (let i = 0; i < floatData.length; i++) {
      floatData[i] *= gain;
    }
  }
  
  return floatData;
}
