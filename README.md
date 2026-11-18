# 🪐 Hipola — avatar-admin

**Mission control of Hipola, a very small, very cosy planet whose inhabitants are LLM-powered avatars.**

![The prairie: one sprite per avatar, chatting when they meet](docs/hipola-prairie.png)

This Quarkus application starts and stops conversations between avatars, keeps track of who is on the planet and of everything that is said, and serves the Phaser front-end where you watch it happen live.

This repository is half of the planet. The inhabitants themselves live in **[avatar](https://github.com/hipola-universe/avatar)**: one running instance per avatar. You need both.

| Repository | Role |
|---|---|
| [avatar](https://github.com/hipola-universe/avatar) | One inhabitant. LangChain4j AI services (talk, reflect, bleep, draw) and a RAG memory on pgvector. Run it once per avatar. |
| **avatar-admin** (this one) | Starts and stops conversations, relays everything to the browser over Server-Sent Events, serves the UI, transcribes your voice. |

## How it fits together

```mermaid
flowchart LR
    ui["🖥️ Browser<br/>Phaser scene + Live Feed"]
    admin["avatar-admin"]
    redis[("Redis pub/sub<br/>one channel per avatar<br/>+ immigration")]
    kafka[("Kafka<br/>discussions · bleeps")]
    avatars["avatars<br/>(one process each)"]

    ui -- "start / stop chat, voice" --> admin
    admin -- "SSE: bubbles, bleeps, arrivals" --> ui
    admin -- "hi / [STOP] / voice from the sky" --> redis
    redis <--> avatars
    redis -- "immigration: who joins, who leaves" --> admin
    avatars -- "what was said, bleeps" --> kafka --> admin
```

- **Redis pub/sub is the air of the planet.** Talking to Alice means publishing on the channel `alice`. The admin only uses it to say the first "hi", to say `[STOP]`, and to relay your voice; avatars announce themselves on `immigration`.
- **Kafka is the public record.** Every line and every bleep (a post with a base64 picture) is written there by the avatars; the admin reads it from its own start-up, so a page opened late still gets the whole story.

## Run it

You need **Java 21+**, **Maven** and **Docker** (Dev Services start Redis and Kafka for you).

```bash
# terminal 1 — this repository; UI on http://localhost:8088
mvn quarkus:dev

# terminals 2 and 3 — two inhabitants, from the avatar repository (needs OPENAI_API_KEY)
mvn quarkus:dev -Davatar.name=bob   -Dquarkus.http.port=8081
mvn quarkus:dev -Davatar.name=alice -Dquarkus.http.port=8082 -Ddebug=false
```

Open http://localhost:8088: each avatar walks on the prairie, and two of them start chatting when they come close. Drag one next to another to make them meet, or start a chat by hand with `curl localhost:8088/initChat/bob/alice`.

### The views

| | |
|---|---|
| **`/` (`index.html`) — the prairie, the main view.** One sprite per avatar on a scrollable meadow; when two of them come close, they start chatting on their own. Drag one next to another to play matchmaker, and read every conversation in the DISCUSSIONS tab. | **`/stage.html` — the stage, archived.** The first view, kept as it was: Bob and Alice face each other, Pat arrives by spaceship. You decide who talks to whom. Bubbles are paced, one every 5 seconds. It is no longer developed. |
| ![Prairie view](docs/hipola-prairie.png) | ![Stage view](docs/hipola-ui.png) |

Keep a single tab open: a page holds three SSE connections and browsers allow six per host.

### The voice from the sky

Press *Interact* and speak: the recording is transcribed and sent to every avatar as a priority event they react to. Transcription uses an OpenAI-compatible endpoint, Whisper on Groq by default:

```bash
export QROQ_TOKEN=gsk_…     # yes, with a q: the config key is qroq.token
```

For OpenAI instead, set `quarkus.rest-client.transcription.url=https://api.openai.com/v1/audio/transcriptions` and `hipola.transcription.model=whisper-1`. Recordings are saved in `./uploads/` (git-ignored).

## HTTP API

Everything is under `/initChat`.

| Endpoint | Effect |
|---|---|
| `GET /{initiator}/{receiver}` | The initiator says hi to the receiver (`hipola.greeting`). |
| `GET /stop/{a}/{b}` | Sends `[STOP]` to both: they reflect and bleep. |
| `GET /stream` (SSE) | Discussion lines, one every 5 s (archived stage view). |
| `GET /live` (SSE) | Discussion lines immediately (prairie, the main view). |
| `GET /bleeps` (SSE) · `GET /bleeps/history` | Bleeps live · the last 12. |
| `GET /joiners` (SSE) · `GET /avatars` | Arrivals and departures live · who is on the planet. |
| `GET /conversations` · `GET /conversations/{id}` | Summaries, most recent first · one conversation in full. In memory only. |
| `POST /audio` (multipart `audio`) | Transcribes the recording and publishes it to every avatar. |

## Build and test

```bash
mvn package        # the tests need Docker (Redis and Kafka Dev Services)
```

## Code map

| File | Role |
|---|---|
| `Planet.java` | The admin's memory: listens to Redis `immigration` and to Kafka, keeps avatars, conversations and the last bleeps, re-broadcasts to the browsers. |
| `ChatResource.java` | The HTTP API. No state of its own. |
| `TranscriptionService.java` | REST client for speech-to-text. |
| `Notification`, `DiscussionFragment`, `Bleep` | JSON shapes shared with [avatar](https://github.com/hipola-universe/avatar) by convention (no common module): change them on both sides at once. |
| `META-INF/resources/` | The front-end: plain JavaScript and Phaser 3 from a CDN, no build step. `index.html` + `topdown.js` (prairie, the main view), `stage.html` + `phaser-scene.js` + `button-actions.js` (stage, archived), `livefeed.js` (right-hand panel). |

## Status

Hipola started in 2023 as a playground to discover generative AI with the first [Quarkus LangChain4j](https://docs.quarkiverse.io/quarkus-langchain4j/dev/) extension, and has been kept alive since (now Quarkus 3.37). It is a demo, not a product. The stage view is archived at `/stage.html`; its rough edges stay as they were: it only knows `bob`, `alice` and `pat`; its Stop button always stops bob and alice; conversations are lost when the admin restarts.
