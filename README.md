# CodeCollab

A **local-first**, real-time collaborative code editor built with Rust, Tauri, and Next.js. Features CRDT-based document synchronization, live cursor presence, voice chat, and an integrated development environment.

![CodeCollab](https://img.shields.io/badge/Built%20with-Rust%20%26%20Tauri-orange)
![License](https://img.shields.io/badge/license-MIT-blue)
![Protocol](https://img.shields.io/badge/Protocol-v1-green)

## ✨ Features

### 🔄 Local-First CRDT Synchronization
- **Automerge CRDTs**: Conflict-free document synchronization using Automerge
- **Binary Protocol**: Efficient WebSocket communication with binary message encoding
- **Offline Support**: Work offline and sync when reconnected
- **No Conflicts**: Concurrent edits are automatically merged without conflicts

### 👥 Real-time Collaboration
- **Live Cursors**: See collaborators' cursor positions with stable Automerge cursors
- **Presence Awareness**: Real-time status indicators (active, idle, away)
- **User Colors**: Each collaborator gets a unique color
- **Typing Indicators**: See when others are actively editing

### 🎤 Voice Chat (LiveKit)
- **Real-time Audio**: WebRTC-based voice communication via LiveKit
- **Room-based**: Voice rooms tied to project collaboration
- **Mute/Deafen**: Full audio controls
- **Speaking Indicators**: Visual feedback when someone is talking

### 📁 Movable Tree File System
- **CRDT File Tree**: Collaborative file/folder structure using movable tree CRDT
- **On-Demand Loading**: File contents loaded when opened (not all at once)
- **Host Model**: One user opens a local folder, others collaborate remotely
- **Live Updates**: File/folder changes sync in real-time

### 💻 Integrated Development Environment
- **Monaco Editor**: VS Code's editor with 50+ language support
- **Syntax Highlighting**: Automatic language detection
- **Multi-File Tabs**: Work on multiple files simultaneously
- **File Explorer**: Navigate project structure visually

### 🧪 API Testing (Thunder Client Alternative)
- **HTTP Methods**: GET, POST, PUT, PATCH, DELETE support
- **Headers Management**: Add and toggle request headers
- **Request Body**: JSON body editor for POST/PUT/PATCH
- **Response Viewer**: Status, time, size, and formatted body

### 🤖 AI Debug Assistant
- **Error Analysis**: Get help debugging errors
- **Code Explanations**: Ask questions about code
- **Quick Suggestions**: Pre-built prompts for common issues

## 🛠️ Tech Stack

### Backend (Rust)
| Component | Technology |
|-----------|------------|
| Web Framework | [Axum](https://github.com/tokio-rs/axum) with WebSocket support |
| CRDT Engine | [Automerge](https://automerge.org/) v0.5+ |
| Database | [Sled](https://sled.rs/) embedded database |
| Async Runtime | [Tokio](https://tokio.rs/) |
| Concurrency | [DashMap](https://docs.rs/dashmap) for lock-free access |
| Voice Chat | [LiveKit](https://livekit.io/) (JWT token generation) |

### Frontend
| Component | Technology |
|-----------|------------|
| Desktop Shell | [Tauri](https://tauri.app/) v2 |
| UI Framework | [Next.js](https://nextjs.org/) 16 |
| Code Editor | [Monaco Editor](https://microsoft.github.io/monaco-editor/) |
| State Management | [Zustand](https://zustand-demo.pmnd.rs/) |
| Styling | [TailwindCSS](https://tailwindcss.com/) 4 |

## 📋 Prerequisites

- [Rust](https://rustup.rs/) (1.77+)
- [Node.js](https://nodejs.org/) (20+)
- [pnpm](https://pnpm.io/) (recommended package manager)

## 🚀 Quick Start

### 1. Clone the repository

```bash
git clone <your-repo-url>
cd rustafrica
```

### 2. Start the collaboration server

```bash
cd server
cargo run --release
```

You should see:
```
INFO collab_server: Initializing storage at: ./data/collab.sled
INFO collab_server: Storage initialized successfully
INFO collab_server: 🚀 CodeCollab server v0.2.0 starting
INFO collab_server:    Protocol version: 1
INFO collab_server:    Listening on: http://0.0.0.0:5000
INFO collab_server:    WebSocket: ws://0.0.0.0:5000/ws/{project_id}
INFO collab_server:    Health check: http://0.0.0.0:5000/health
```

### 3. Install frontend dependencies

```bash
cd client
pnpm install
```

### 4. Start the Tauri app

```bash
pnpm tauri dev
```

Or run just the web interface:

```bash
pnpm dev
```

## 📖 Architecture

### CRDT Synchronization Flow

```
┌──────────────┐                    ┌──────────────┐
│   Client A   │                    │   Client B   │
│  (Automerge) │                    │  (Automerge) │
└──────┬───────┘                    └──────┬───────┘
       │                                   │
       │  Binary Sync Messages             │
       ▼                                   ▼
┌─────────────────────────────────────────────────┐
│                 SyncServer                       │
│  ┌─────────────────────────────────────────┐    │
│  │     DashMap<ProjectId, ProjectRoom>     │    │
│  │  ┌─────────────────────────────────┐    │    │
│  │  │   ProjectRoom                   │    │    │
│  │  │   - Automerge Document          │    │    │
│  │  │   - Per-peer sync state         │    │    │
│  │  │   - Broadcast channel           │    │    │
│  │  └─────────────────────────────────┘    │    │
│  └─────────────────────────────────────────┘    │
│                      │                          │
│                      ▼                          │
│  ┌─────────────────────────────────────────┐    │
│  │          Sled Database                  │    │
│  │   - Binary document snapshots           │    │
│  │   - Incremental changes                 │    │
│  │   - Peer sync states                    │    │
│  └─────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
```

### Document Structure (Automerge)

```
Root
├── file_tree: Map<NodeId, FileTreeNode>
│   └── NodeId: { name, path, is_dir, parent_id, children }
├── files: Map<Path, FileContent>
│   └── Path: { content: Text CRDT, language, version }
├── cursors: Map<PeerId, CursorPosition>
├── chat: List<ChatMessage>
└── metadata: { project_name, owner_id, created_at }
```

### Binary Protocol

Messages are encoded as:
```
┌─────────┬──────────┬────────────┬─────────────┐
│ Version │ MsgType  │ PayloadLen │   Payload   │
│  1 byte │  1 byte  │  3 bytes   │   N bytes   │
└─────────┴──────────┴────────────┴─────────────┘
```

Message types include:
- `0x01-0x04`: Connection (Hello, Welcome, Goodbye, Error)
- `0x10-0x12`: Sync (SyncRequest, SyncMessage, SyncComplete)
- `0x20-0x23`: Project (Join, Leave, Joined, Left)
- `0x40-0x43`: Presence (Updates, Broadcasts, Cursors)
- `0x50-0x51`: Chat (Messages, History)
- `0x60-0x62`: Voice (Join, Leave, Token)

## 🔌 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check with stats |
| `/api/projects` | GET | List all projects |
| `/api/projects` | POST | Create a new project |
| `/api/projects/{id}` | GET | Get project details |
| `/ws/{project_id}` | WS | WebSocket connection |

### Legacy Endpoints (Backward Compatible)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/rooms` | GET/POST | Alias for `/api/projects` |
| `/api/rooms/{id}` | GET | Alias for `/api/projects/{id}` |

## ⚙️ Configuration

### Environment Variables

```bash
# Server
PORT=5000                              # Server port
STORAGE_PATH=./data/collab.sled        # Sled database path
RUST_LOG=info                          # Log level

# LiveKit (optional, for voice chat)
LIVEKIT_API_KEY=your-api-key
LIVEKIT_API_SECRET=your-api-secret
LIVEKIT_URL=wss://your-livekit-server
```

### Storage Configuration

The server uses Sled for persistent storage with:
- **Compression**: Enabled by default for smaller storage
- **Cache Size**: 1GB default (configurable)
- **Flush Interval**: 500ms (configurable)

## 📁 Project Structure

```
rustafrica/
├── client/                     # Tauri + Next.js frontend
│   ├── app/
│   │   ├── components/         # React components
│   │   ├── hooks/              # Custom React hooks
│   │   │   ├── useCollaboration.ts
│   │   │   └── useVoiceChat.ts
│   │   ├── lib/                # Utilities
│   │   └── store/              # Zustand stores
│   └── src-tauri/              # Tauri Rust backend
│
├── server/                     # Collaboration server
│   └── src/
│       ├── main.rs             # Entry point & HTTP handlers
│       ├── sync/               # CRDT synchronization
│       │   ├── mod.rs
│       │   ├── document.rs     # Automerge document wrapper
│       │   ├── server.rs       # SyncServer implementation
│       │   ├── protocol.rs     # Binary protocol
│       │   └── presence.rs     # Cursor & presence
│       ├── storage/            # Persistence
│       │   ├── mod.rs
│       │   └── sled_store.rs   # Sled implementation
│       ├── room/               # File tree management
│       │   ├── mod.rs
│       │   ├── file_tree.rs    # Movable tree CRDT
│       │   └── manager.rs      # Room state
│       └── voice/              # Voice chat
│           ├── mod.rs
│           └── livekit.rs      # LiveKit integration
│
└── tests/                      # Test files
```

## 🧪 Testing

### Server Tests

```bash
cd server
cargo test
```

### Integration Tests

```bash
# Start the server first
cd server && cargo run &

# Run tests
./tests/test_server.sh
```

### Manual Testing

```bash
# Health check
curl http://localhost:5000/health

# Create a project
curl -X POST http://localhost:5000/api/projects \
  -H "Content-Type: application/json" \
  -d '{"name": "My Project"}'

# List projects
curl http://localhost:5000/api/projects
```

## 🔧 Troubleshooting

### Server won't start

1. Check if port 5000 is in use: `lsof -i :5000`
2. Verify Rust is installed: `rustc --version`
3. Check storage permissions: `ls -la ./data/`

### WebSocket connection fails

1. Verify server is running: `curl http://localhost:5000/health`
2. Check CORS settings if using web client
3. Verify WebSocket URL format: `ws://localhost:5000/ws/{project_id}`

### Storage errors

1. Delete corrupted database: `rm -rf ./data/collab.sled`
2. Check disk space: `df -h`
3. Verify write permissions

### Voice chat not working

1. Set LiveKit environment variables
2. Check LiveKit server connectivity
3. Verify microphone permissions in browser

## 🏗️ Building for Production

### Build the server

```bash
cd server
cargo build --release
```

Binary location: `server/target/release/collab-server`

### Build the Tauri app

```bash
cd client
pnpm tauri build
```

### Docker Deployment

```dockerfile
FROM rust:1.77 as builder
WORKDIR /app
COPY server/ .
RUN cargo build --release

FROM debian:bookworm-slim
COPY --from=builder /app/target/release/collab-server /usr/local/bin/
ENV STORAGE_PATH=/data/collab.sled
EXPOSE 5000
CMD ["collab-server"]
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

MIT License - see LICENSE for details

## 🙏 Acknowledgments

- [Automerge](https://automerge.org/) - CRDT implementation
- [Sled](https://sled.rs/) - Embedded database
- [Monaco Editor](https://microsoft.github.io/monaco-editor/) - Code editor
- [Tauri](https://tauri.app/) - Desktop framework
- [Axum](https://github.com/tokio-rs/axum) - Web framework
- [LiveKit](https://livekit.io/) - Voice infrastructure

---

Made with ❤️ using Rust and TypeScript