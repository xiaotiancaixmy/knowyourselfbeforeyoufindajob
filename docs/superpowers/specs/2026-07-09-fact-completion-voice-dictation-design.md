# Fact Completion Voice Dictation Design

## Summary

Add `dictation-style` voice input to `Fact Completion` so the user can speak and see text appear in the composer while talking, then edit the text before sending. This is scoped to `Fact Completion` only and is optimized for desktop Chrome / Dia. Unsupported browsers should silently fall back to text-only input by hiding the microphone control.

## Product Behavior

- Replace the current plain `st.chat_input` area in `Fact Completion` with a custom `chat composer`.
- The composer includes:
  - a multi-line text input area
  - a send button
  - a microphone button shown only when browser dictation is supported
- Clicking the microphone starts browser-native speech recognition.
- While listening, recognized text appears in the composer in real time.
- The user can stop dictation manually and edit the text before sending.
- Sending the message continues to use the existing `submit_fact_completion_answer` flow unchanged.
- Browser support rule:
  - desktop Chrome / Dia: show microphone and enable dictation
  - unsupported browsers or denied microphone permission: hide microphone and keep text input only

## UX States

### Composer states

- `idle`
  - text box editable
  - microphone visible if supported
  - send button active when text is not empty
- `listening`
  - microphone visually highlighted
  - lightweight status text such as `Listening...`
  - partial transcript streams into the input area
- `stopped`
  - transcript remains in the input area
  - user can edit, resume, or send

### Fact Completion entry feel

- The page should feel like entering a conversation, not a form.
- Keep the existing `Conversation` card and warm-start assistant message.
- The composer should sit directly under the conversation history and visually read as a chat input area.

## Technical Design

### Frontend

- Stop relying on raw `st.chat_input` for `Fact Completion`.
- Render a custom composer block in `streamlit_app.py`.
- Use a browser-side speech recognition implementation based on Web Speech API:
  - `window.SpeechRecognition || window.webkitSpeechRecognition`
- Recognition settings:
  - `continuous = true`
  - `interimResults = true`
  - language default: `zh-CN`
- Stream interim and final transcript updates into the composer value.
- Keep browser detection and microphone visibility fully on the client side.

### Streamlit integration

- Use a small embedded frontend component inside the Streamlit page for the composer.
- The component returns:
  - current text value
  - listening state
  - send action
- Python side remains responsible for:
  - rendering conversation history
  - handling submitted text
  - calling `submit_fact_completion_answer`
  - rerendering after submit

### Backward compatibility

- Do not change `WorkflowService` message-generation logic for this feature.
- Do not change DB schema.
- Do not store raw audio.
- If the browser does not support dictation, render the same composer without microphone affordance.

## Implementation Changes

- `streamlit_app.py`
  - replace the current `st.chat_input` usage in `Fact Completion`
  - mount a custom voice-capable composer
  - keep text-only fallback behavior
- `frontend component assets`
  - add a minimal browser-side dictation composer implementation
  - handle support detection, mic state, interim transcript, stop/start, and send
- optional small helper module
  - normalize payload from the frontend component into existing submit flow

## Edge Cases

- User denies microphone permission:
  - hide or disable mic for the session and preserve text input
- Browser supports recognition but recognition fails mid-session:
  - stop listening
  - keep already transcribed text
  - do not auto-send
- User speaks, then types:
  - typed edits must win and remain editable
- User starts dictation with existing text:
  - append new transcript to current composer content instead of replacing it
- Empty transcript:
  - do not submit

## Test Plan

- Supported browser path:
  - microphone renders
  - clicking mic enters listening state
  - interim transcript appears in the composer
  - final transcript can be edited and sent
- Unsupported browser path:
  - microphone is hidden
  - text-only composer still submits normally
- Permission denied path:
  - no crash
  - text-only input remains usable
- Submit path:
  - submitted transcript reaches existing `submit_fact_completion_answer`
  - conversation rerenders correctly after response
- Regression:
  - existing text-only `Fact Completion` flow still works
  - no change to `Baseline Review`, `Resume Import`, or downstream steps

## Assumptions

- First version only targets desktop Chrome-compatible browsers such as Chrome and Dia.
- First version does not need mobile browser support.
- First version does not need audio persistence, real-time server streaming ASR, or voice reply.
- First version uses browser-native dictation instead of model-based transcription.
