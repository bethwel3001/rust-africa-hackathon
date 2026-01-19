//! CodeCollab Server - Local-First Collaborative Code Editor
//!
//! A real-time collaboration server using:
//! - Automerge CRDTs for conflict-free document synchronization
//! - Sled embedded database for binary document persistence
//! - Axum with WebSocket for high-performance communication
//! - Binary protocol for efficient sync message transfer

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, State,
    },
    http::{Method, StatusCode},
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::{net::SocketAddr, sync::Arc};
use tokio::sync::mpsc;
use tower_http::cors::{Any, CorsLayer};
use tracing::{debug, error, info, warn};

mod room;
mod storage;
mod sync;
mod voice;

use room::RoomManager;
use storage::{DocumentMetadata, DocumentStore, StorageConfig};
use sync::{
    presence::generate_peer_color,
    protocol::{
        ClientMessage, ErrorCode, PeerInfo, PresenceStatus, ServerMessage,
        SyncProtocol, PROTOCOL_VERSION,
    }, SyncServer, SyncServerConfig,
};
use voice::{LiveKitConfig, LiveKitService, VoicePermissions};

// ============================================================================
// APPLICATION STATE
// ============================================================================

/// Shared application state
pub struct AppState {
    /// CRDT synchronization server
    sync_server: Arc<SyncServer>,
    /// Room/file tree manager
    room_manager: Arc<RoomManager>,
    /// Voice chat service
    voice_service: Arc<LiveKitService>,
    /// Server start time
    started_at: std::time::Instant,
}

impl AppState {
    pub async fn new(storage: DocumentStore) -> Self {
        let config = SyncServerConfig::default();
        let sync_server = Arc::new(SyncServer::new(storage, config));
        let room_manager = Arc::new(RoomManager::new());

        // Try to configure voice service from environment
        let voice_service = match LiveKitConfig::from_env() {
            Ok(config) => {
                info!("LiveKit configured from environment");
                Arc::new(LiveKitService::new(config).unwrap_or_else(|_| LiveKitService::unconfigured()))
            }
            Err(_) => {
                warn!("LiveKit not configured - voice chat will be disabled");
                Arc::new(LiveKitService::unconfigured())
            }
        };

        Self {
            sync_server,
            room_manager,
            voice_service,
            started_at: std::time::Instant::now(),
        }
    }
}

// ============================================================================
// API TYPES
// ============================================================================

#[derive(Debug, Serialize)]
struct HealthResponse {
    status: String,
    version: String,
    protocol_version: u8,
    uptime_seconds: u64,
    active_projects: usize,
    active_peers: usize,
}

#[derive(Debug, Deserialize)]
struct CreateProjectRequest {
    name: Option<String>,
}

#[derive(Debug, Serialize)]
struct CreateProjectResponse {
    project_id: String,
    name: String,
    ws_url: String,
}

#[derive(Debug, Serialize)]
struct ProjectInfo {
    project_id: String,
    name: String,
    peer_count: usize,
    has_host: bool,
    created_at: i64,
}

#[derive(Debug, Serialize)]
struct ProjectListResponse {
    projects: Vec<ProjectInfo>,
    total: usize,
}

#[derive(Debug, Serialize)]
struct ProjectDetailResponse {
    project_id: String,
    name: String,
    peers: Vec<PeerInfo>,
    file_count: usize,
    folder_count: usize,
}

// ============================================================================
// HTTP HANDLERS
// ============================================================================

/// Health check endpoint
async fn health_check(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let stats = state.sync_server.stats();

    Json(HealthResponse {
        status: "healthy".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        protocol_version: PROTOCOL_VERSION,
        uptime_seconds: state.started_at.elapsed().as_secs(),
        active_projects: stats.active_projects,
        active_peers: stats.active_peers,
    })
}

/// Create a new project/room
async fn create_project(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<CreateProjectRequest>,
) -> Result<Json<CreateProjectResponse>, (axum::http::StatusCode, String)> {
    // Generate a safe project ID from UUID
    let full_uuid = uuid::Uuid::new_v4().to_string();
    let project_id: String = full_uuid.chars().take(8).collect();

    let short_id: String = project_id.chars().take(4).collect();
    let name = payload
        .name
        .unwrap_or_else(|| format!("Project {}", short_id));

    info!("Creating project: {} ({})", name, project_id);

    // Create room in room manager
    state.room_manager.create_room(&project_id, &name).await;

    // Save metadata
    let metadata = DocumentMetadata::new(&project_id, &name);
    if let Err(e) = state.sync_server.storage().save_metadata(&metadata) {
        error!("Failed to save project metadata: {}", e);
        // Continue anyway - room is created in memory
    }

    info!("Created project successfully: {} ({})", name, project_id);

    let response = CreateProjectResponse {
        project_id: project_id.clone(),
        name,
        ws_url: format!("/ws/{}", project_id),
    };

    Ok(Json(response))
}

