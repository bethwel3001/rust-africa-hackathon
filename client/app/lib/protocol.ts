// ============================================================================
// BINARY PROTOCOL CODEC FOR AUTOMERGE SYNC
// ============================================================================
// This module mirrors the server's binary protocol (rustafrica/server/src/sync/protocol.rs)
// Messages are encoded with: [version:u8][type:u8][length:u24][payload:bincode]

// ============================================================================
// CONSTANTS
// ============================================================================

export const PROTOCOL_VERSION = 1;
export const MAX_MESSAGE_SIZE = 16 * 1024 * 1024; // 16MB

// ============================================================================
// MESSAGE TYPES (must match server's MessageType enum)
// ============================================================================

export enum MessageType {
  // Connection & Authentication
  Hello = 0x01,
  Welcome = 0x02,
  Goodbye = 0x03,
  Error = 0x04,

  // Automerge Sync (binary payloads)
  SyncRequest = 0x10,
  SyncMessage = 0x11,
  SyncComplete = 0x12,

  // Document Operations
  JoinProject = 0x20,
  LeaveProject = 0x21,
  ProjectJoined = 0x22,
  ProjectLeft = 0x23,

  // File Operations
  OpenFile = 0x30,
  CloseFile = 0x31,
  FileContent = 0x32,
  FileRequest = 0x33,

  // Presence & Cursors
  PresenceUpdate = 0x40,
  PresenceBroadcast = 0x41,
  CursorUpdate = 0x42,
  CursorBroadcast = 0x43,

  // Chat
  ChatMessage = 0x50,
  ChatHistory = 0x51,

  // Voice
  VoiceJoin = 0x60,
  VoiceLeave = 0x61,
  VoiceToken = 0x62,

  // Admin/Debug
  Ping = 0xf0,
  Pong = 0xf1,
  Stats = 0xf2,
}

// ============================================================================
// PRESENCE STATUS
// ============================================================================

export enum PresenceStatus {
  Active = "Active",
  Idle = "Idle",
  Away = "Away",
  Offline = "Offline",
}

// ============================================================================
// ERROR CODES
// ============================================================================

export enum ErrorCode {
  Unknown = 0,
  InvalidMessage = 1,
  Unauthorized = 2,
  ProjectNotFound = 3,
  FileNotFound = 4,
  RateLimited = 5,
  ServerError = 6,
  VersionMismatch = 7,
  ProjectFull = 8,
  AlreadyJoined = 9,
  NotJoined = 10,
}

// ============================================================================
// TYPE DEFINITIONS (matching server structs)
// ============================================================================

export interface PeerInfo {
  peer_id: string;
  name: string;
  color: string;
  status: PresenceStatus;
  active_file: string | null;
  joined_at: number;
}

export interface ChatHistoryItem {
  peer_id: string;
  peer_name: string;
  content: string;
  timestamp: number;
}

// ============================================================================
// CLIENT MESSAGES
// ============================================================================

// Shared file node structure for workspace sharing
export interface SharedFileNode {
  id: string;
  name: string;
  path: string;
  is_dir: boolean;
  children?: SharedFileNode[];
  extension?: string;
}

// Shared file content
export interface SharedFileContent {
  path: string;
  name: string;
  content: string;
  language: string;
}

export type ClientMessage =
  | {
      type: "Hello";
      protocol_version: number;
      client_id: string | null;
      client_name: string;
      session_token: string | null;
    }
  | {
      type: "Goodbye";
      reason: string | null;
    }
  | {
      type: "JoinProject";
      project_id: string;
      request_state: boolean;
    }
  | {
      type: "LeaveProject";
      project_id: string;
    }
  | {
      type: "SyncMessage";
      project_id: string;
      sync_data: Uint8Array;
    }
  | {
      type: "SyncRequest";
      project_id: string;
    }
  | {
      type: "OpenFile";
      project_id: string;
      file_path: string;
    }
  | {
      type: "CloseFile";
      project_id: string;
      file_path: string;
    }
  | {
      type: "CursorUpdate";
      project_id: string;
      file_path: string;
      line: number;
      column: number;
      selection_end: [number, number] | null;
    }
  | {
      type: "PresenceUpdate";
      project_id: string;
      status: PresenceStatus;
      active_file: string | null;
    }
  | {
      type: "ChatMessage";
      project_id: string;
      content: string;
    }
  | {
      type: "VoiceJoin";
      project_id: string;
    }
  | {
      type: "VoiceLeave";
      project_id: string;
    }
  | {
      type: "Ping";
      timestamp: number;
    }
  // Workspace sharing messages
  | {
      type: "ShareWorkspace";
      project_id: string;
      workspace_root: SharedFileNode;
      workspace_path: string;
    }
  | {
      type: "ShareFile";
      project_id: string;
      file: SharedFileContent;
      set_active: boolean;
    }
  | {
      type: "FileEdit";
      project_id: string;
      file_path: string;
      content: string;
    }
  | {
      type: "RequestWorkspace";
      project_id: string;
    };

