# Soulmate Product Direction

Soulmate is a wearable emotional companion that grows from daily interaction. The pendant is the always-near interface; the phone and computer provide networking, memory, model inference, and authorized device control.

## Product Loop

1. The user names a new Soulmate and chooses its birthday, gender, initial temperament, and voice.
2. Daily conversation updates a structured personality profile and a bounded memory record.
3. Bond milestones unlock original visual stages and new capabilities.
4. The same identity follows the user across the pendant, mobile app, desktop presence, and home gateway.

## Evolution Model

The first visual family has three stages: Soul Seed, Young Companion, and Resonance Companion. Evolution is driven primarily by meaningful conversation and shared events. Repeated tapping has a session cap so it cannot replace relationship development.

Personality is represented by warmth, curiosity, steadiness, courage, and independence. Initial temperament only seeds these values. Conversation can change them gradually.

## Runtime Boundaries

- Pendant: microphone, speaker, display, haptics, wake control, Bluetooth, Wi-Fi, and motion sensing.
- Mobile gateway: authentication, encrypted memory sync, speech pipeline, Matter/Home Assistant/vendor integration, and model access.
- Soulmate Bridge: a local computer service that exposes a small permissioned command API.
- Hermes Core: the tool and skill orchestration layer. It is not the visible character identity.

Bluetooth pairing alone does not imply appliance control. Commands must pass through a configured gateway and return a verified tool result before Soulmate claims success.

## Conversation Safety

Voice interaction follows one state machine: idle, listening, thinking, speaking, then idle. Recognition stops before speech playback, and recent synthesized speech is checked against new transcripts to suppress acoustic echo.

Sending messages, deleting files, purchases, locks, cameras, and account changes require action-specific confirmation. The companion must not claim it saw, heard, or controlled something without a verified sensor or tool result.

## Data Ownership

The user can export or delete the profile, memories, and conversation history. Long-term memory is bounded and sanitized before it reaches the model. Hardware prototypes should encrypt stored identity and memory data and provide a physical microphone mute.
