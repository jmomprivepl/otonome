import { KokoroTTS, TextSplitterStream } from 'kokoro-js';
import type { KokoroVoiceType } from '../types/kokoroVoice';

let tts: KokoroTTS | null = null;
let splitter: TextSplitterStream | null = null;
let stream: AsyncGenerator<any, void, unknown> | null = null;
let currentVoice: KokoroVoiceType = undefined;

self.onmessage = async (event: MessageEvent) => {
  const { type, data, voice, speed } = event.data;
  // Cast the incoming voice to the correct type
  const typedVoice = voice as KokoroVoiceType;
  const speechSpeed = speed || 1.0;

  try {
    switch (type) {
      case "load":
        if (!tts) {
          tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
            dtype: "fp32",
            device: "webgpu"
          });
          splitter = new TextSplitterStream();
          
          // Store the initial voice setting
          currentVoice = typedVoice;
          
          if (typedVoice) {
            // Initialize stream with the voice parameter
            stream = tts.stream(splitter, { 
              voice: typedVoice 
            });
          } else {
            // Use the default voice setting
            stream = tts.stream(splitter);
          }
          
          //console.log('[TTS] Model loaded');
          self.postMessage({ status: "ready" });
        }
        break;

      case "synthesize":
        if (!splitter || !stream || !tts) {
          throw new Error("TTS not initialized");
        }

        // Skip synthesizing if the text is in JSON format
        try {
          JSON.parse(data);
          return;
        } catch (e) {
          // Not JSON, continue with synthesis
        }
        
        // If voice has changed, reinitialize the stream with the new voice
        if (typedVoice && typedVoice !== currentVoice) {
          currentVoice = typedVoice;
          splitter = new TextSplitterStream();
          stream = tts.stream(splitter, { 
            voice: typedVoice,
            speed: speechSpeed
          });
        }

        //console.log('[TTS] Synthesizing:', data);
        splitter.push(data);
        splitter.flush();

        for await (const chunk of stream) {
          
          if (chunk?.audio) {
            // Convert to blob and then to array buffer
            const blob = await chunk.audio.toBlob();
            const arrayBuffer = await blob.arrayBuffer();
            
            self.postMessage({
              status: "chunk",
              data: { buffer: arrayBuffer, text: data }
            }, { transfer: [arrayBuffer] });
          }
        }
        break;
    }
  } catch (error: any) {
    console.error('[TTS] Error:', error);
    self.postMessage({
      status: "error",
      error: error.message
    });
  }
};