/// List all projects
async fn list_projects(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let storage = state.sync_server.storage();

    match storage.list_documents() {
        Ok(docs) => {
            let projects: Vec<ProjectInfo> = docs
                .into_iter()
                .map(|meta| {
                    let peer_count = state
                        .sync_server
                        .presence()
                        .get(&meta.project_id)
                        .map(|p| p.peer_count())
                        .unwrap_or(0);

                    ProjectInfo {
                        project_id: meta.project_id,
                        name: meta.name,
                        peer_count,
                        has_host: false, // Would need to check room state
                        created_at: meta.created_at,
                    }
                })
                .collect();

            let total = projects.len();
            Json(ProjectListResponse { projects, total })
        }
        Err(e) => {
            error!("Failed to list projects: {}", e);
            Json(ProjectListResponse {
                projects: vec![],
                total: 0,
            })
        }
    }
}

/// Get project details
async fn get_project(
    State(state): State<Arc<AppState>>,
    Path(project_id): Path<String>,
) -> Result<impl IntoResponse, StatusCode> {
    let storage = state.sync_server.storage();

    let metadata = storage
        .get_metadata(&project_id)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;

    let peers: Vec<PeerInfo> = state
        .sync_server
        .presence()
        .get(&project_id)
        .map(|p| {
            p.get_all_peers()
                .into_iter()
                .map(|presence| PeerInfo {
                    peer_id: presence.peer_id,
                    name: presence.name,
                    color: presence.color,
                    status: match presence.status {
                        sync::presence::PresenceStatus::Active => PresenceStatus::Active,
                        sync::presence::PresenceStatus::Idle => PresenceStatus::Idle,
                        sync::presence::PresenceStatus::Away => PresenceStatus::Away,
                        sync::presence::PresenceStatus::Offline => PresenceStatus::Offline,
                    },
                    active_file: presence.active_file,
                    joined_at: presence.joined_at,
                })
                .collect()
        })
        .unwrap_or_default();

    // Get file tree stats
    let (file_count, folder_count) = state
        .room_manager
        .get_file_tree(&project_id)
        .await
        .map(|tree| (tree.file_count(), tree.directory_count()))
        .unwrap_or((0, 0));

    Ok(Json(ProjectDetailResponse {
        project_id: metadata.project_id,
        name: metadata.name,
        peers,
        file_count,
        folder_count,
    }))
}

// ============================================================================
// WEBSOCKET HANDLER
// ============================================================================

