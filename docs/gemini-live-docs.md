<br />

<br />

The Live API enables low-latency, real-time voice and video interactions with Gemini. It processes continuous streams of audio, video, or text to deliver immediate, human-like spoken responses, creating a natural conversational experience for your users.

![Live API Overview](https://ai.google.dev/static/gemini-api/docs/images/live-api-overview.png)

Live API offers a comprehensive set of features such as[Voice Activity Detection](https://ai.google.dev/gemini-api/docs/live-guide#interruptions),[tool use and function calling](https://ai.google.dev/gemini-api/docs/live-tools),[session management](https://ai.google.dev/gemini-api/docs/live-session)(for managing long running conversations) and[ephemeral tokens](https://ai.google.dev/gemini-api/docs/ephemeral-tokens)(for secure client-sided authentication).

This page gets you up and running with examples and basic code samples.

[Try the Live API in Google AI Studiomic](https://aistudio.google.com/live)

## Choose an implementation approach

When integrating with Live API, you'll need to choose one of the following implementation approaches:

- **Server-to-server** : Your backend connects to the Live API using[WebSockets](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API). Typically, your client sends stream data (audio, video, text) to your server, which then forwards it to the Live API.
- **Client-to-server** : Your frontend code connects directly to the Live API using[WebSockets](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API)to stream data, bypassing your backend.

**Note:** Client-to-server generally offers better performance for streaming audio and video, since it bypasses the need to send the stream to your backend first. It's also easier to set up since you don't need to implement a proxy that sends data from your client to your server and then your server to the API. However, for production environments, in order to mitigate security risks, we recommend using[ephemeral tokens](https://ai.google.dev/gemini-api/docs/ephemeral-tokens)instead of standard API keys.  

## Partner integrations

To streamline the development of real-time audio and video apps, you can use a third-party integration that supports the Gemini Live API over WebRTC or WebSockets.  
[Pipecat by Daily
Create a real-time AI chatbot using Gemini Live and Pipecat.](https://docs.pipecat.ai/guides/features/gemini-live)[LiveKit
Use the Gemini Live API with LiveKit Agents.](https://docs.livekit.io/agents/models/realtime/plugins/gemini/)[Fishjam by Software Mansion
Create live video and audio streaming applications with Fishjam.](https://docs.fishjam.io/tutorials/gemini-live-integration)[Agent Development Kit (ADK)
Implement the Live API with Agent Development Kit (ADK).](https://google.github.io/adk-docs/streaming/)[Vision Agents by Stream
Build real-time voice and video AI applications with Vision Agents.](https://visionagents.ai/integrations/gemini)[Voximplant
Connect inbound and outbound calls to Live API with Voximplant.](https://voximplant.com/products/gemini-client)

## Get started

Microphone streamAudio file stream

This server-side example**streams audio from the microphone** and plays the returned audio. For complete end-to-end examples including a client application, see[Example applications](https://ai.google.dev/gemini-api/docs/live#example-applications).

The input audio format should be in 16-bit PCM, 16kHz, mono format, and the received audio uses a sample rate of 24kHz.  

### Python

Install helpers for audio streaming. Additional system-level dependencies (e.g.`portaudio`) might be required. Refer to the[PyAudio docs](https://pypi.org/project/PyAudio/)for detailed installation steps.  

    pip install pyaudio

**Note:** **Use headphones**. This script uses the system default audio input and output, which often won't include echo cancellation. To prevent the model from interrupting itself, use headphones.  

    import asyncio
    from google import genai
    import pyaudio

    client = genai.Client()

    # --- pyaudio config ---
    FORMAT = pyaudio.paInt16
    CHANNELS = 1
    SEND_SAMPLE_RATE = 16000
    RECEIVE_SAMPLE_RATE = 24000
    CHUNK_SIZE = 1024

    pya = pyaudio.PyAudio()

    # --- Live API config ---
    MODEL = "gemini-2.5-flash-native-audio-preview-12-2025"
    CONFIG = {
        "response_modalities": ["AUDIO"],
        "system_instruction": "You are a helpful and friendly AI assistant.",
    }

    audio_queue_output = asyncio.Queue()
    audio_queue_mic = asyncio.Queue(maxsize=5)
    audio_stream = None

    async def listen_audio():
        """Listens for audio and puts it into the mic audio queue."""
        global audio_stream
        mic_info = pya.get_default_input_device_info()
        audio_stream = await asyncio.to_thread(
            pya.open,
            format=FORMAT,
            channels=CHANNELS,
            rate=SEND_SAMPLE_RATE,
            input=True,
            input_device_index=mic_info["index"],
            frames_per_buffer=CHUNK_SIZE,
        )
        kwargs = {"exception_on_overflow": False} if __debug__ else {}
        while True:
            data = await asyncio.to_thread(audio_stream.read, CHUNK_SIZE, **kwargs)
            await audio_queue_mic.put({"data": data, "mime_type": "audio/pcm"})

    async def send_realtime(session):
        """Sends audio from the mic audio queue to the GenAI session."""
        while True:
            msg = await audio_queue_mic.get()
            await session.send_realtime_input(audio=msg)

    async def receive_audio(session):
        """Receives responses from GenAI and puts audio data into the speaker audio queue."""
        while True:
            turn = session.receive()
            async for response in turn:
                if (response.server_content and response.server_content.model_turn):
                    for part in response.server_content.model_turn.parts:
                        if part.inline_data and isinstance(part.inline_data.data, bytes):
                            audio_queue_output.put_nowait(part.inline_data.data)

            # Empty the queue on interruption to stop playback
            while not audio_queue_output.empty():
                audio_queue_output.get_nowait()

    async def play_audio():
        """Plays audio from the speaker audio queue."""
        stream = await asyncio.to_thread(
            pya.open,
            format=FORMAT,
            channels=CHANNELS,
            rate=RECEIVE_SAMPLE_RATE,
            output=True,
        )
        while True:
            bytestream = await audio_queue_output.get()
            await asyncio.to_thread(stream.write, bytestream)

    async def run():
        """Main function to run the audio loop."""
        try:
            async with client.aio.live.connect(
                model=MODEL, config=CONFIG
            ) as live_session:
                print("Connected to Gemini. Start speaking!")
                async with asyncio.TaskGroup() as tg:
                    tg.create_task(send_realtime(live_session))
                    tg.create_task(listen_audio())
                    tg.create_task(receive_audio(live_session))
                    tg.create_task(play_audio())
        except asyncio.CancelledError:
            pass
        finally:
            if audio_stream:
                audio_stream.close()
            pya.terminate()
            print("\nConnection closed.")

    if __name__ == "__main__":
        try:
            asyncio.run(run())
        except KeyboardInterrupt:
            print("Interrupted by user.")

### JavaScript

Install helpers for audio streaming. Additional system-level dependencies might be required (`sox`for Mac/Windows or`ALSA`for Linux). Refer to the[speaker](https://www.npmjs.com/package/speaker)and[mic](https://www.npmjs.com/package/mic)docs for detailed installation steps.  

    npm install mic speaker

**Note:** **Use headphones**. This script uses the system default audio input and output, which often won't include echo cancellation. To prevent the model from interrupting itself, use headphones.  

    import { GoogleGenAI, Modality } from '@google/genai';
    import mic from 'mic';
    import Speaker from 'speaker';

    const ai = new GoogleGenAI({});
    // WARNING: Do not use API keys in client-side (browser based) applications
    // Consider using Ephemeral Tokens instead
    // More information at: https://ai.google.dev/gemini-api/docs/ephemeral-tokens

    // --- Live API config ---
    const model = 'gemini-2.5-flash-native-audio-preview-12-2025';
    const config = {
      responseModalities: [Modality.AUDIO],
      systemInstruction: "You are a helpful and friendly AI assistant.",
    };

    async function live() {
      const responseQueue = [];
      const audioQueue = [];
      let speaker;

      async function waitMessage() {
        while (responseQueue.length === 0) {
          await new Promise((resolve) => setImmediate(resolve));
        }
        return responseQueue.shift();
      }

      function createSpeaker() {
        if (speaker) {
          process.stdin.unpipe(speaker);
          speaker.end();
        }
        speaker = new Speaker({
          channels: 1,
          bitDepth: 16,
          sampleRate: 24000,
        });
        speaker.on('error', (err) => console.error('Speaker error:', err));
        process.stdin.pipe(speaker);
      }

      async function messageLoop() {
        // Puts incoming messages in the audio queue.
        while (true) {
          const message = await waitMessage();
          if (message.serverContent && message.serverContent.interrupted) {
            // Empty the queue on interruption to stop playback
            audioQueue.length = 0;
            continue;
          }
          if (message.serverContent && message.serverContent.modelTurn && message.serverContent.modelTurn.parts) {
            for (const part of message.serverContent.modelTurn.parts) {
              if (part.inlineData && part.inlineData.data) {
                audioQueue.push(Buffer.from(part.inlineData.data, 'base64'));
              }
            }
          }
        }
      }

      async function playbackLoop() {
        // Plays audio from the audio queue.
        while (true) {
          if (audioQueue.length === 0) {
            if (speaker) {
              // Destroy speaker if no more audio to avoid warnings from speaker library
              process.stdin.unpipe(speaker);
              speaker.end();
              speaker = null;
            }
            await new Promise((resolve) => setImmediate(resolve));
          } else {
            if (!speaker) createSpeaker();
            const chunk = audioQueue.shift();
            await new Promise((resolve) => {
              speaker.write(chunk, () => resolve());
            });
          }
        }
      }

      // Start loops
      messageLoop();
      playbackLoop();

      // Connect to Gemini Live API
      const session = await ai.live.connect({
        model: model,
        config: config,
        callbacks: {
          onopen: () => console.log('Connected to Gemini Live API'),
          onmessage: (message) => responseQueue.push(message),
          onerror: (e) => console.error('Error:', e.message),
          onclose: (e) => console.log('Closed:', e.reason),
        },
      });

      // Setup Microphone for input
      const micInstance = mic({
        rate: '16000',
        bitwidth: '16',
        channels: '1',
      });
      const micInputStream = micInstance.getAudioStream();

      micInputStream.on('data', (data) => {
        // API expects base64 encoded PCM data
        session.sendRealtimeInput({
          audio: {
            data: data.toString('base64'),
            mimeType: "audio/pcm;rate=16000"
          }
        });
      });

      micInputStream.on('error', (err) => {
        console.error('Microphone error:', err);
      });

      micInstance.start();
      console.log('Microphone started. Speak now...');
    }

    live().catch(console.error);

## Example applications

Check out the following example applications that illustrate how to use Live API for end-to-end use cases:

- [Live audio starter app](https://aistudio.google.com/apps/bundled/live_audio?showPreview=true&showCode=true&showAssistant=false)on AI Studio, using JavaScript libraries to connect to Live API and stream bidirectional audio through your microphone and speakers.
- See the[Partner integrations](https://ai.google.dev/gemini-api/docs/live#partner-integrations)for additional examples and getting started guides.

## What's next

- Read the full Live API[Capabilities](https://ai.google.dev/gemini-api/docs/live-guide)guide for key capabilities and configurations; including Voice Activity Detection and native audio features.
- Read the[Tool use](https://ai.google.dev/gemini-api/docs/live-tools)guide to learn how to integrate Live API with tools and function calling.
- Read the[Session management](https://ai.google.dev/gemini-api/docs/live-session)guide for managing long running conversations.
- Read the[Ephemeral tokens](https://ai.google.dev/gemini-api/docs/ephemeral-tokens)guide for secure authentication in[client-to-server](https://ai.google.dev/gemini-api/docs/live#implementation-approach)applications.
- For more information about the underlying WebSockets API, see the[WebSockets API reference](https://ai.google.dev/api/live).

<br />

| **Preview:** The Live API is in preview.

This is a comprehensive guide that covers capabilities and configurations
available with the Live API.
See [Get started with Live API](https://ai.google.dev/gemini-api/docs/live) page for a
overview and sample code for common use cases.

## Before you begin

- **Familiarize yourself with core concepts:** If you haven't already done so, read the [Get started with Live API](https://ai.google.dev/gemini-api/docs/live) page first. This will introduce you to the fundamental principles of the Live API, how it works, and the different [implementation approaches](https://ai.google.dev/gemini-api/docs/live#implementation-approach).
- **Try the Live API in AI Studio:** You may find it useful to try the Live API in [Google AI Studio](https://aistudio.google.com/app/live) before you start building. To use the Live API in Google AI Studio, select **Stream**.

## Establishing a connection

The following example shows how to create a connection with an API key:

### Python

    import asyncio
    from google import genai

    client = genai.Client()

    model = "gemini-2.5-flash-native-audio-preview-12-2025"
    config = {"response_modalities": ["AUDIO"]}

    async def main():
        async with client.aio.live.connect(model=model, config=config) as session:
            print("Session started")
            # Send content...

    if __name__ == "__main__":
        asyncio.run(main())

### JavaScript

    import { GoogleGenAI, Modality } from '@google/genai';

    const ai = new GoogleGenAI({});
    const model = 'gemini-2.5-flash-native-audio-preview-12-2025';
    const config = { responseModalities: [Modality.AUDIO] };

    async function main() {

      const session = await ai.live.connect({
        model: model,
        callbacks: {
          onopen: function () {
            console.debug('Opened');
          },
          onmessage: function (message) {
            console.debug(message);
          },
          onerror: function (e) {
            console.debug('Error:', e.message);
          },
          onclose: function (e) {
            console.debug('Close:', e.reason);
          },
        },
        config: config,
      });

      console.debug("Session started");
      // Send content...

      session.close();
    }

    main();

## Interaction modalities

The following sections provide examples and supporting context for the different
input and output modalities available in Live API.

### Sending and receiving audio

The most common audio example, **audio-to-audio** , is covered in the
[Getting started](https://ai.google.dev/gemini-api/docs/live#audio-to-audio) guide.

### Audio formats

Audio data in the Live API is always raw, little-endian,
16-bit PCM. Audio output always uses a sample rate of 24kHz. Input audio
is natively 16kHz, but the Live API will resample if needed
so any sample rate can be sent. To convey the sample rate of input audio, set
the MIME type of each audio-containing [Blob](https://ai.google.dev/api/caching#Blob) to a value
like `audio/pcm;rate=16000`.

### Sending text

Here's how you can send text:

### Python

    message = "Hello, how are you?"
    await session.send_client_content(turns=message, turn_complete=True)

### JavaScript

    const message = 'Hello, how are you?';
    session.sendClientContent({ turns: message, turnComplete: true });

#### Incremental content updates

Use incremental updates to send text input, establish session context, or
restore session context. For short contexts you can send turn-by-turn
interactions to represent the exact sequence of events:

### Python

    turns = [
        {"role": "user", "parts": [{"text": "What is the capital of France?"}]},
        {"role": "model", "parts": [{"text": "Paris"}]},
    ]

    await session.send_client_content(turns=turns, turn_complete=False)

    turns = [{"role": "user", "parts": [{"text": "What is the capital of Germany?"}]}]

    await session.send_client_content(turns=turns, turn_complete=True)

### JavaScript

    let inputTurns = [
      { "role": "user", "parts": [{ "text": "What is the capital of France?" }] },
      { "role": "model", "parts": [{ "text": "Paris" }] },
    ]

    session.sendClientContent({ turns: inputTurns, turnComplete: false })

    inputTurns = [{ "role": "user", "parts": [{ "text": "What is the capital of Germany?" }] }]

    session.sendClientContent({ turns: inputTurns, turnComplete: true })

For longer contexts it's recommended to provide a single message summary to free
up the context window for subsequent interactions. See [Session Resumption](https://ai.google.dev/gemini-api/docs/live-session#session-resumption) for another method for
loading session context.

### Audio transcriptions

In addition to the model response, you can also receive transcriptions of
both the audio output and the audio input.

To enable transcription of the model's audio output, send
`output_audio_transcription` in the setup config. The transcription language is
inferred from the model's response.

### Python

    import asyncio
    from google import genai
    from google.genai import types

    client = genai.Client()
    model = "gemini-2.5-flash-native-audio-preview-12-2025"

    config = {
        "response_modalities": ["AUDIO"],
        "output_audio_transcription": {}
    }

    async def main():
        async with client.aio.live.connect(model=model, config=config) as session:
            message = "Hello? Gemini are you there?"

            await session.send_client_content(
                turns={"role": "user", "parts": [{"text": message}]}, turn_complete=True
            )

            async for response in session.receive():
                if response.server_content.model_turn:
                    print("Model turn:", response.server_content.model_turn)
                if response.server_content.output_transcription:
                    print("Transcript:", response.server_content.output_transcription.text)

    if __name__ == "__main__":
        asyncio.run(main())

### JavaScript

    import { GoogleGenAI, Modality } from '@google/genai';

    const ai = new GoogleGenAI({});
    const model = 'gemini-2.5-flash-native-audio-preview-12-2025';

    const config = {
      responseModalities: [Modality.AUDIO],
      outputAudioTranscription: {}
    };

    async function live() {
      const responseQueue = [];

      async function waitMessage() {
        let done = false;
        let message = undefined;
        while (!done) {
          message = responseQueue.shift();
          if (message) {
            done = true;
          } else {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }
        return message;
      }

      async function handleTurn() {
        const turns = [];
        let done = false;
        while (!done) {
          const message = await waitMessage();
          turns.push(message);
          if (message.serverContent && message.serverContent.turnComplete) {
            done = true;
          }
        }
        return turns;
      }

      const session = await ai.live.connect({
        model: model,
        callbacks: {
          onopen: function () {
            console.debug('Opened');
          },
          onmessage: function (message) {
            responseQueue.push(message);
          },
          onerror: function (e) {
            console.debug('Error:', e.message);
          },
          onclose: function (e) {
            console.debug('Close:', e.reason);
          },
        },
        config: config,
      });

      const inputTurns = 'Hello how are you?';
      session.sendClientContent({ turns: inputTurns });

      const turns = await handleTurn();

      for (const turn of turns) {
        if (turn.serverContent && turn.serverContent.outputTranscription) {
          console.debug('Received output transcription: %s\n', turn.serverContent.outputTranscription.text);
        }
      }

      session.close();
    }

    async function main() {
      await live().catch((e) => console.error('got error', e));
    }

    main();

To enable transcription of the model's audio input, send
`input_audio_transcription` in setup config.

### Python

    import asyncio
    from pathlib import Path
    from google import genai
    from google.genai import types

    client = genai.Client()
    model = "gemini-2.5-flash-native-audio-preview-12-2025"

    config = {
        "response_modalities": ["AUDIO"],
        "input_audio_transcription": {},
    }

    async def main():
        async with client.aio.live.connect(model=model, config=config) as session:
            audio_data = Path("16000.pcm").read_bytes()

            await session.send_realtime_input(
                audio=types.Blob(data=audio_data, mime_type='audio/pcm;rate=16000')
            )

            async for msg in session.receive():
                if msg.server_content.input_transcription:
                    print('Transcript:', msg.server_content.input_transcription.text)

    if __name__ == "__main__":
        asyncio.run(main())

### JavaScript

    import { GoogleGenAI, Modality } from '@google/genai';
    import * as fs from "node:fs";
    import pkg from 'wavefile';
    const { WaveFile } = pkg;

    const ai = new GoogleGenAI({});
    const model = 'gemini-2.5-flash-native-audio-preview-12-2025';

    const config = {
      responseModalities: [Modality.AUDIO],
      inputAudioTranscription: {}
    };

    async function live() {
      const responseQueue = [];

      async function waitMessage() {
        let done = false;
        let message = undefined;
        while (!done) {
          message = responseQueue.shift();
          if (message) {
            done = true;
          } else {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }
        return message;
      }

      async function handleTurn() {
        const turns = [];
        let done = false;
        while (!done) {
          const message = await waitMessage();
          turns.push(message);
          if (message.serverContent && message.serverContent.turnComplete) {
            done = true;
          }
        }
        return turns;
      }

      const session = await ai.live.connect({
        model: model,
        callbacks: {
          onopen: function () {
            console.debug('Opened');
          },
          onmessage: function (message) {
            responseQueue.push(message);
          },
          onerror: function (e) {
            console.debug('Error:', e.message);
          },
          onclose: function (e) {
            console.debug('Close:', e.reason);
          },
        },
        config: config,
      });

      // Send Audio Chunk
      const fileBuffer = fs.readFileSync("16000.wav");

      // Ensure audio conforms to API requirements (16-bit PCM, 16kHz, mono)
      const wav = new WaveFile();
      wav.fromBuffer(fileBuffer);
      wav.toSampleRate(16000);
      wav.toBitDepth("16");
      const base64Audio = wav.toBase64();

      // If already in correct format, you can use this:
      // const fileBuffer = fs.readFileSync("sample.pcm");
      // const base64Audio = Buffer.from(fileBuffer).toString('base64');

      session.sendRealtimeInput(
        {
          audio: {
            data: base64Audio,
            mimeType: "audio/pcm;rate=16000"
          }
        }
      );

      const turns = await handleTurn();
      for (const turn of turns) {
        if (turn.text) {
          console.debug('Received text: %s\n', turn.text);
        }
        else if (turn.data) {
          console.debug('Received inline data: %s\n', turn.data);
        }
        else if (turn.serverContent && turn.serverContent.inputTranscription) {
          console.debug('Received input transcription: %s\n', turn.serverContent.inputTranscription.text);
        }
      }

      session.close();
    }

    async function main() {
      await live().catch((e) => console.error('got error', e));
    }

    main();

### Stream audio and video

| To see an example of how to use
| the Live API in a streaming audio and video format,
| run the "Live API - Get Started" file in the cookbooks repository:
|
|
| [View
| on Colab](https://github.com/google-gemini/cookbook/blob/main/quickstarts/Get_started_LiveAPI.py)

### Change voice and language

[Native audio output](https://ai.google.dev/gemini-api/docs/live-guide#native-audio-output) models support any of the voices
available for our [Text-to-Speech (TTS)](https://ai.google.dev/gemini-api/docs/speech-generation#voices)
models. You can listen to all the voices in [AI Studio](https://aistudio.google.com/app/live).

To specify a voice, set the voice name within the `speechConfig` object as part
of the session configuration:

### Python

    config = {
        "response_modalities": ["AUDIO"],
        "speech_config": {
            "voice_config": {"prebuilt_voice_config": {"voice_name": "Kore"}}
        },
    }

### JavaScript

    const config = {
      responseModalities: [Modality.AUDIO],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } }
    };

| **Note:** If you're using the `generateContent` API, the set of available voices is slightly different. See the [audio generation guide](https://ai.google.dev/gemini-api/docs/audio-generation#voices) for `generateContent` audio generation voices.

The Live API supports [multiple languages](https://ai.google.dev/gemini-api/docs/live-guide#supported-languages).
[Native audio output](https://ai.google.dev/gemini-api/docs/live-guide#native-audio-output) models automatically choose
the appropriate language and don't support explicitly setting the language
code.

## Native audio capabilities

Our latest models feature [native audio output](https://ai.google.dev/gemini-api/docs/models#gemini-2.5-flash-live),
which provides natural, realistic-sounding speech and improved multilingual
performance. Native audio also enables advanced features like [affective
(emotion-aware) dialogue](https://ai.google.dev/gemini-api/docs/live-guide#affective-dialog), [proactive audio](https://ai.google.dev/gemini-api/docs/live-guide#proactive-audio)
(where the model intelligently decides when to respond to input),
and ["thinking"](https://ai.google.dev/gemini-api/docs/live-guide#native-audio-output-thinking).

### Affective dialog

This feature lets Gemini adapt its response style to the input expression and
tone.

To use affective dialog, set the api version to `v1alpha` and set
`enable_affective_dialog` to `true`in the setup message:

### Python

    client = genai.Client(http_options={"api_version": "v1alpha"})

    config = types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        enable_affective_dialog=True
    )

### JavaScript

    const ai = new GoogleGenAI({ httpOptions: {"apiVersion": "v1alpha"} });

    const config = {
      responseModalities: [Modality.AUDIO],
      enableAffectiveDialog: true
    };

### Proactive audio

When this feature is enabled, Gemini can proactively decide not to respond
if the content is not relevant.

To use it, set the api version to `v1alpha` and configure the `proactivity`
field in the setup message and set `proactive_audio` to `true`:

### Python

    client = genai.Client(http_options={"api_version": "v1alpha"})

    config = types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        proactivity={'proactive_audio': True}
    )

### JavaScript

    const ai = new GoogleGenAI({ httpOptions: {"apiVersion": "v1alpha"} });

    const config = {
      responseModalities: [Modality.AUDIO],
      proactivity: { proactiveAudio: true }
    }

### Thinking

The latest native audio output model `gemini-2.5-flash-native-audio-preview-12-2025`
supports [thinking capabilities](https://ai.google.dev/gemini-api/docs/thinking), with dynamic
thinking enabled by default.

The `thinkingBudget` parameter guides the model on the number of thinking tokens
to use when generating a response. You can disable thinking by setting
`thinkingBudget` to `0`. For more info on the `thinkingBudget` configuration
details of the model, see the [thinking budgets documentation](https://ai.google.dev/gemini-api/docs/thinking#set-budget).

### Python

    model = "gemini-2.5-flash-native-audio-preview-12-2025"

    config = types.LiveConnectConfig(
        response_modalities=["AUDIO"]
        thinking_config=types.ThinkingConfig(
            thinking_budget=1024,
        )
    )

    async with client.aio.live.connect(model=model, config=config) as session:
        # Send audio input and receive audio

### JavaScript

    const model = 'gemini-2.5-flash-native-audio-preview-12-2025';
    const config = {
      responseModalities: [Modality.AUDIO],
      thinkingConfig: {
        thinkingBudget: 1024,
      },
    };

    async function main() {

      const session = await ai.live.connect({
        model: model,
        config: config,
        callbacks: ...,
      });

      // Send audio input and receive audio

      session.close();
    }

    main();

Additionally, you can enable thought summaries by setting `includeThoughts` to
`true` in your configuration. See [thought summaries](https://ai.google.dev/gemini-api/docs/thinking#summaries)
for more info:

### Python

    model = "gemini-2.5-flash-native-audio-preview-12-2025"

    config = types.LiveConnectConfig(
        response_modalities=["AUDIO"]
        thinking_config=types.ThinkingConfig(
            thinking_budget=1024,
            include_thoughts=True
        )
    )

### JavaScript

    const model = 'gemini-2.5-flash-native-audio-preview-12-2025';
    const config = {
      responseModalities: [Modality.AUDIO],
      thinkingConfig: {
        thinkingBudget: 1024,
        includeThoughts: true,
      },
    };

## Voice Activity Detection (VAD)

Voice Activity Detection (VAD) allows the model to recognize when a person is
speaking. This is essential for creating natural conversations, as it allows a
user to interrupt the model at any time.

When VAD detects an interruption, the ongoing generation is canceled and
discarded. Only the information already sent to the client is retained in the
session history. The server then sends a [`BidiGenerateContentServerContent`](https://ai.google.dev/api/live#bidigeneratecontentservercontent) message to report the interruption.

The Gemini server then discards any pending function calls and sends a
`BidiGenerateContentServerContent` message with the IDs of the canceled calls.

### Python

    async for response in session.receive():
        if response.server_content.interrupted is True:
            # The generation was interrupted

            # If realtime playback is implemented in your application,
            # you should stop playing audio and clear queued playback here.

### JavaScript

    const turns = await handleTurn();

    for (const turn of turns) {
      if (turn.serverContent && turn.serverContent.interrupted) {
        // The generation was interrupted

        // If realtime playback is implemented in your application,
        // you should stop playing audio and clear queued playback here.
      }
    }

### Automatic VAD

By default, the model automatically performs VAD on
a continuous audio input stream. VAD can be configured with the
[`realtimeInputConfig.automaticActivityDetection`](https://ai.google.dev/api/live#RealtimeInputConfig.AutomaticActivityDetection)
field of the [setup configuration](https://ai.google.dev/api/live#BidiGenerateContentSetup).

When the audio stream is paused for more than a second (for example,
because the user switched off the microphone), an
[`audioStreamEnd`](https://ai.google.dev/api/live#BidiGenerateContentRealtimeInput.FIELDS.bool.BidiGenerateContentRealtimeInput.audio_stream_end)
event should be sent to flush any cached audio. The client can resume sending
audio data at any time.

### Python

    # example audio file to try:
    # URL = "https://storage.googleapis.com/generativeai-downloads/data/hello_are_you_there.pcm"
    # !wget -q $URL -O sample.pcm
    import asyncio
    from pathlib import Path
    from google import genai
    from google.genai import types

    client = genai.Client()
    model = "gemini-live-2.5-flash-preview"

    config = {"response_modalities": ["TEXT"]}

    async def main():
        async with client.aio.live.connect(model=model, config=config) as session:
            audio_bytes = Path("sample.pcm").read_bytes()

            await session.send_realtime_input(
                audio=types.Blob(data=audio_bytes, mime_type="audio/pcm;rate=16000")
            )

            # if stream gets paused, send:
            # await session.send_realtime_input(audio_stream_end=True)

            async for response in session.receive():
                if response.text is not None:
                    print(response.text)

    if __name__ == "__main__":
        asyncio.run(main())

### JavaScript

    // example audio file to try:
    // URL = "https://storage.googleapis.com/generativeai-downloads/data/hello_are_you_there.pcm"
    // !wget -q $URL -O sample.pcm
    import { GoogleGenAI, Modality } from '@google/genai';
    import * as fs from "node:fs";

    const ai = new GoogleGenAI({});
    const model = 'gemini-live-2.5-flash-preview';
    const config = { responseModalities: [Modality.TEXT] };

    async function live() {
      const responseQueue = [];

      async function waitMessage() {
        let done = false;
        let message = undefined;
        while (!done) {
          message = responseQueue.shift();
          if (message) {
            done = true;
          } else {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }
        return message;
      }

      async function handleTurn() {
        const turns = [];
        let done = false;
        while (!done) {
          const message = await waitMessage();
          turns.push(message);
          if (message.serverContent && message.serverContent.turnComplete) {
            done = true;
          }
        }
        return turns;
      }

      const session = await ai.live.connect({
        model: model,
        callbacks: {
          onopen: function () {
            console.debug('Opened');
          },
          onmessage: function (message) {
            responseQueue.push(message);
          },
          onerror: function (e) {
            console.debug('Error:', e.message);
          },
          onclose: function (e) {
            console.debug('Close:', e.reason);
          },
        },
        config: config,
      });

      // Send Audio Chunk
      const fileBuffer = fs.readFileSync("sample.pcm");
      const base64Audio = Buffer.from(fileBuffer).toString('base64');

      session.sendRealtimeInput(
        {
          audio: {
            data: base64Audio,
            mimeType: "audio/pcm;rate=16000"
          }
        }

      );

      // if stream gets paused, send:
      // session.sendRealtimeInput({ audioStreamEnd: true })

      const turns = await handleTurn();
      for (const turn of turns) {
        if (turn.text) {
          console.debug('Received text: %s\n', turn.text);
        }
        else if (turn.data) {
          console.debug('Received inline data: %s\n', turn.data);
        }
      }

      session.close();
    }

    async function main() {
      await live().catch((e) => console.error('got error', e));
    }

    main();

With `send_realtime_input`, the API will respond to audio automatically based
on VAD. While `send_client_content` adds messages to the model context in
order, `send_realtime_input` is optimized for responsiveness at the expense of
deterministic ordering.

### Automatic VAD configuration

For more control over the VAD activity, you can configure the following
parameters. See [API reference](https://ai.google.dev/api/live#automaticactivitydetection) for more
info.

### Python

    from google.genai import types

    config = {
        "response_modalities": ["TEXT"],
        "realtime_input_config": {
            "automatic_activity_detection": {
                "disabled": False, # default
                "start_of_speech_sensitivity": types.StartSensitivity.START_SENSITIVITY_LOW,
                "end_of_speech_sensitivity": types.EndSensitivity.END_SENSITIVITY_LOW,
                "prefix_padding_ms": 20,
                "silence_duration_ms": 100,
            }
        }
    }

### JavaScript

    import { GoogleGenAI, Modality, StartSensitivity, EndSensitivity } from '@google/genai';

    const config = {
      responseModalities: [Modality.TEXT],
      realtimeInputConfig: {
        automaticActivityDetection: {
          disabled: false, // default
          startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_LOW,
          endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW,
          prefixPaddingMs: 20,
          silenceDurationMs: 100,
        }
      }
    };

### Disable automatic VAD

Alternatively, the automatic VAD can be disabled by setting
`realtimeInputConfig.automaticActivityDetection.disabled` to `true` in the setup
message. In this configuration the client is responsible for detecting user
speech and sending
[`activityStart`](https://ai.google.dev/api/live#BidiGenerateContentRealtimeInput.FIELDS.BidiGenerateContentRealtimeInput.ActivityStart.BidiGenerateContentRealtimeInput.activity_start)
and [`activityEnd`](https://ai.google.dev/api/live#BidiGenerateContentRealtimeInput.FIELDS.BidiGenerateContentRealtimeInput.ActivityEnd.BidiGenerateContentRealtimeInput.activity_end)
messages at the appropriate times. An `audioStreamEnd` isn't sent in
this configuration. Instead, any interruption of the stream is marked by
an `activityEnd` message.

### Python

    config = {
        "response_modalities": ["TEXT"],
        "realtime_input_config": {"automatic_activity_detection": {"disabled": True}},
    }

    async with client.aio.live.connect(model=model, config=config) as session:
        # ...
        await session.send_realtime_input(activity_start=types.ActivityStart())
        await session.send_realtime_input(
            audio=types.Blob(data=audio_bytes, mime_type="audio/pcm;rate=16000")
        )
        await session.send_realtime_input(activity_end=types.ActivityEnd())
        # ...

### JavaScript

    const config = {
      responseModalities: [Modality.TEXT],
      realtimeInputConfig: {
        automaticActivityDetection: {
          disabled: true,
        }
      }
    };

    session.sendRealtimeInput({ activityStart: {} })

    session.sendRealtimeInput(
      {
        audio: {
          data: base64Audio,
          mimeType: "audio/pcm;rate=16000"
        }
      }

    );

    session.sendRealtimeInput({ activityEnd: {} })

## Token count

You can find the total number of consumed tokens in the
[usageMetadata](https://ai.google.dev/api/live#usagemetadata) field of the returned server message.

### Python

    async for message in session.receive():
        # The server will periodically send messages that include UsageMetadata.
        if message.usage_metadata:
            usage = message.usage_metadata
            print(
                f"Used {usage.total_token_count} tokens in total. Response token breakdown:"
            )
            for detail in usage.response_tokens_details:
                match detail:
                    case types.ModalityTokenCount(modality=modality, token_count=count):
                        print(f"{modality}: {count}")

### JavaScript

    const turns = await handleTurn();

    for (const turn of turns) {
      if (turn.usageMetadata) {
        console.debug('Used %s tokens in total. Response token breakdown:\n', turn.usageMetadata.totalTokenCount);

        for (const detail of turn.usageMetadata.responseTokensDetails) {
          console.debug('%s\n', detail);
        }
      }
    }

## Media resolution

You can specify the media resolution for the input media by setting the
`mediaResolution` field as part of the session configuration:

### Python

    from google.genai import types

    config = {
        "response_modalities": ["AUDIO"],
        "media_resolution": types.MediaResolution.MEDIA_RESOLUTION_LOW,
    }

### JavaScript

    import { GoogleGenAI, Modality, MediaResolution } from '@google/genai';

    const config = {
        responseModalities: [Modality.TEXT],
        mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW,
    };

## Limitations

Consider the following limitations of the Live API
when you plan your project.

### Response modalities

You can only set one response modality (`TEXT` or `AUDIO`) per session in the
session configuration. Setting both results in a config error message. This
means that you can configure the model to respond with either text or audio,
but not both in the same session.

### Client authentication

The Live API only provides server-to-server authentication
by default. If you're implementing your Live API application
using a [client-to-server approach](https://ai.google.dev/gemini-api/docs/live#implementation-approach), you need to use
[ephemeral tokens](https://ai.google.dev/gemini-api/docs/ephemeral-tokens) to mitigate security
risks.

### Session duration

Audio-only sessions are limited to 15 minutes,
and audio plus video sessions are limited to 2 minutes.
However, you can configure different [session management techniques](https://ai.google.dev/gemini-api/docs/live-session) for unlimited extensions on session duration.

### Context window

A session has a context window limit of:

- 128k tokens for [native audio output](https://ai.google.dev/gemini-api/docs/live-guide#native-audio-output) models
- 32k tokens for other Live API models

## Supported languages

Live API supports the following 70 languages.
| **Note:** [Native audio output](https://ai.google.dev/gemini-api/docs/live-guide#native-audio-output) models can switch between languages naturally during conversation. You can also restrict the languages it speaks in by specifying it in the system instructions.

| Language | BCP-47 Code | Language | BCP-47 Code |
|---|---|---|---|
| Afrikaans | `af` | Kannada | `kn` |
| Albanian | `sq` | Kazakh | `kk` |
| Amharic | `am` | Khmer | `km` |
| Arabic | `ar` | Korean | `ko` |
| Armenian | `hy` | Lao | `lo` |
| Assamese | `as` | Latvian | `lv` |
| Azerbaijani | `az` | Lithuanian | `lt` |
| Basque | `eu` | Macedonian | `mk` |
| Belarusian | `be` | Malay | `ms` |
| Bengali | `bn` | Malayalam | `ml` |
| Bosnian | `bs` | Marathi | `mr` |
| Bulgarian | `bg` | Mongolian | `mn` |
| Catalan | `ca` | Nepali | `ne` |
| Chinese | `zh` | Norwegian | `no` |
| Croatian | `hr` | Odia | `or` |
| Czech | `cs` | Polish | `pl` |
| Danish | `da` | Portuguese | `pt` |
| Dutch | `nl` | Punjabi | `pa` |
| English | `en` | Romanian | `ro` |
| Estonian | `et` | Russian | `ru` |
| Filipino | `fil` | Serbian | `sr` |
| Finnish | `fi` | Slovak | `sk` |
| French | `fr` | Slovenian | `sl` |
| Galician | `gl` | Spanish | `es` |
| Georgian | `ka` | Swahili | `sw` |
| German | `de` | Swedish | `sv` |
| Greek | `el` | Tamil | `ta` |
| Gujarati | `gu` | Telugu | `te` |
| Hebrew | `iw` | Thai | `th` |
| Hindi | `hi` | Turkish | `tr` |
| Hungarian | `hu` | Ukrainian | `uk` |
| Icelandic | `is` | Urdu | `ur` |
| Indonesian | `id` | Uzbek | `uz` |
| Italian | `it` | Vietnamese | `vi` |
| Japanese | `ja` | Zulu | `zu` |

## What's next

- Read the [Tool Use](https://ai.google.dev/gemini-api/docs/live-tools) and [Session Management](https://ai.google.dev/gemini-api/docs/live-session) guides for essential information on using the Live API effectively.
- Try the Live API in [Google AI Studio](https://aistudio.google.com/app/live).
- For more info about the Live API models, see [Gemini 2.5 Flash Native Audio](https://ai.google.dev/gemini-api/docs/models#gemini-2.5-flash-live) on the Models page.
- Try more examples in the [Live API cookbook](https://colab.research.google.com/github/google-gemini/cookbook/blob/main/quickstarts/Get_started_LiveAPI.ipynb), the [Live API Tools cookbook](https://colab.research.google.com/github/google-gemini/cookbook/blob/main/quickstarts/Get_started_LiveAPI_tools.ipynb), and the [Live API Get Started script](https://github.com/google-gemini/cookbook/blob/main/quickstarts/Get_started_LiveAPI.py).

<br />

Tool use allows Live API to go beyond just conversation by enabling it to perform actions in the real-world and pull in external context while maintaining a real time connection. You can define tools such as[Function calling](https://ai.google.dev/gemini-api/docs/function-calling)and[Google Search](https://ai.google.dev/gemini-api/docs/grounding)with the Live API.

## Overview of supported tools

Here's a brief overview of the available tools for Live API models:

|         Tool         | `gemini-2.5-flash-native-audio-preview-12-2025` |
|----------------------|-------------------------------------------------|
| **Search**           | Yes                                             |
| **Function calling** | Yes                                             |
| **Google Maps**      | No                                              |
| **Code execution**   | No                                              |
| **URL context**      | No                                              |

## Function calling

Live API supports function calling, just like regular content generation requests. Function calling lets the Live API interact with external data and programs, greatly increasing what your applications can accomplish.

You can define function declarations as part of the session configuration. After receiving tool calls, the client should respond with a list of`FunctionResponse`objects using the`session.send_tool_response`method.

See the[Function calling tutorial](https://ai.google.dev/gemini-api/docs/function-calling)to learn more.
**Note:** Unlike the`generateContent`API, the Live API doesn't support automatic tool response handling. You must handle tool responses manually in your client code.  

### Python

    import asyncio
    import wave
    from google import genai
    from google.genai import types

    client = genai.Client()

    model = "gemini-2.5-flash-native-audio-preview-12-2025"

    # Simple function definitions
    turn_on_the_lights = {"name": "turn_on_the_lights"}
    turn_off_the_lights = {"name": "turn_off_the_lights"}

    tools = [{"function_declarations": [turn_on_the_lights, turn_off_the_lights]}]
    config = {"response_modalities": ["AUDIO"], "tools": tools}

    async def main():
        async with client.aio.live.connect(model=model, config=config) as session:
            prompt = "Turn on the lights please"
            await session.send_client_content(turns={"parts": [{"text": prompt}]})

            wf = wave.open("audio.wav", "wb")
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(24000)  # Output is 24kHz

            async for response in session.receive():
                if response.data is not None:
                    wf.writeframes(response.data)
                elif response.tool_call:
                    print("The tool was called")
                    function_responses = []
                    for fc in response.tool_call.function_calls:
                        function_response = types.FunctionResponse(
                            id=fc.id,
                            name=fc.name,
                            response={ "result": "ok" } # simple, hard-coded function response
                        )
                        function_responses.append(function_response)

                    await session.send_tool_response(function_responses=function_responses)

            wf.close()

    if __name__ == "__main__":
        asyncio.run(main())

### JavaScript

    import { GoogleGenAI, Modality } from '@google/genai';
    import * as fs from "node:fs";
    import pkg from 'wavefile';  // npm install wavefile
    const { WaveFile } = pkg;

    const ai = new GoogleGenAI({});
    const model = 'gemini-2.5-flash-native-audio-preview-12-2025';

    // Simple function definitions
    const turn_on_the_lights = { name: "turn_on_the_lights" } // , description: '...', parameters: { ... }
    const turn_off_the_lights = { name: "turn_off_the_lights" }

    const tools = [{ functionDeclarations: [turn_on_the_lights, turn_off_the_lights] }]

    const config = {
      responseModalities: [Modality.AUDIO],
      tools: tools
    }

    async function live() {
      const responseQueue = [];

      async function waitMessage() {
        let done = false;
        let message = undefined;
        while (!done) {
          message = responseQueue.shift();
          if (message) {
            done = true;
          } else {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }
        return message;
      }

      async function handleTurn() {
        const turns = [];
        let done = false;
        while (!done) {
          const message = await waitMessage();
          turns.push(message);
          if (message.serverContent && message.serverContent.turnComplete) {
            done = true;
          } else if (message.toolCall) {
            done = true;
          }
        }
        return turns;
      }

      const session = await ai.live.connect({
        model: model,
        callbacks: {
          onopen: function () {
            console.debug('Opened');
          },
          onmessage: function (message) {
            responseQueue.push(message);
          },
          onerror: function (e) {
            console.debug('Error:', e.message);
          },
          onclose: function (e) {
            console.debug('Close:', e.reason);
          },
        },
        config: config,
      });

      const inputTurns = 'Turn on the lights please';
      session.sendClientContent({ turns: inputTurns });

      let turns = await handleTurn();

      for (const turn of turns) {
        if (turn.toolCall) {
          console.debug('A tool was called');
          const functionResponses = [];
          for (const fc of turn.toolCall.functionCalls) {
            functionResponses.push({
              id: fc.id,
              name: fc.name,
              response: { result: "ok" } // simple, hard-coded function response
            });
          }

          console.debug('Sending tool response...\n');
          session.sendToolResponse({ functionResponses: functionResponses });
        }
      }

      // Check again for new messages
      turns = await handleTurn();

      // Combine audio data strings and save as wave file
      const combinedAudio = turns.reduce((acc, turn) => {
          if (turn.data) {
              const buffer = Buffer.from(turn.data, 'base64');
              const intArray = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / Int16Array.BYTES_PER_ELEMENT);
              return acc.concat(Array.from(intArray));
          }
          return acc;
      }, []);

      const audioBuffer = new Int16Array(combinedAudio);

      const wf = new WaveFile();
      wf.fromScratch(1, 24000, '16', audioBuffer);  // output is 24kHz
      fs.writeFileSync('audio.wav', wf.toBuffer());

      session.close();
    }

    async function main() {
      await live().catch((e) => console.error('got error', e));
    }

    main();

From a single prompt, the model can generate multiple function calls and the code necessary to chain their outputs. This code executes in a sandbox environment, generating subsequent[BidiGenerateContentToolCall](https://ai.google.dev/api/live#bidigeneratecontenttoolcall)messages.

## Asynchronous function calling

Function calling executes sequentially by default, meaning execution pauses until the results of each function call are available. This ensures sequential processing, which means you won't be able to continue interacting with the model while the functions are being run.

If you don't want to block the conversation, you can tell the model to run the functions asynchronously. To do so, you first need to add a`behavior`to the function definitions:  

### Python

    # Non-blocking function definitions
    turn_on_the_lights = {"name": "turn_on_the_lights", "behavior": "NON_BLOCKING"} # turn_on_the_lights will run asynchronously
    turn_off_the_lights = {"name": "turn_off_the_lights"} # turn_off_the_lights will still pause all interactions with the model

### JavaScript

    import { GoogleGenAI, Modality, Behavior } from '@google/genai';

    // Non-blocking function definitions
    const turn_on_the_lights = {name: "turn_on_the_lights", behavior: Behavior.NON_BLOCKING}

    // Blocking function definitions
    const turn_off_the_lights = {name: "turn_off_the_lights"}

    const tools = [{ functionDeclarations: [turn_on_the_lights, turn_off_the_lights] }]

`NON-BLOCKING`ensures the function runs asynchronously while you can continue interacting with the model.

Then you need to tell the model how to behave when it receives the`FunctionResponse`using the`scheduling`parameter. It can either:

- Interrupt what it's doing and tell you about the response it got right away (`scheduling="INTERRUPT"`),
- Wait until it's finished with what it's currently doing (`scheduling="WHEN_IDLE"`),
- Or do nothing and use that knowledge later on in the discussion (`scheduling="SILENT"`)

### Python

    # for a non-blocking function definition, apply scheduling in the function response:
      function_response = types.FunctionResponse(
          id=fc.id,
          name=fc.name,
          response={
              "result": "ok",
              "scheduling": "INTERRUPT" # Can also be WHEN_IDLE or SILENT
          }
      )

### JavaScript

    import { GoogleGenAI, Modality, Behavior, FunctionResponseScheduling } from '@google/genai';

    // for a non-blocking function definition, apply scheduling in the function response:
    const functionResponse = {
      id: fc.id,
      name: fc.name,
      response: {
        result: "ok",
        scheduling: FunctionResponseScheduling.INTERRUPT  // Can also be WHEN_IDLE or SILENT
      }
    }

## Grounding with Google Search

You can enable Grounding with Google Search as part of the session configuration. This increases the Live API's accuracy and prevents hallucinations. See the[Grounding tutorial](https://ai.google.dev/gemini-api/docs/grounding)to learn more.  

### Python

    import asyncio
    import wave
    from google import genai
    from google.genai import types

    client = genai.Client()

    model = "gemini-2.5-flash-native-audio-preview-12-2025"

    tools = [{'google_search': {}}]
    config = {"response_modalities": ["AUDIO"], "tools": tools}

    async def main():
        async with client.aio.live.connect(model=model, config=config) as session:
            prompt = "When did the last Brazil vs. Argentina soccer match happen?"
            await session.send_client_content(turns={"parts": [{"text": prompt}]})

            wf = wave.open("audio.wav", "wb")
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(24000)  # Output is 24kHz

            async for chunk in session.receive():
                if chunk.server_content:
                    if chunk.data is not None:
                        wf.writeframes(chunk.data)

                    # The model might generate and execute Python code to use Search
                    model_turn = chunk.server_content.model_turn
                    if model_turn:
                        for part in model_turn.parts:
                            if part.executable_code is not None:
                                print(part.executable_code.code)

                            if part.code_execution_result is not None:
                                print(part.code_execution_result.output)

            wf.close()

    if __name__ == "__main__":
        asyncio.run(main())

### JavaScript

    import { GoogleGenAI, Modality } from '@google/genai';
    import * as fs from "node:fs";
    import pkg from 'wavefile';  // npm install wavefile
    const { WaveFile } = pkg;

    const ai = new GoogleGenAI({});
    const model = 'gemini-2.5-flash-native-audio-preview-12-2025';

    const tools = [{ googleSearch: {} }]
    const config = {
      responseModalities: [Modality.AUDIO],
      tools: tools
    }

    async function live() {
      const responseQueue = [];

      async function waitMessage() {
        let done = false;
        let message = undefined;
        while (!done) {
          message = responseQueue.shift();
          if (message) {
            done = true;
          } else {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }
        return message;
      }

      async function handleTurn() {
        const turns = [];
        let done = false;
        while (!done) {
          const message = await waitMessage();
          turns.push(message);
          if (message.serverContent && message.serverContent.turnComplete) {
            done = true;
          } else if (message.toolCall) {
            done = true;
          }
        }
        return turns;
      }

      const session = await ai.live.connect({
        model: model,
        callbacks: {
          onopen: function () {
            console.debug('Opened');
          },
          onmessage: function (message) {
            responseQueue.push(message);
          },
          onerror: function (e) {
            console.debug('Error:', e.message);
          },
          onclose: function (e) {
            console.debug('Close:', e.reason);
          },
        },
        config: config,
      });

      const inputTurns = 'When did the last Brazil vs. Argentina soccer match happen?';
      session.sendClientContent({ turns: inputTurns });

      let turns = await handleTurn();

      let combinedData = '';
      for (const turn of turns) {
        if (turn.serverContent && turn.serverContent.modelTurn && turn.serverContent.modelTurn.parts) {
          for (const part of turn.serverContent.modelTurn.parts) {
            if (part.executableCode) {
              console.debug('executableCode: %s\n', part.executableCode.code);
            }
            else if (part.codeExecutionResult) {
              console.debug('codeExecutionResult: %s\n', part.codeExecutionResult.output);
            }
            else if (part.inlineData && typeof part.inlineData.data === 'string') {
              combinedData += atob(part.inlineData.data);
            }
          }
        }
      }

      // Convert the base64-encoded string of bytes into a Buffer.
      const buffer = Buffer.from(combinedData, 'binary');

      // The buffer contains raw bytes. For 16-bit audio, we need to interpret every 2 bytes as a single sample.
      const intArray = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / Int16Array.BYTES_PER_ELEMENT);

      const wf = new WaveFile();
      // The API returns 16-bit PCM audio at a 24kHz sample rate.
      wf.fromScratch(1, 24000, '16', intArray);
      fs.writeFileSync('audio.wav', wf.toBuffer());

      session.close();
    }

    async function main() {
      await live().catch((e) => console.error('got error', e));
    }

    main();

## Combining multiple tools

You can combine multiple tools within the Live API, increasing your application's capabilities even more:  

### Python

    prompt = """
    Hey, I need you to do two things for me.

    1. Use Google Search to look up information about the largest earthquake in California the week of Dec 5 2024?
    2. Then turn on the lights

    Thanks!
    """

    tools = [
        {"google_search": {}},
        {"function_declarations": [turn_on_the_lights, turn_off_the_lights]},
    ]

    config = {"response_modalities": ["AUDIO"], "tools": tools}

    # ... remaining model call

### JavaScript

    const prompt = `Hey, I need you to do two things for me.

    1. Use Google Search to look up information about the largest earthquake in California the week of Dec 5 2024?
    2. Then turn on the lights

    Thanks!
    `

    const tools = [
      { googleSearch: {} },
      { functionDeclarations: [turn_on_the_lights, turn_off_the_lights] }
    ]

    const config = {
      responseModalities: [Modality.AUDIO],
      tools: tools
    }

    // ... remaining model call

## What's next

- Check out more examples of using tools with the Live API in the[Tool use cookbook](https://colab.research.google.com/github/google-gemini/cookbook/blob/main/quickstarts/Get_started_LiveAPI_tools.ipynb).
- Get the full story on features and configurations from the[Live API Capabilities guide](https://ai.google.dev/gemini-api/docs/live-guide).

<br />

In the Live API, a session refers to a persistent connection where input and output are streamed continuously over the same connection (read more about[how it works](https://ai.google.dev/gemini-api/docs/live)). This unique session design enables low latency and supports unique features, but can also introduce challenges, like session time limits, and early termination. This guide covers strategies for overcoming the session management challenges that can arise when using the Live API.

## Session lifetime

Without compression, audio-only sessions are limited to 15 minutes, and audio-video sessions are limited to 2 minutes. Exceeding these limits will terminate the session (and therefore, the connection), but you can use[context window compression](https://ai.google.dev/gemini-api/docs/live-session#context-window-compression)to extend sessions to an unlimited amount of time.

The lifetime of a connection is limited as well, to around 10 minutes. When the connection terminates, the session terminates as well. In this case, you can configure a single session to stay active over multiple connections using[session resumption](https://ai.google.dev/gemini-api/docs/live-session#session-resumption). You'll also receive a[GoAway message](https://ai.google.dev/gemini-api/docs/live-session#goaway-message)before the connection ends, allowing you to take further actions.

## Context window compression

To enable longer sessions, and avoid abrupt connection termination, you can enable context window compression by setting the[contextWindowCompression](https://ai.google.dev/api/live#BidiGenerateContentSetup.FIELDS.ContextWindowCompressionConfig.BidiGenerateContentSetup.context_window_compression)field as part of the session configuration.

In the[ContextWindowCompressionConfig](https://ai.google.dev/api/live#contextwindowcompressionconfig), you can configure a[sliding-window mechanism](https://ai.google.dev/api/live#ContextWindowCompressionConfig.FIELDS.ContextWindowCompressionConfig.SlidingWindow.ContextWindowCompressionConfig.sliding_window)and the[number of tokens](https://ai.google.dev/api/live#ContextWindowCompressionConfig.FIELDS.int64.ContextWindowCompressionConfig.trigger_tokens)that triggers compression.  

### Python

    from google.genai import types

    config = types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        context_window_compression=(
            # Configures compression with default parameters.
            types.ContextWindowCompressionConfig(
                sliding_window=types.SlidingWindow(),
            )
        ),
    )

### JavaScript

    const config = {
      responseModalities: [Modality.AUDIO],
      contextWindowCompression: { slidingWindow: {} }
    };

## Session resumption

To prevent session termination when the server periodically resets the WebSocket connection, configure the[sessionResumption](https://ai.google.dev/api/live#BidiGenerateContentSetup.FIELDS.SessionResumptionConfig.BidiGenerateContentSetup.session_resumption)field within the[setup configuration](https://ai.google.dev/api/live#BidiGenerateContentSetup).

Passing this configuration causes the server to send[SessionResumptionUpdate](https://ai.google.dev/api/live#SessionResumptionUpdate)messages, which can be used to resume the session by passing the last resumption token as the[`SessionResumptionConfig.handle`](https://ai.google.dev/api/live#SessionResumptionConfig.FIELDS.string.SessionResumptionConfig.handle)of the subsequent connection.

Resumption tokens are valid for 2 hr after the last sessions termination.  

### Python

    import asyncio
    from google import genai
    from google.genai import types

    client = genai.Client()
    model = "gemini-2.5-flash-native-audio-preview-12-2025"

    async def main():
        print(f"Connecting to the service with handle {previous_session_handle}...")
        async with client.aio.live.connect(
            model=model,
            config=types.LiveConnectConfig(
                response_modalities=["AUDIO"],
                session_resumption=types.SessionResumptionConfig(
                    # The handle of the session to resume is passed here,
                    # or else None to start a new session.
                    handle=previous_session_handle
                ),
            ),
        ) as session:
            while True:
                await session.send_client_content(
                    turns=types.Content(
                        role="user", parts=[types.Part(text="Hello world!")]
                    )
                )
                async for message in session.receive():
                    # Periodically, the server will send update messages that may
                    # contain a handle for the current state of the session.
                    if message.session_resumption_update:
                        update = message.session_resumption_update
                        if update.resumable and update.new_handle:
                            # The handle should be retained and linked to the session.
                            return update.new_handle

                    # For the purposes of this example, placeholder input is continually fed
                    # to the model. In non-sample code, the model inputs would come from
                    # the user.
                    if message.server_content and message.server_content.turn_complete:
                        break

    if __name__ == "__main__":
        asyncio.run(main())

### JavaScript

    import { GoogleGenAI, Modality } from '@google/genai';

    const ai = new GoogleGenAI({});
    const model = 'gemini-2.5-flash-native-audio-preview-12-2025';

    async function live() {
      const responseQueue = [];

      async function waitMessage() {
        let done = false;
        let message = undefined;
        while (!done) {
          message = responseQueue.shift();
          if (message) {
            done = true;
          } else {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }
        return message;
      }

      async function handleTurn() {
        const turns = [];
        let done = false;
        while (!done) {
          const message = await waitMessage();
          turns.push(message);
          if (message.serverContent && message.serverContent.turnComplete) {
            done = true;
          }
        }
        return turns;
      }

    console.debug('Connecting to the service with handle %s...', previousSessionHandle)
    const session = await ai.live.connect({
      model: model,
      callbacks: {
        onopen: function () {
          console.debug('Opened');
        },
        onmessage: function (message) {
          responseQueue.push(message);
        },
        onerror: function (e) {
          console.debug('Error:', e.message);
        },
        onclose: function (e) {
          console.debug('Close:', e.reason);
        },
      },
      config: {
        responseModalities: [Modality.AUDIO],
        sessionResumption: { handle: previousSessionHandle }
        // The handle of the session to resume is passed here, or else null to start a new session.
      }
    });

    const inputTurns = 'Hello how are you?';
    session.sendClientContent({ turns: inputTurns });

    const turns = await handleTurn();
    for (const turn of turns) {
      if (turn.sessionResumptionUpdate) {
        if (turn.sessionResumptionUpdate.resumable && turn.sessionResumptionUpdate.newHandle) {
          let newHandle = turn.sessionResumptionUpdate.newHandle
          // ...Store newHandle and start new session with this handle here
        }
      }
    }

      session.close();
    }

    async function main() {
      await live().catch((e) => console.error('got error', e));
    }

    main();

## Receiving a message before the session disconnects

The server sends a[GoAway](https://ai.google.dev/api/live#GoAway)message that signals that the current connection will soon be terminated. This message includes the[timeLeft](https://ai.google.dev/api/live#GoAway.FIELDS.google.protobuf.Duration.GoAway.time_left), indicating the remaining time and lets you take further action before the connection will be terminated as ABORTED.  

### Python

    async for response in session.receive():
        if response.go_away is not None:
            # The connection will soon be terminated
            print(response.go_away.time_left)

### JavaScript

    const turns = await handleTurn();

    for (const turn of turns) {
      if (turn.goAway) {
        console.debug('Time left: %s\n', turn.goAway.timeLeft);
      }
    }

## Receiving a message when the generation is complete

The server sends a[generationComplete](https://ai.google.dev/api/live#BidiGenerateContentServerContent.FIELDS.bool.BidiGenerateContentServerContent.generation_complete)message that signals that the model finished generating the response.  

### Python

    async for response in session.receive():
        if response.server_content.generation_complete is True:
            # The generation is complete

### JavaScript

    const turns = await handleTurn();

    for (const turn of turns) {
      if (turn.serverContent && turn.serverContent.generationComplete) {
        // The generation is complete
      }
    }

## What's next

Explore more ways to work with the Live API in the full[Capabilities](https://ai.google.dev/gemini-api/docs/live)guide, the[Tool use](https://ai.google.dev/gemini-api/docs/live-tools)page, or the[Live API cookbook](https://colab.research.google.com/github/google-gemini/cookbook/blob/main/quickstarts/Get_started_LiveAPI.ipynb).