// ============================================================================
// SERVER MESSAGES
// ============================================================================

export type ServerMessage =
  | {
      type: "Welcome";
      protocol_version: number;
      peer_id: string;
      color: string;
      session_token: string;
      server_time: number;
    }
  // Workspace sharing broadcasts
  | {
      type: "WorkspaceBroadcast";
      project_id: string;
      peer_id: string;
      peer_name: string;
      workspace_root: SharedFileNode;
      workspace_path: string;
    }
  | {
      type: "FileBroadcast";
      project_id: string;
      peer_id: string;
      peer_name: string;
      file: SharedFileContent;
      set_active: boolean;
    }
  | {
      type: "FileEditBroadcast";
      project_id: string;
      peer_id: string;
      file_path: string;
      content: string;
    }
  | {
      type: "Error";
      code: ErrorCode;
      message: string;
      project_id: string | null;
    }
  | {
      type: "Goodbye";
      reason: string | null;
    }
  | {
      type: "ProjectJoined";
      project_id: string;
      peers: PeerInfo[];
      document_state: Uint8Array | null;
    }
  | {
      type: "PeerJoined";
      project_id: string;
      peer: PeerInfo;
    }
  | {
      type: "ProjectLeft";
      project_id: string;
    }
  | {
      type: "PeerLeft";
      project_id: string;
      peer_id: string;
      reason: string | null;
    }
  | {
      type: "SyncMessage";
      project_id: string;
      sync_data: Uint8Array;
      from_peer: string | null;
    }
  | {
      type: "SyncComplete";
      project_id: string;
    }
  | {
      type: "FileContent";
      project_id: string;
      file_path: string;
      content: string;
      language: string;
      version: number;
    }
  | {
      type: "FileNotFound";
      project_id: string;
      file_path: string;
    }
  | {
      type: "CursorBroadcast";
      project_id: string;
      peer_id: string;
      peer_name: string;
      peer_color: string;
      file_path: string;
      line: number;
      column: number;
      selection_end: [number, number] | null;
    }
  | {
      type: "PresenceBroadcast";
      project_id: string;
      peer_id: string;
      peer_name: string;
      status: PresenceStatus;
      active_file: string | null;
      last_active: number;
    }
  | {
      type: "ChatBroadcast";
      project_id: string;
      peer_id: string;
      peer_name: string;
      content: string;
      timestamp: number;
    }
  | {
      type: "ChatHistory";
      project_id: string;
      messages: ChatHistoryItem[];
    }
  | {
      type: "VoiceToken";
      project_id: string;
      token: string;
      room_name: string;
      server_url: string;
    }
  | {
      type: "Pong";
      timestamp: number;
      server_time: number;
    }
  | {
      type: "Stats";
      active_projects: number;
      active_peers: number;
      uptime_seconds: number;
    };

// ============================================================================
// BINARY ENCODER/DECODER
// ============================================================================

/**
 * Simple bincode-compatible encoder for JavaScript.
 * Bincode uses little-endian encoding by default.
 */
export class BincodeEncoder {
  private buffer: number[] = [];

  writeU8(value: number): void {
    this.buffer.push(value & 0xff);
  }

  writeU16(value: number): void {
    this.buffer.push(value & 0xff);
    this.buffer.push((value >> 8) & 0xff);
  }

  writeU32(value: number): void {
    this.buffer.push(value & 0xff);
    this.buffer.push((value >> 8) & 0xff);
    this.buffer.push((value >> 16) & 0xff);
    this.buffer.push((value >> 24) & 0xff);
  }

  writeU64(value: number): void {
    // JavaScript can only safely handle 53-bit integers
    this.writeU32(value >>> 0);
    this.writeU32(Math.floor(value / 0x100000000));
  }

  writeI64(value: number): void {
    this.writeU64(value);
  }