/// WebSocket upgrade handler
async fn ws_handler(
    ws: WebSocketUpgrade,
    Path(project_id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    info!("WebSocket upgrade request for project: {}", project_id);
    ws.on_upgrade(move |socket| handle_websocket(socket, project_id, state))
}

/// Handle WebSocket connection
async fn handle_websocket(socket: WebSocket, project_id: String, state: Arc<AppState>) {
    let (mut ws_sender, mut ws_receiver) = socket.split();

    // Generate peer identifiers
    let peer_id = uuid::Uuid::new_v4().to_string();
    let peer_color = generate_peer_color();
    let session_token = generate_session_token();

    info!(
        "New WebSocket connection: peer={}, project={}",
        peer_id, project_id
    );

    // Create channel for sending messages to this peer
    let (tx, mut rx) = mpsc::unbounded_channel::<ServerMessage>();

    // Register peer with sync server
    if let Err(e) = state.sync_server.register_peer(
        &peer_id,
        "Anonymous", // Will be updated on Hello
        &peer_color,
        &session_token,
        tx.clone(),
    ) {
        error!("Failed to register peer: {}", e);
        return;
    }

    // Send welcome message
    let welcome = ServerMessage::Welcome {
        protocol_version: PROTOCOL_VERSION,
        peer_id: peer_id.clone(),
        color: peer_color.clone(),
        session_token: session_token.clone(),
        server_time: chrono::Utc::now().timestamp(),
    };

    if let Err(e) = send_server_message(&mut ws_sender, &welcome).await {
        error!("Failed to send welcome: {}", e);
        state.sync_server.unregister_peer(&peer_id);
        return;
    }

    // Clone values for tasks
    let peer_id_recv = peer_id.clone();
    let peer_id_send = peer_id.clone();
    let project_id_recv = project_id.clone();
    let state_recv = state.clone();

    // Task to forward messages from channel to WebSocket
    let send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            match SyncProtocol::encode_server(&msg) {
                Ok(bytes) => {
                    if ws_sender.send(Message::Binary(bytes.to_vec())).await.is_err() {
                        break;
                    }
                }
                Err(e) => {
                    warn!("Failed to encode message: {}", e);
                }
            }
        }
        debug!("Send task ended for peer {}", peer_id_send);
    });

    // Task to handle incoming WebSocket messages
    let recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_receiver.next().await {
            match msg {
                Message::Binary(data) => {
                    // Try to decode as binary protocol
                    match SyncProtocol::decode_client(&data) {
                        Ok(client_msg) => {
                            handle_client_message(
                                client_msg,
                                &peer_id_recv,
                                &project_id_recv,
                                &state_recv,
                                &tx,
                            )
                            .await;
                        }
                        Err(e) => {
                            warn!("Failed to decode binary message: {}", e);
                        }
                    }
                }
                Message::Text(text) => {
                    // Also support JSON for compatibility/debugging
                    if let Ok(client_msg) = serde_json::from_str::<ClientMessage>(&text) {
                        handle_client_message(
                            client_msg,
                            &peer_id_recv,
                            &project_id_recv,
                            &state_recv,
                            &tx,
                        )
                        .await;
                    } else {
                        // Try legacy JSON format
                        handle_legacy_json(&text, &peer_id_recv, &project_id_recv, &state_recv, &tx)
                            .await;
                    }
                }
                Message::Ping(_) => {
                    // Pong is handled automatically
                }
                Message::Close(_) => {
                    info!("WebSocket closed by client: {}", peer_id_recv);
                    break;
                }
                _ => {}
            }
        }
        debug!("Receive task ended for peer {}", peer_id_recv);
    });

    // Wait for either task to complete
    tokio::select! {
        _ = send_task => {}
        _ = recv_task => {}
    }

    // Cleanup
    state.sync_server.unregister_peer(&peer_id);
    info!("Peer {} disconnected from project {}", peer_id, project_id);
}

