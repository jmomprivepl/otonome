import {
  AutoTokenizer,
  AutoModelForCausalLM,
  TextStreamer,
  InterruptableStoppingCriteria,
} from "@huggingface/transformers";

class TextGenerationPipeline {
  //static model_id = "onnx-community/Phi-3.5-mini-instruct-onnx-web"; //"onnx-community/Phi-4-mini-instruct-web-q4f16"
  static tokenizer: any;
  static model: any;
  static currentContent = '';
  static selectedModelId: string = "onnx-community/gemma-3-1b-it-ONNX"; // Default fallback model
  
  // Use the model ID provided by workerManager
  static model_id = () => TextGenerationPipeline.selectedModelId;

  static async getInstance(progress_callback: ((x: any) => void) | null = null) {
    this.tokenizer ??= AutoTokenizer.from_pretrained(TextGenerationPipeline.model_id(), {
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

    this.model ??= AutoModelForCausalLM.from_pretrained(TextGenerationPipeline.model_id(), {
      dtype: "q4f16",
      device: "webgpu",
      use_external_data_format: TextGenerationPipeline.model_id() === "onnx-community/Phi-3.5-mini-instruct-onnx-web" ? true : false,
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

    return Promise.all([this.tokenizer, this.model]);
  }

  static resetContent() {
    this.currentContent = '';
  }
}

const stopping_criteria = new InterruptableStoppingCriteria();
let past_key_values_cache: any = null;

async function generate(messages: any[], nodeId: string, modelConfig: any = {}) {
  const [tokenizer, model] = await TextGenerationPipeline.getInstance();
  TextGenerationPipeline.resetContent();

  const inputs = tokenizer.apply_chat_template(messages, {
    add_generation_prompt: true,
    return_dict: true,
  });

  let startTime: number | undefined;
  let numTokens = 0;
  let tps: number | undefined;

  // Track each token for immediate streaming
  const token_callback_function = () => {
    startTime ??= performance.now();
    if (numTokens++ > 0) {
      tps = (numTokens / (performance.now() - startTime)) * 1000;
    }
  };

  // Stream tokens immediately like chat.worker.ts
  const callback_function = (output: string) => {
    TextGenerationPipeline.currentContent += output;
    self.postMessage({
      status: "update",
      data: TextGenerationPipeline.currentContent, // Send full content for compatibility
      output: TextGenerationPipeline.currentContent, // Send both for flexibility
      tps,
      numTokens,
      nodeId,
    });
  };

  const streamer = new TextStreamer(tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function,
    token_callback_function,
  });

  self.postMessage({ status: "start", nodeId });

  const { past_key_values, sequences } = await model.generate({
    ...inputs,
    do_sample: true,
    top_k: modelConfig?.top_k ?? 3,
    temperature: modelConfig?.temperature ?? 0.2,
    max_new_tokens: modelConfig?.max_new_tokens ?? 1024,
    streamer,
    stopping_criteria,
    return_dict_in_generate: true,
  });

  past_key_values_cache = past_key_values;
  const decoded = tokenizer.batch_decode(sequences, {
    skip_special_tokens: true,
  });

  self.postMessage({
    status: "complete",
    output: decoded,
    nodeId,
  });
}

async function check() {
  try {
    const [tokenizer, model] = await TextGenerationPipeline.getInstance();
    return !!tokenizer && !!model;
  } catch (error) {
    console.error('Model check failed:', error);
    return false;
  }
}

async function load() {
  try {
    const [tokenizer, model] = await TextGenerationPipeline.getInstance((progress: any) => {
      const percentage = Math.round(progress.progress);
      if (!Number.isNaN(percentage)) {
        self.postMessage({ 
          status: 'loading', 
          data: `${percentage}%`
        });
      }
    });
    
    if (tokenizer && model) {
      self.postMessage({ status: 'ready' });
      return true;
    }
    return false;
  } catch (error) {
    console.error('Model loading failed:', error);
    self.postMessage({ 
      status: 'error', 
      data: 'Failed to load language model'
    });
    return false;
  }
}

// Handle messages
self.addEventListener("message", async (e) => {
  const { type, messages, nodeId, modelConfig, modelId } = e.data;
  
  // If modelId is provided, update the selected model
  if (modelId) {
    TextGenerationPipeline.selectedModelId = modelId;
  }
  
  switch (type) {
    case "load":
      await load();
      break;
    case "check":
      const isReady = await check();
      self.postMessage({ status: isReady ? "ready" : "not_ready" });
      break;
    case "generate":
      if (!messages) {
        self.postMessage({ 
          status: "error", 
          data: "No messages provided", 
          nodeId 
        });
        return;
      }
      await generate(messages, nodeId, modelConfig);
      break;
    case "cancel":
      if (stopping_criteria) {
        stopping_criteria.interrupt();
      }
      break;
  }
});