  writeBool(value: boolean): void {
    this.writeU8(value ? 1 : 0);
  }

  writeString(value: string): void {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(value);
    this.writeU64(bytes.length);
    for (const byte of bytes) {
      this.buffer.push(byte);
    }
  }

  writeBytes(value: Uint8Array): void {
    this.writeU64(value.length);
    for (const byte of value) {
      this.buffer.push(byte);
    }
  }

  writeOption<T>(value: T | null, writer: (v: T) => void): void {
    if (value === null || value === undefined) {
      this.writeU8(0); // None
    } else {
      this.writeU8(1); // Some
      writer(value);
    }
  }

  writeVariant(index: number): void {
    this.writeU32(index);
  }

  toBytes(): Uint8Array {
    return new Uint8Array(this.buffer);
  }
}

/**
 * Simple bincode-compatible decoder for JavaScript.
 */
export class BincodeDecoder {
  private view: DataView;
  private offset: number = 0;

  constructor(data: ArrayBuffer | Uint8Array) {
    if (data instanceof Uint8Array) {
      this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    } else {
      this.view = new DataView(data);
    }
  }

  readU8(): number {
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  readU16(): number {
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  readU32(): number {
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readU64(): number {
    const low = this.readU32();
    const high = this.readU32();
    return high * 0x100000000 + low;
  }

  readI64(): number {
    return this.readU64();
  }

  readBool(): boolean {
    return this.readU8() !== 0;
  }

  readString(): string {
    const len = this.readU64();
    const bytes = new Uint8Array(
      this.view.buffer,
      this.view.byteOffset + this.offset,
      len,
    );
    this.offset += len;
    return new TextDecoder().decode(bytes);
  }

  readBytes(): Uint8Array {
    const len = this.readU64();
    const bytes = new Uint8Array(
      this.view.buffer,
      this.view.byteOffset + this.offset,
      len,
    );
    this.offset += len;
    return bytes.slice(); // Return a copy
  }

  readOption<T>(reader: () => T): T | null {
    const hasValue = this.readU8();
    if (hasValue === 0) {
      return null;
    }
    return reader();
  }

  readVariant(): number {
    return this.readU32();
  }

  remaining(): number {
    return this.view.byteLength - this.offset;
  }
}

// ============================================================================
// MESSAGE ENCODING
// ============================================================================

function getClientMessageType(msg: ClientMessage): MessageType {
  switch (msg.type) {
    case "Hello":
      return MessageType.Hello;
    case "Goodbye":
      return MessageType.Goodbye;
    case "JoinProject":
      return MessageType.JoinProject;
    case "LeaveProject":
      return MessageType.LeaveProject;
    case "SyncMessage":
      return MessageType.SyncMessage;
    case "SyncRequest":
      return MessageType.SyncRequest;
    case "OpenFile":
      return MessageType.OpenFile;
    case "CloseFile":
      return MessageType.CloseFile;
    case "CursorUpdate":
      return MessageType.CursorUpdate;
    case "PresenceUpdate":
      return MessageType.PresenceUpdate;
    case "ChatMessage":
      return MessageType.ChatMessage;
    case "VoiceJoin":
      return MessageType.VoiceJoin;
    case "VoiceLeave":
      return MessageType.VoiceLeave;
    case "Ping":
      return MessageType.Ping;
    default:
      throw new Error(
        `Unknown client message type: ${(msg as ClientMessage).type}`,
      );
  }
}

function encodeClientPayload(
  msg: ClientMessage,
  encoder: BincodeEncoder,
): void {
  switch (msg.type) {
    case "Hello":
      encoder.writeVariant(0);
      encoder.writeU8(msg.protocol_version);
      encoder.writeOption(msg.client_id, (v) => encoder.writeString(v));
      encoder.writeString(msg.client_name);
      encoder.writeOption(msg.session_token, (v) => encoder.writeString(v));
      break;

    case "Goodbye":
      encoder.writeVariant(1);
      encoder.writeOption(msg.reason, (v) => encoder.writeString(v));
      break;

    case "JoinProject":
      encoder.writeVariant(2);
      encoder.writeString(msg.project_id);
      encoder.writeBool(msg.request_state);
      break;

    case "LeaveProject":
      encoder.writeVariant(3);
      encoder.writeString(msg.project_id);
      break;

    case "SyncMessage":
      encoder.writeVariant(4);
      encoder.writeString(msg.project_id);
      encoder.writeBytes(msg.sync_data);
      break;

    case "SyncRequest":
      encoder.writeVariant(5);
      encoder.writeString(msg.project_id);
      break;

    case "OpenFile":
      encoder.writeVariant(6);
      encoder.writeString(msg.project_id);
      encoder.writeString(msg.file_path);
      break;

    case "CloseFile":
      encoder.writeVariant(7);
      encoder.writeString(msg.project_id);
      encoder.writeString(msg.file_path);
      break;

    case "CursorUpdate":
      encoder.writeVariant(8);
      encoder.writeString(msg.project_id);
      encoder.writeString(msg.file_path);
      encoder.writeU32(msg.line);
      encoder.writeU32(msg.column);
      encoder.writeOption(msg.selection_end, (v) => {
        encoder.writeU32(v[0]);
        encoder.writeU32(v[1]);
      });
      break;

    case "PresenceUpdate":
      encoder.writeVariant(9);
      encoder.writeString(msg.project_id);
      encodePresenceStatus(msg.status, encoder);
      encoder.writeOption(msg.active_file, (v) => encoder.writeString(v));
      break;

    case "ChatMessage":
      encoder.writeVariant(10);
      encoder.writeString(msg.project_id);
      encoder.writeString(msg.content);
      break;

    case "VoiceJoin":
      encoder.writeVariant(11);
      encoder.writeString(msg.project_id);
      break;

    case "VoiceLeave":
      encoder.writeVariant(12);
      encoder.writeString(msg.project_id);
      break;

    case "Ping":
      encoder.writeVariant(13);
      encoder.writeU64(msg.timestamp);
      break;
  }
}

function encodePresenceStatus(
  status: PresenceStatus,
  encoder: BincodeEncoder,
): void {
  switch (status) {
    case PresenceStatus.Active:
      encoder.writeVariant(0);
      break;
    case PresenceStatus.Idle:
      encoder.writeVariant(1);
      break;
    case PresenceStatus.Away:
      encoder.writeVariant(2);
      break;
    case PresenceStatus.Offline:
      encoder.writeVariant(3);
      break;
  }
}

function decodePresenceStatus(decoder: BincodeDecoder): PresenceStatus {
  const variant = decoder.readVariant();
  switch (variant) {
    case 0:
      return PresenceStatus.Active;
    case 1:
      return PresenceStatus.Idle;
    case 2:
      return PresenceStatus.Away;
    case 3:
      return PresenceStatus.Offline;
    default:
      return PresenceStatus.Active;
  }
}

function decodeErrorCode(decoder: BincodeDecoder): ErrorCode {
  const value = decoder.readU16();
  return value as ErrorCode;
}

function decodePeerInfo(decoder: BincodeDecoder): PeerInfo {
  return {
    peer_id: decoder.readString(),
    name: decoder.readString(),
    color: decoder.readString(),
    status: decodePresenceStatus(decoder),
    active_file: decoder.readOption(() => decoder.readString()),
    joined_at: decoder.readI64(),
  };
}

function decodeChatHistoryItem(decoder: BincodeDecoder): ChatHistoryItem {
  return {
    peer_id: decoder.readString(),
    peer_name: decoder.readString(),
    content: decoder.readString(),
    timestamp: decoder.readI64(),
  };
}

function decodeServerPayload(decoder: BincodeDecoder): ServerMessage {
  const variant = decoder.readVariant();

  switch (variant) {
    case 0: // Welcome
      return {
        type: "Welcome",
        protocol_version: decoder.readU8(),
        peer_id: decoder.readString(),
        color: decoder.readString(),
        session_token: decoder.readString(),
        server_time: decoder.readI64(),
      };

    case 1: // Error
      return {
        type: "Error",
        code: decodeErrorCode(decoder),
        message: decoder.readString(),
        project_id: decoder.readOption(() => decoder.readString()),
      };

    case 2: // Goodbye
      return {
        type: "Goodbye",
        reason: decoder.readOption(() => decoder.readString()),
      };

    case 3: // ProjectJoined
      return {
        type: "ProjectJoined",
        project_id: decoder.readString(),
        peers: decodeArray(decoder, () => decodePeerInfo(decoder)),
        document_state: decoder.readOption(() => decoder.readBytes()),
      };

    case 4: // PeerJoined
      return {
        type: "PeerJoined",
        project_id: decoder.readString(),
        peer: decodePeerInfo(decoder),
      };

    case 5: // ProjectLeft
      return {
        type: "ProjectLeft",
        project_id: decoder.readString(),
      };

    case 6: // PeerLeft
      return {
        type: "PeerLeft",
        project_id: decoder.readString(),
        peer_id: decoder.readString(),
        reason: decoder.readOption(() => decoder.readString()),
      };

    case 7: // SyncMessage
      return {
        type: "SyncMessage",
        project_id: decoder.readString(),
        sync_data: decoder.readBytes(),
        from_peer: decoder.readOption(() => decoder.readString()),
      };

    case 8: // SyncComplete
      return {
        type: "SyncComplete",
        project_id: decoder.readString(),
      };

    case 9: // FileContent
      return {
        type: "FileContent",
        project_id: decoder.readString(),
        file_path: decoder.readString(),
        content: decoder.readString(),
        language: decoder.readString(),
        version: decoder.readU64(),
      };

    case 10: // FileNotFound
      return {
        type: "FileNotFound",
        project_id: decoder.readString(),
        file_path: decoder.readString(),
      };

    case 11: // CursorBroadcast
      return {
        type: "CursorBroadcast",
        project_id: decoder.readString(),
        peer_id: decoder.readString(),
        peer_name: decoder.readString(),
        peer_color: decoder.readString(),
        file_path: decoder.readString(),
        line: decoder.readU32(),
        column: decoder.readU32(),
        selection_end: decoder.readOption(
          () => [decoder.readU32(), decoder.readU32()] as [number, number],
        ),
      };

    case 12: // PresenceBroadcast
      return {
        type: "PresenceBroadcast",
        project_id: decoder.readString(),
        peer_id: decoder.readString(),
        peer_name: decoder.readString(),
        status: decodePresenceStatus(decoder),
        active_file: decoder.readOption(() => decoder.readString()),
        last_active: decoder.readI64(),
      };

    case 13: // ChatBroadcast
      return {
        type: "ChatBroadcast",
        project_id: decoder.readString(),
        peer_id: decoder.readString(),
        peer_name: decoder.readString(),
        content: decoder.readString(),
        timestamp: decoder.readI64(),
      };

    case 14: // ChatHistory
      return {
        type: "ChatHistory",
        project_id: decoder.readString(),
        messages: decodeArray(decoder, () => decodeChatHistoryItem(decoder)),
      };

    case 15: // VoiceToken
      return {
        type: "VoiceToken",
        project_id: decoder.readString(),
        token: decoder.readString(),
        room_name: decoder.readString(),
        server_url: decoder.readString(),
      };

    case 16: // Pong
      return {
        type: "Pong",
        timestamp: decoder.readU64(),
        server_time: decoder.readI64(),
      };

    case 17: // Stats
      return {
        type: "Stats",
        active_projects: decoder.readU32(),
        active_peers: decoder.readU32(),
        uptime_seconds: decoder.readU64(),
      };

    default:
      throw new Error(`Unknown server message variant: ${variant}`);
  }
}

function decodeArray<T>(decoder: BincodeDecoder, readItem: () => T): T[] {
  const len = decoder.readU64();
  const items: T[] = [];
  for (let i = 0; i < len; i++) {
    items.push(readItem());
  }
  return items;
}

// ============================================================================
// PROTOCOL CODEC
// ============================================================================

export class SyncProtocol {
  /**
   * Encode a client message to binary format.
   * Format: [version:u8][type:u8][length:u24][payload]
   */
  static encodeClient(msg: ClientMessage): Uint8Array {
    const encoder = new BincodeEncoder();
    encodeClientPayload(msg, encoder);
    const payload = encoder.toBytes();

    if (payload.length + 5 > MAX_MESSAGE_SIZE) {
      throw new Error(
        `Message too large: ${payload.length + 5} bytes (max: ${MAX_MESSAGE_SIZE})`,
      );
    }

    const msgType = getClientMessageType(msg);
    const result = new Uint8Array(5 + payload.length);

    result[0] = PROTOCOL_VERSION;
    result[1] = msgType;
    // 24-bit length (big-endian for wire format, matching server's put_u24)
    result[2] = (payload.length >> 16) & 0xff;
    result[3] = (payload.length >> 8) & 0xff;
    result[4] = payload.length & 0xff;
    result.set(payload, 5);

    return result;
  }

  /**
   * Decode a server message from binary format.
   */
  static decodeServer(data: ArrayBuffer | Uint8Array): ServerMessage {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);

    if (bytes.length < 5) {
      throw new Error("Message too short");
    }

    const version = bytes[0];
    if (version !== PROTOCOL_VERSION) {
      throw new Error(
        `Version mismatch: expected ${PROTOCOL_VERSION}, got ${version}`,
      );
    }

    const _msgType = bytes[1];
    const payloadLen = (bytes[2] << 16) | (bytes[3] << 8) | bytes[4];

    if (bytes.length < 5 + payloadLen) {
      throw new Error(`Expected ${5 + payloadLen} bytes, got ${bytes.length}`);
    }

    const payload = bytes.slice(5, 5 + payloadLen);
    const decoder = new BincodeDecoder(payload);
    return decodeServerPayload(decoder);
  }

  /**
   * Create a Hello message for initial handshake.
   */
  static createHello(
    clientName: string,
    clientId?: string,
    sessionToken?: string,
  ): Uint8Array {
    return this.encodeClient({
      type: "Hello",
      protocol_version: PROTOCOL_VERSION,
      client_id: clientId ?? null,
      client_name: clientName,
      session_token: sessionToken ?? null,
    });
  }

  /**
   * Create a JoinProject message.
   */
  static createJoinProject(projectId: string, requestState = true): Uint8Array {
    return this.encodeClient({
      type: "JoinProject",
      project_id: projectId,
      request_state: requestState,
    });
  }

  /**
   * Create a LeaveProject message.
   */
  static createLeaveProject(projectId: string): Uint8Array {
    return this.encodeClient({
      type: "LeaveProject",
      project_id: projectId,
    });
  }

  /**
   * Create an Automerge SyncMessage.
   */
  static createSyncMessage(
    projectId: string,
    syncData: Uint8Array,
  ): Uint8Array {
    return this.encodeClient({
      type: "SyncMessage",
      project_id: projectId,
      sync_data: syncData,
    });
  }

  /**
   * Create a SyncRequest message.
   */
  static createSyncRequest(projectId: string): Uint8Array {
    return this.encodeClient({
      type: "SyncRequest",
      project_id: projectId,
    });
  }

  /**
   * Create an OpenFile message.
   */
  static createOpenFile(projectId: string, filePath: string): Uint8Array {
    return this.encodeClient({
      type: "OpenFile",
      project_id: projectId,
      file_path: filePath,
    });
  }

  /**
   * Create a CloseFile message.
   */
  static createCloseFile(projectId: string, filePath: string): Uint8Array {
    return this.encodeClient({
      type: "CloseFile",
      project_id: projectId,
      file_path: filePath,
    });
  }

  /**
   * Create a CursorUpdate message.
   */
  static createCursorUpdate(
    projectId: string,
    filePath: string,
    line: number,
    column: number,
    selectionEnd?: [number, number],
  ): Uint8Array {
    return this.encodeClient({
      type: "CursorUpdate",
      project_id: projectId,
      file_path: filePath,
      line,
      column,
      selection_end: selectionEnd ?? null,
    });
  }

  /**
   * Create a PresenceUpdate message.
   */
  static createPresenceUpdate(
    projectId: string,
    status: PresenceStatus,
    activeFile?: string,
  ): Uint8Array {
    return this.encodeClient({
      type: "PresenceUpdate",
      project_id: projectId,
      status,
      active_file: activeFile ?? null,
    });
  }

  /**
   * Create a ChatMessage.
   */
  static createChatMessage(projectId: string, content: string): Uint8Array {
    return this.encodeClient({
      type: "ChatMessage",
      project_id: projectId,
      content,
    });
  }

  /**
   * Create a VoiceJoin message.
   */
  static createVoiceJoin(projectId: string): Uint8Array {
    return this.encodeClient({
      type: "VoiceJoin",
      project_id: projectId,
    });
  }

  /**
   * Create a VoiceLeave message.
   */
  static createVoiceLeave(projectId: string): Uint8Array {
    return this.encodeClient({
      type: "VoiceLeave",
      project_id: projectId,
    });
  }

  /**
   * Create a Ping message for keepalive.
   */
  static createPing(): Uint8Array {
    return this.encodeClient({
      type: "Ping",
      timestamp: Date.now(),
    });
  }

  /**
   * Create a Goodbye message.
   */
  static createGoodbye(reason?: string): Uint8Array {
    return this.encodeClient({
      type: "Goodbye",
      reason: reason ?? null,
    });
  }
}

export default SyncProtocol;