/// Handle a decoded client message
async fn handle_client_message(
    msg: ClientMessage,
    peer_id: &str,
    project_id: &str,
    state: &Arc<AppState>,
    tx: &mpsc::UnboundedSender<ServerMessage>,
) {
    match msg {
        ClientMessage::Hello {
            client_name,
            session_token,
            ..
        } => {
            // Update peer name if provided
            if let Some(peer) = state.sync_server.get_peer(peer_id) {
                peer.write().name = client_name.clone();
            }

            // Check for session restoration
            if let Some(token) = session_token {
                if let Some(existing_peer_id) = state.sync_server.restore_session(&token) {
                    info!("Session restored for peer {} -> {}", existing_peer_id, peer_id);
                }
            }

            debug!("Hello from peer {}: {}", peer_id, client_name);
        }

        ClientMessage::JoinProject {
            project_id: req_project_id,
            request_state,
        } => {
            match state
                .sync_server
                .join_project(peer_id, &req_project_id, request_state)
                .await
            {
                Ok(response) => {
                    let _ = tx.send(response);
                }
                Err(e) => {
                    let _ = tx.send(ServerMessage::Error {
                        code: ErrorCode::ServerError,
                        message: e.to_string(),
                        project_id: Some(req_project_id),
                    });
                }
            }
        }

        ClientMessage::LeaveProject {
            project_id: req_project_id,
        } => {
            let _ = state.sync_server.leave_project(peer_id, &req_project_id);
            let _ = tx.send(ServerMessage::ProjectLeft {
                project_id: req_project_id,
            });
        }

        ClientMessage::SyncMessage {
            project_id: req_project_id,
            sync_data,
        } => {
            match state
                .sync_server
                .handle_sync_message(peer_id, &req_project_id, sync_data)
                .await
            {
                Ok(Some(response_data)) => {
                    let _ = tx.send(ServerMessage::SyncMessage {
                        project_id: req_project_id.clone(),
                        sync_data: response_data,
                        from_peer: None,
                    });
                }
                Ok(None) => {
                    // No response needed
                }
                Err(e) => {
                    warn!("Sync error: {}", e);
                }
            }
        }

        ClientMessage::SyncRequest {
            project_id: req_project_id,
        } => {
            if let Some(sync_data) = state
                .sync_server
                .generate_sync_for_peer(peer_id, &req_project_id)
            {
                let _ = tx.send(ServerMessage::SyncMessage {
                    project_id: req_project_id,
                    sync_data,
                    from_peer: None,
                });
            }
        }

        ClientMessage::OpenFile {
            project_id: req_project_id,
            file_path,
        } => {
            match state
                .room_manager
                .load_file_content(&req_project_id, &file_path)
                .await
            {
                Ok(content) => {
                    let _ = tx.send(ServerMessage::FileContent {
                        project_id: req_project_id,
                        file_path,
                        content: content.content,
                        language: content.language,
                        version: 1,
                    });
                }
                Err(_) => {
                    let _ = tx.send(ServerMessage::FileNotFound {
                        project_id: req_project_id,
                        file_path,
                    });
                }
            }
        }

        ClientMessage::CloseFile { .. } => {
            // Track file close for presence
        }

        ClientMessage::CursorUpdate {
            project_id: req_project_id,
            file_path,
            line,
            column,
            selection_end,
        } => {
            // Update presence with cursor position
            if let Some(project_presence) = state.sync_server.presence().get(&req_project_id) {
                let cursor = sync::presence::Cursor::new(&file_path, line, column);
                let _ = project_presence.update_cursor(peer_id, cursor);

                // Get peer info and broadcast cursor to other peers
                if let Some(peer) = state.sync_server.get_peer(peer_id) {
                    let peer = peer.read();
                    let cursor_msg = ServerMessage::CursorBroadcast {
                        project_id: req_project_id.clone(),
                        peer_id: peer_id.to_string(),
                        peer_name: peer.name.clone(),
                        peer_color: peer.color.clone(),
                        file_path,
                        line,
                        column,
                        selection_end,
                    };
                    state.sync_server.broadcast_to_project(&req_project_id, peer_id, cursor_msg);
                }
            }
        }

        ClientMessage::PresenceUpdate {
            project_id: req_project_id,
            status,
            active_file,
        } => {
            if let Some(project_presence) = state.sync_server.presence().get(&req_project_id) {
                let presence_status = match status {
                    PresenceStatus::Active => sync::presence::PresenceStatus::Active,
                    PresenceStatus::Idle => sync::presence::PresenceStatus::Idle,
                    PresenceStatus::Away => sync::presence::PresenceStatus::Away,
                    PresenceStatus::Offline => sync::presence::PresenceStatus::Offline,
                };
                let _ = project_presence.update_status(peer_id, presence_status.clone(), active_file.clone());

                // Broadcast presence update to other peers
                if let Some(peer) = state.sync_server.get_peer(peer_id) {
                    let peer = peer.read();
                    let presence_msg = ServerMessage::PresenceBroadcast {
                        project_id: req_project_id.clone(),
                        peer_id: peer_id.to_string(),
                        peer_name: peer.name.clone(),
                        status,
                        active_file,
                        last_active: chrono::Utc::now().timestamp(),
                    };
                    state.sync_server.broadcast_to_project(&req_project_id, peer_id, presence_msg);
                }
            }
        }

        ClientMessage::ChatMessage {
            project_id: req_project_id,
            content,
        } => {
            // Get peer info and broadcast chat message
            if let Some(peer) = state.sync_server.get_peer(peer_id) {
                let peer = peer.read();
                let timestamp = chrono::Utc::now().timestamp();

                let chat_msg = ServerMessage::ChatBroadcast {
                    project_id: req_project_id.clone(),
                    peer_id: peer_id.to_string(),
                    peer_name: peer.name.clone(),
                    content: content.clone(),
                    timestamp,
                };
                // Broadcast to all peers including sender so they see their message
                state.sync_server.broadcast_to_project(&req_project_id, "", chat_msg);

                debug!(
                    "Chat message in {}: {} says {}",
                    req_project_id, peer.name, content
                );
            }
        }

        ClientMessage::VoiceJoin {
            project_id: req_project_id,
        } => {
            if state.voice_service.is_configured() {
                if let Some(peer) = state.sync_server.get_peer(peer_id) {
                    let peer = peer.read();
                    match state.voice_service.generate_token(
                        &req_project_id,
                        peer_id,
                        Some(&peer.name),
                        Some(VoicePermissions::full()),
                        None,
                    ) {
                        Ok(token) => {
                            let _ = tx.send(ServerMessage::VoiceToken {
                                project_id: req_project_id,
                                token: token.token,
                                room_name: token.room_name,
                                server_url: token.server_url,
                            });
                        }
                        Err(e) => {
                            warn!("Failed to generate voice token: {}", e);
                        }
                    }
                }
            } else {
                let _ = tx.send(ServerMessage::Error {
                    code: ErrorCode::ServerError,
                    message: "Voice chat is not configured".to_string(),
                    project_id: Some(req_project_id),
                });
            }
        }

        ClientMessage::VoiceLeave { .. } => {
            // Voice leave is handled client-side with LiveKit
        }

        ClientMessage::Ping { timestamp } => {
            let _ = tx.send(ServerMessage::Pong {
                timestamp,
                server_time: chrono::Utc::now().timestamp(),
            });
        }

        ClientMessage::Goodbye { reason } => {
            info!(
                "Peer {} saying goodbye: {:?}",
                peer_id,
                reason.unwrap_or_default()
            );
        }
    }
}

