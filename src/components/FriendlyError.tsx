// Formats known error patterns into actionable UI. Falls back to the raw string
// for anything we don't recognize.

export default function FriendlyError({ raw }: { raw: string }) {
  if (raw.includes('free-models-per-day')) {
    const resetMatch = raw.match(/X-RateLimit-Reset"[:\s]+"(\d+)"/)
    const resetTime = resetMatch ? new Date(parseInt(resetMatch[1])).toLocaleString() : 'daily reset'
    return (
      <div>
        <div style={{ fontWeight: 600 }}>OpenRouter free-tier daily limit reached (50 requests/day)</div>
        <div style={{ marginTop: 4, opacity: 0.85 }}>
          Reset: {resetTime}. Options:
        </div>
        <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
          <li>Wait for the daily reset</li>
          <li>Add $10 credit at openrouter.ai to unlock 1000 free requests/day</li>
          <li>Switch to a local Ollama model in Settings (no daily cap, no cost)</li>
          <li>Add your Anthropic API key in Settings for BYO frontier quality</li>
        </ul>
      </div>
    )
  }
  if (raw.includes('paid version is available')) {
    return (
      <div>
        <div style={{ fontWeight: 600 }}>This model no longer has a free variant</div>
        <div style={{ marginTop: 4, opacity: 0.85 }}>
          OpenRouter's free-tier catalog shifted. Go to Settings → Test free models to pick a currently-live one.
        </div>
      </div>
    )
  }
  if (raw.includes('No models provided')) {
    return (
      <div>
        <div style={{ fontWeight: 600 }}>Router couldn't find a free model right now</div>
        <div style={{ marginTop: 4, opacity: 0.85 }}>
          Go to Settings → Test free models to see current availability, or add a fallback.
        </div>
      </div>
    )
  }
  if (raw.startsWith('Ollama') && (raw.includes('CUDA') || raw.includes('llama-server process has terminated'))) {
    return (
      <div>
        <div style={{ fontWeight: 600 }}>Ollama crashed running this model</div>
        <div style={{ marginTop: 4, opacity: 0.85 }}>
          This is usually a GPU driver / VRAM mismatch. Options:
        </div>
        <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
          <li>Try a smaller model (e.g. <code>llama3.2:3b</code> or <code>qwen2.5-coder:7b</code>)</li>
          <li>Force CPU-only mode: set env var <code>OLLAMA_LLM_LIBRARY=cpu</code> and restart Ollama</li>
          <li>Update your NVIDIA driver + CUDA toolkit</li>
          <li>Switch to an OpenRouter fallback in Settings while you diagnose</li>
        </ul>
      </div>
    )
  }
  if (raw.startsWith('Ollama') && raw.includes('model') && raw.includes('not found')) {
    return (
      <div>
        <div style={{ fontWeight: 600 }}>Ollama model not pulled locally</div>
        <div style={{ marginTop: 4, opacity: 0.85 }}>
          Run <code>ollama pull &lt;model-name&gt;</code> in a terminal, then retry.
        </div>
      </div>
    )
  }
  if (raw.startsWith('Ollama') && raw.includes('does not support tools')) {
    return (
      <div>
        <div style={{ fontWeight: 600 }}>This Ollama model doesn't support tool calling</div>
        <div style={{ marginTop: 4, opacity: 0.85 }}>
          Vibe agents need tool-calling. Try a model that supports it:
          <code style={{ marginLeft: 4 }}>llama3.1</code>, <code>llama3.2</code>, <code>qwen2.5-coder</code>, or <code>mistral-nemo</code>.
        </div>
      </div>
    )
  }
  if (raw.startsWith('Anthropic') && raw.includes('401')) {
    return (
      <div>
        <div style={{ fontWeight: 600 }}>Anthropic API key rejected</div>
        <div style={{ marginTop: 4, opacity: 0.85 }}>
          Check that your key is correct in Settings and hasn't been revoked.
        </div>
      </div>
    )
  }
  return <>Error: {raw}</>
}
