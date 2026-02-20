<script lang="ts">
  import { push } from 'svelte-spa-router';
  import { createDataStore } from './stores/data.svelte';
  import { createUIStore } from './stores/ui.svelte';
  import { createCorrectionsStore } from './stores/corrections.svelte';
  import { startMic, createPlayer, playPcmChunks } from './audio';
  import { createConverseApi } from './converse';
  import { correctInstruction } from './correct';
  import { createLLM } from '../../lib/llm';
  import type { AudioSink, ContentBlock, Message, STTCorrection } from './types';

  let { params } = $props<{ params?: { id?: string } }>();

  const ui = createUIStore();
  const corrections = createCorrectionsStore();

  const live = createDataStore({
    audio: {
      startMic,
      createPlayer(): AudioSink {
        const raw = createPlayer();
        return {
          play(b64: string) { if (ui.voiceEnabled) raw.play(b64); },
          flush() { raw.flush(); },
          stop() { raw.stop(); },
        };
      },
    },
    api: createConverseApi(),
    getApiKey: () => ui.apiKey,
    getMode: () => ui.mode,
    correctInstruction: (instruction: string) => {
      const key = ui.apiKey;
      if (!key) return Promise.resolve(instruction);
      return correctInstruction(createLLM({ apiKey: key }), instruction, corrections.corrections);
    },
    getPttMode: () => ui.pttMode,
  });

  // Load session history if route has an ID
  let historyLoading = $state(false);
  if (params?.id) {
    historyLoading = true;
    fetch(`/api/sessions/${params.id}/messages`)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json();
      })
      .then((msgs: Message[]) => {
        live.loadHistory(msgs, params!.id!);
      })
      .catch((e) => {
        console.error('[live] failed to load history:', e);
      })
      .finally(() => {
        historyLoading = false;
      });
  }

  // --- Helper: extract text from a message for display ---
  function messageText(msg: Message): string {
    if (typeof msg.content === 'string') return msg.content;
    return msg.content
      .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
  }

  function messageToolUses(msg: Message): Extract<ContentBlock, { type: 'tool_use' }>[] {
    if (typeof msg.content === 'string') return [];
    return msg.content.filter(
      (b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use',
    );
  }

  function messageToolResults(msg: Message): Extract<ContentBlock, { type: 'tool_result' }>[] {
    if (typeof msg.content === 'string') return [];
    return msg.content.filter(
      (b): b is Extract<ContentBlock, { type: 'tool_result' }> => b.type === 'tool_result',
    );
  }

  function messageThinking(msg: Message): string[] {
    if (typeof msg.content === 'string') return [];
    return msg.content
      .filter((b): b is Extract<ContentBlock, { type: 'thinking' }> => b.type === 'thinking')
      .map((b) => b.thinking);
  }

  let keyDraft = $state(ui.apiKey ?? '');
  let correctionsModalOpen = $state(false);
  let playingId = $state<string | null>(null);
  let stopPlaying: (() => void) | null = null;
  let showVoiceLog = $state(false);

  function playCorrection(c: STTCorrection) {
    stopPlaying?.();
    if (playingId === c.id) { playingId = null; return; }
    const handle = playPcmChunks(c.audioChunks.map(ch => ch.data), 16000, () => { playingId = null; });
    stopPlaying = handle.stop;
    playingId = c.id;
  }

  function downloadCorrection(c: STTCorrection) {
    const blob = new Blob(
      [JSON.stringify({ chunks: c.audioChunks, sampleRate: 16000 })],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `correction-${c.id.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function playApprovalAudio() {
    const chunks = live.pendingApproval?.audioChunks;
    if (!chunks?.length) return;
    stopPlaying?.();
    if (playingId === 'approval') { playingId = null; return; }
    const handle = playPcmChunks(chunks.map(ch => ch.data), 16000, () => { playingId = null; });
    stopPlaying = handle.stop;
    playingId = 'approval';
  }
  let editing = $state(false);

  let editDraft = $state('');

  function handleAccept() {
    const approval = live.pendingApproval;
    if (!approval) return;
    live.approve();
  }

  function handleStartEdit() {
    if (!live.pendingApproval) return;
    editDraft = live.pendingApproval.instruction;
    editing = true;
  }

  function handleSubmitEdit() {
    if (!live.pendingApproval) return;
    const original = live.pendingApproval.rawInstruction ?? live.pendingApproval.instruction;
    if (editDraft !== original) {
      corrections.addSTT(original, editDraft, live.pendingApproval.audioChunks);
    }
    live.approve(editDraft);
    editing = false;
  }

  function handleCancelEdit() {
    editing = false;
  }

  function handleReject() {
    live.reject();
    editing = false;
  }

</script>

<main>
  <header>
    <button class="header-sm" onclick={() => push('/')}>Home</button>
    <h1>Gemini Live</h1>
    <button class="header-sm" onclick={() => { keyDraft = ui.apiKey ?? ''; ui.openApiKeyModal(); }}>API Key</button>
    <button class="header-sm" class:muted={!ui.voiceEnabled} onclick={ui.toggleVoice}>
      {ui.voiceEnabled ? 'Voice On' : 'Voice Off'}
    </button>
    <button class="header-sm" class:active-mode={ui.mode !== 'direct'} onclick={ui.cycleMode}>
      {ui.mode === 'direct' ? 'Direct' : ui.mode === 'review' ? 'Review' : 'Correct'}
    </button>
    <button class="header-sm" class:active-mode={ui.pttMode} onclick={ui.togglePttMode}
      disabled={live.status !== 'idle'}>
      {ui.pttMode ? 'PTT' : 'VAD'}
    </button>
    {#if corrections.corrections.length}
      <button class="header-sm" onclick={() => { correctionsModalOpen = true; }}>
        Corrections ({corrections.corrections.length})
      </button>
    {/if}
    {#if live.status === 'idle'}
      <button onclick={live.start}>Start</button>
    {:else if live.status === 'connecting'}
      <button disabled>Connecting...</button>
    {:else}
      <button onclick={live.stop}>Stop</button>
    {/if}
  </header>

  {#if live.status === 'connected' && ui.pttMode}
    <button class="ptt-button" class:ptt-active={live.pttActive}
      onpointerdown={live.pttPress}
      onpointerup={live.pttRelease}
      onpointerleave={live.pttRelease}>
      {live.pttActive ? 'Listening...' : 'Hold to Talk'}
    </button>
  {/if}

  {#if historyLoading}
    <p class="loading">Loading conversation...</p>
  {/if}

  <!-- CC Messages (persistent conversation) -->
  <div class="messages">
    {#each live.messages as msg}
      <div class="msg {msg.role}">
        <span class="label">{msg.role === 'user' ? 'You' : 'Claude'}</span>
        {#if messageText(msg)}<p>{messageText(msg)}</p>{/if}
        {#each messageThinking(msg) as think}
          <details class="thinking">
            <summary>Thinking...</summary>
            <p>{think}</p>
          </details>
        {/each}
        {#each messageToolUses(msg) as tool}
          <div class="tool-result">
            <span class="tool-pill">{tool.name}</span>
            {#if tool.input.instruction}
              <p class="tool-args">{tool.input.instruction}</p>
            {:else if Object.keys(tool.input).length}
              <p class="tool-args">{JSON.stringify(tool.input)}</p>
            {/if}
          </div>
        {/each}
        {#each messageToolResults(msg) as result}
          <details class="tool-result">
            <summary>Tool result</summary>
            <p class="tool-text">{result.content}</p>
          </details>
        {/each}
      </div>
    {/each}

    <!-- Pending overlays (real-time streaming) -->
    {#if live.pendingInput}
      <div class="msg user pending">
        <span class="label">You</span>
        <p>{live.pendingInput}</p>
      </div>
    {/if}

    {#if live.pendingTool}
      {@const showApproval = live.pendingApproval != null}
      <div class="msg assistant" class:pending={!showApproval} class:approval={showApproval}>
        <span class="label">Gemini</span>
        {#if live.pendingOutput}<p>{live.pendingOutput}</p>{/if}
        <div class="tool-result" class:streaming={!showApproval}>
          <span class="tool-pill">{live.pendingTool.name}</span>
          {#if showApproval}
            <p class="tool-args">{live.pendingApproval.instruction}</p>
          {:else if live.pendingTool.args?.instruction}
            <p class="tool-args">{live.pendingTool.args.instruction}</p>
          {:else if live.pendingTool.args && Object.keys(live.pendingTool.args).length}
            <p class="tool-args">{JSON.stringify(live.pendingTool.args)}</p>
          {/if}
          {#if live.pendingTool.text}<p class="tool-text">{live.pendingTool.text}</p>{/if}
        </div>
        {#if showApproval}
          {#if editing}
            <textarea class="edit-instruction" bind:value={editDraft}></textarea>
            <div class="approval-actions">
              <button class="approve-btn" onclick={handleSubmitEdit}>Submit</button>
              <button onclick={handleCancelEdit}>Cancel</button>
            </div>
          {:else}
            <div class="approval-actions">
              {#if live.pendingApproval.audioChunks.length}
                <button class="correction-play" onclick={playApprovalAudio}>
                  {playingId === 'approval' ? '\u25A0' : '\u25B6'}
                </button>
              {/if}
              <button class="approve-btn" onclick={handleAccept}>Accept</button>
              <button onclick={handleStartEdit}>Edit</button>
              <button class="reject-btn" onclick={handleReject}>Reject</button>
            </div>
          {/if}
        {/if}
      </div>
    {:else if live.pendingOutput}
      <div class="msg assistant pending">
        <span class="label">Gemini</span>
        <p>{live.pendingOutput}</p>
      </div>
    {/if}
  </div>

  <!-- Voice Log (ephemeral, collapsible) -->
  {#if live.voiceLog.length}
    <div class="voice-log-section">
      <button class="voice-log-toggle" onclick={() => { showVoiceLog = !showVoiceLog; }}>
        Voice Log ({live.voiceLog.length}) {showVoiceLog ? '\u25B2' : '\u25BC'}
      </button>
      {#if showVoiceLog}
        <div class="voice-log">
          {#each live.voiceLog as ev}
            <div class="voice-ev {ev.role}">
              <span class="voice-role">{ev.role === 'user' ? 'You' : 'Gemini'}</span>
              <span class="voice-text">{ev.text}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</main>

{#if ui.apiKeyModalOpen}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="backdrop" onkeydown={() => {}} onclick={ui.closeApiKeyModal}>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="modal" onkeydown={() => {}} onclick={(e) => e.stopPropagation()}>
      <h2>Gemini API Key</h2>
      <input
        type="password"
        placeholder="Enter your API key"
        bind:value={keyDraft}
        onkeydown={(e) => { if (e.key === 'Enter') ui.setApiKey(keyDraft); }}
      />
      <div class="modal-actions">
        <button onclick={ui.closeApiKeyModal}>Cancel</button>
        <button onclick={() => ui.setApiKey(keyDraft)}>Save</button>
      </div>
    </div>
  </div>
{/if}

{#if correctionsModalOpen}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="backdrop" onkeydown={() => {}} onclick={() => { correctionsModalOpen = false; }}>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="modal" onkeydown={() => {}} onclick={(e) => e.stopPropagation()}>
      <h2>STT Corrections</h2>
      {#each corrections.corrections as c (c.id)}
        <div class="correction-row">
          <div class="correction-text">
            <span class="correction-heard">{c.heard}</span>
            <span class="correction-arrow">-&gt;</span>
            <span class="correction-meant">{c.meant}</span>
          </div>
          {#if c.audioChunks.length}
            <button class="correction-play" onclick={() => playCorrection(c)}>
              {playingId === c.id ? '\u25A0' : '\u25B6'}
            </button>
            <button class="correction-play" onclick={() => downloadCorrection(c)}>{'\u2193'}</button>
          {/if}
          <button class="correction-delete" onclick={() => corrections.remove(c.id)}>x</button>
        </div>
      {/each}
      {#if !corrections.corrections.length}
        <p class="correction-empty">No corrections yet.</p>
      {/if}
      <div class="modal-actions">
        <button onclick={() => { correctionsModalOpen = false; }}>Close</button>
      </div>
    </div>
  </div>
{/if}

<style>
  main {
    max-width: 600px;
    margin: 2rem auto;
    font-family: system-ui, sans-serif;
  }

  header {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1rem;
  }

  h1 {
    margin: 0;
  }

  button {
    padding: 0.5rem 1.5rem;
    font-size: 0.9rem;
    cursor: pointer;
    border: 1px solid currentColor;
    border-radius: 0.25rem;
    background: none;
  }

  button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .header-sm {
    font-size: 0.75rem;
  }

  .header-sm:nth-of-type(2) {
    margin-left: auto;
  }

  .header-sm.muted {
    opacity: 0.5;
  }

  .loading {
    color: #9ca3af;
    text-align: center;
  }

  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .modal {
    background: white;
    padding: 1.5rem;
    border-radius: 0.5rem;
    width: min(400px, 90vw);
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .modal h2 {
    margin: 0;
    font-size: 1.1rem;
  }

  .modal input {
    padding: 0.5rem;
    font-size: 0.9rem;
    border: 1px solid #d1d5db;
    border-radius: 0.25rem;
    width: 100%;
    box-sizing: border-box;
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }

  .messages {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    max-height: 70vh;
    overflow-y: auto;
    padding: 0.5rem 0;
  }

  .msg {
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
  }

  .msg.user {
    background: #f0f0f0;
    align-self: flex-end;
    text-align: right;
  }

  .msg.assistant {
    background: #e8f4fd;
    align-self: flex-start;
  }

  .label {
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    opacity: 0.5;
  }

  .thinking {
    margin-top: 0.5rem;
    font-size: 0.8rem;
    color: #9ca3af;
  }

  .thinking summary {
    cursor: pointer;
    font-style: italic;
  }

  .thinking p {
    white-space: pre-wrap;
    max-height: 200px;
    overflow-y: auto;
  }

  .tool-result {
    margin-top: 0.5rem;
    padding: 0.5rem;
    border-radius: 0.375rem;
    background: #f5f0ff;
    border: 1px solid #e4d9fc;
  }

  .tool-result.streaming {
    border-style: dashed;
  }

  .tool-pill {
    display: inline-block;
    font-size: 0.75rem;
    font-family: monospace;
    padding: 0.2rem 0.6rem;
    border-radius: 1rem;
    background: #ede9fe;
    color: #7c3aed;
  }

  .tool-args {
    font-size: 0.8rem;
    font-style: italic;
    color: #6b7280;
    margin: 0.25rem 0 0;
  }

  .tool-text {
    font-size: 0.85rem;
    white-space: pre-wrap;
    max-height: 300px;
    overflow-y: auto;
    color: #374151;
  }

  .msg.pending {
    opacity: 0.6;
  }

  .msg.user.approval {
    opacity: 1;
    border: 2px solid #059669;
  }

  .msg p {
    margin: 0.25rem 0 0;
  }

  .header-sm.active-mode {
    color: #059669;
    border-color: #059669;
  }

  .transcription {
    font-size: 0.75rem;
    color: #9ca3af;
    margin: 0.25rem 0 0;
  }

  .edit-instruction {
    width: 100%;
    box-sizing: border-box;
    min-height: 3rem;
    margin-top: 0.5rem;
    padding: 0.5rem;
    font-size: 0.85rem;
    font-family: inherit;
    border: 1px solid #d1d5db;
    border-radius: 0.25rem;
    resize: vertical;
  }

  .approval-actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
    justify-content: flex-end;
  }

  .approval-actions .correction-play {
    margin-right: auto;
  }

  .approve-btn {
    font-size: 0.8rem;
    padding: 0.3rem 1rem;
    color: #059669;
    border-color: #059669;
  }

  .reject-btn {
    font-size: 0.8rem;
    padding: 0.3rem 1rem;
    color: #dc2626;
    border-color: #dc2626;
  }

  .correction-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0;
    border-bottom: 1px solid #f0f0f0;
  }

  .correction-text {
    flex: 1;
    font-size: 0.85rem;
  }

  .correction-heard {
    text-decoration: line-through;
    color: #9ca3af;
  }

  .correction-arrow {
    color: #9ca3af;
    margin: 0 0.25rem;
  }

  .correction-meant {
    color: #059669;
  }

  .correction-play {
    font-size: 0.7rem;
    padding: 0.2rem 0.5rem;
    color: #2563eb;
    border-color: #93c5fd;
  }

  .correction-delete {
    font-size: 0.7rem;
    padding: 0.2rem 0.5rem;
    color: #dc2626;
    border-color: #dc2626;
  }

  .correction-empty {
    color: #9ca3af;
    font-size: 0.85rem;
    text-align: center;
  }

  .ptt-button {
    width: 100%;
    padding: 1.5rem;
    font-size: 1.1rem;
    margin-bottom: 1rem;
    user-select: none;
    touch-action: none;
  }

  .ptt-button.ptt-active {
    color: #059669;
    border-color: #059669;
    background: #ecfdf5;
  }

  /* Voice log */
  .voice-log-section {
    margin-top: 1rem;
    border-top: 1px solid #e5e7eb;
    padding-top: 0.5rem;
  }

  .voice-log-toggle {
    font-size: 0.75rem;
    padding: 0.3rem 0.8rem;
    color: #9ca3af;
    border-color: #e5e7eb;
    width: 100%;
  }

  .voice-log {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-top: 0.5rem;
    max-height: 200px;
    overflow-y: auto;
  }

  .voice-ev {
    font-size: 0.8rem;
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
  }

  .voice-ev.user {
    background: #f9fafb;
    text-align: right;
  }

  .voice-ev.gemini {
    background: #f0f9ff;
  }

  .voice-role {
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
    opacity: 0.5;
    margin-right: 0.5rem;
  }

  .voice-text {
    color: #6b7280;
  }
</style>