/// Handle legacy JSON message format for backward compatibility
async fn handle_legacy_json(
    text: &str,
    peer_id: &str,
    project_id: &str,
    state: &Arc<AppState>,
    tx: &mpsc::UnboundedSender<ServerMessage>,
) {
    #[derive(Deserialize)]
    struct LegacyMessage {
        #[serde(rename = "type")]
        msg_type: String,
        #[serde(flatten)]
        data: serde_json::Value,
    }

    if let Ok(msg) = serde_json::from_str::<LegacyMessage>(text) {
        match msg.msg_type.as_str() {
            "Join" => {
                // Extract user info
                if let Some(user) = msg.data.get("user") {
                    let name = user
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Anonymous");

                    // Update peer name
                    if let Some(peer) = state.sync_server.get_peer(peer_id) {
                        peer.write().name = name.to_string();
                    }

                    // Join the project
                    match state.sync_server.join_project(peer_id, project_id, true).await {
                        Ok(response) => {
                            // Send as JSON for legacy clients
                            let json = serde_json::json!({
                                "type": "RoomState",
                                "room_id": project_id,
                                "users": [],
                                "files": [],
                                "folder": null,
                                "cursors": [],
                                "chat_history": []
                            });
                            if let Ok(json_str) = serde_json::to_string(&json) {
                                // Would need to send via WebSocket directly
                            }
                        }
                        Err(e) => {
                            warn!("Legacy join failed: {}", e);
                        }
                    }
                }
            }
            "Ping" => {
                let _ = tx.send(ServerMessage::Pong {
                    timestamp: 0,
                    server_time: chrono::Utc::now().timestamp(),
                });
            }
            _ => {
                debug!("Unhandled legacy message type: {}", msg.msg_type);
            }
        }
    }
}

/// Send a server message over WebSocket
async fn send_server_message(
    sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    msg: &ServerMessage,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let bytes = SyncProtocol::encode_server(msg)?;
    sender.send(Message::Binary(bytes.to_vec())).await?;
    Ok(())
}

/// Generate a secure session token
fn generate_session_token() -> String {
    use sha2::{Digest, Sha256};
    let random_bytes: [u8; 32] = rand::random();
    let mut hasher = Sha256::new();
    hasher.update(&random_bytes);
    hasher.update(chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0).to_le_bytes());
    hex::encode(hasher.finalize())
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

#[tokio::main]
async fn main() {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "collab_server=info,tower_http=info".into()),
        )
        .init();

    // Load environment variables
    dotenvy::dotenv().ok();

    // Initialize storage
    let storage_path = std::env::var("STORAGE_PATH").unwrap_or_else(|_| "./data/collab.sled".to_string());

    info!("Initializing storage at: {}", storage_path);

    let storage_config = StorageConfig::new(&storage_path).with_compression(true);

    let storage = DocumentStore::open(storage_config).expect("Failed to open storage");

    info!("Storage initialized successfully");

    // Create application state
    let state = Arc::new(AppState::new(storage).await);

    // Start background tasks
    let sync_server = state.sync_server.clone();
    let _background_handles = sync_server.start_background_tasks();

    // Set up CORS
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers(Any);

    // Build router
    let app = Router::new()
        // Health check
        .route("/health", get(health_check))
        // Project management
        .route("/api/projects", get(list_projects).post(create_project))
        .route("/api/projects/:project_id", get(get_project))
        // Legacy room endpoints (for compatibility)
        .route("/api/rooms", get(list_projects).post(create_project))
        .route("/api/rooms/:project_id", get(get_project))
        // WebSocket endpoint
        .route("/ws/:project_id", get(ws_handler))
        // Add state and middleware
        .with_state(state)
        .layer(cors);

    // Start server
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(5000);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));

    info!("🚀 CodeCollab server v{} starting", env!("CARGO_PKG_VERSION"));
    info!("   Protocol version: {}", PROTOCOL_VERSION);
    info!("   Listening on: http://{}", addr);
    info!("   WebSocket: ws://{}/ws/:project_id", addr);
    info!("   Health check: http://{}/health", addr);

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("Failed to bind to address");

    axum::serve(listener, app).await.expect("Server error");
}
