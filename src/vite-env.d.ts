/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LLAMA_CLI_EXE?: string;
  readonly VITE_LLAMA_MODEL_PATH?: string;
  readonly VITE_LLAMA_CTX_SIZE?: string;
  readonly VITE_LLAMA_REVERSE_PROMPT?: string;
  readonly VITE_USE_NATIVE_LLM?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
