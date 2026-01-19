/**
 * CodeCollab - Collaboration Feature Tests
 *
 * This file contains tests for verifying all collaboration features
 * Run with: npx ts-node tests/collaboration_test.ts
 *
 * Prerequisites:
 * 1. Start the server: cd server && cargo run
 * 2. The server should be running on http://localhost:5000
 */

// ============================================================================
// TEST CONFIGURATION
// ============================================================================

const SERVER_URL = "http://localhost:5000";
const WS_URL = "ws://localhost:5000";

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  duration: number;
}

const results: TestResult[] = [];

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(message: string, type: "info" | "success" | "error" | "warn" = "info") {
  const colors = {
    info: "\x1b[36m",
    success: "\x1b[32m",
    error: "\x1b[31m",
    warn: "\x1b[33m",
  };
  const reset = "\x1b[0m";
  console.log(`${colors[type]}[${type.toUpperCase()}]${reset} ${message}`);
}

async function runTest(
  name: string,
  testFn: () => Promise<void>
): Promise<TestResult> {
  const start = Date.now();
  try {
    await testFn();
    const duration = Date.now() - start;
    log(`✓ ${name} (${duration}ms)`, "success");
    return { name, passed: true, message: "Passed", duration };
  } catch (error) {
    const duration = Date.now() - start;
    const message = error instanceof Error ? error.message : String(error);
    log(`✗ ${name}: ${message}`, "error");
    return { name, passed: false, message, duration };
  }
}

// ============================================================================
// TEST: SERVER HEALTH CHECK
// ============================================================================

async function testServerHealth(): Promise<void> {
  const response = await fetch(`${SERVER_URL}/health`);

  if (!response.ok) {
    throw new Error(`Health check failed with status ${response.status}`);
  }

  const data = await response.json();

  if (data.status !== "healthy") {
    throw new Error(`Server status is not healthy: ${data.status}`);
  }

  if (data.service !== "collab-server") {
    throw new Error(`Unexpected service name: ${data.service}`);
  }

  log(`Server version: ${data.version}`, "info");
}

// ============================================================================
// TEST: CREATE ROOM
// ============================================================================

async function testCreateRoom(): Promise<string> {
  const response = await fetch(`${SERVER_URL}/api/rooms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: "Test Room" }),
  });

  if (!response.ok) {
    throw new Error(`Create room failed with status ${response.status}`);
  }

  const data = await response.json();

  if (!data.room_id) {
    throw new Error("Room ID not returned");
  }

  if (!data.room_name) {
    throw new Error("Room name not returned");
  }

  log(`Created room: ${data.room_id} (${data.room_name})`, "info");
  return data.room_id;
}

// ============================================================================
// TEST: LIST ROOMS
// ============================================================================

async function testListRooms(expectedRoomId: string): Promise<void> {
  const response = await fetch(`${SERVER_URL}/api/rooms`);

  if (!response.ok) {
    throw new Error(`List rooms failed with status ${response.status}`);
  }

  const data = await response.json();

  if (!Array.isArray(data)) {
    throw new Error("Expected array of rooms");
  }

  const room = data.find((r: any) => r.id === expectedRoomId);
  if (!room) {
    throw new Error(`Room ${expectedRoomId} not found in list`);
  }

  log(`Found ${data.length} room(s)`, "info");
}

// ============================================================================
// TEST: GET ROOM DETAILS
// ============================================================================

async function testGetRoom(roomId: string): Promise<void> {
  const response = await fetch(`${SERVER_URL}/api/rooms/${roomId}`);

  if (!response.ok) {
    throw new Error(`Get room failed with status ${response.status}`);
  }

  const data = await response.json();

  if (data.id !== roomId) {
    throw new Error(`Room ID mismatch: ${data.id} !== ${roomId}`);
  }

  log(`Room details: ${JSON.stringify(data)}`, "info");
}

// ============================================================================
// TEST: WEBSOCKET CONNECTION
// ============================================================================

async function testWebSocketConnection(roomId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_URL}/ws/${roomId}`);
    let welcomeReceived = false;
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("WebSocket connection timeout"));
    }, 10000);

    ws.onopen = () => {
      log("WebSocket connected", "info");
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        log(`Received: ${message.type}`, "info");

        if (message.type === "Welcome") {
          welcomeReceived = true;
          log(`Assigned user ID: ${message.user_id}`, "info");
          log(`Assigned color: ${message.color}`, "info");

          // Send join message
          ws.send(
            JSON.stringify({
              type: "Join",
              room_id: roomId,
              user: {
                id: message.user_id,
                name: "Test User",
                color: message.color,
              },
            })
          );
        }

        if (message.type === "RoomState") {
          log(`Room has ${message.users.length} user(s)`, "info");
          clearTimeout(timeout);
          ws.close();
          resolve();
        }
      } catch (e) {
        log(`Failed to parse message: ${event.data}`, "warn");
      }
    };

    ws.onerror = (error) => {
      clearTimeout(timeout);
      reject(new Error("WebSocket error"));
    };

    ws.onclose = () => {
      if (!welcomeReceived) {
        clearTimeout(timeout);
        reject(new Error("WebSocket closed before Welcome message"));
      }
    };
  });
}

// ============================================================================
// TEST: CURSOR UPDATES
// ============================================================================

async function testCursorUpdates(roomId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_URL}/ws/${roomId}`);
    let userId: string;
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("Cursor update timeout"));
    }, 10000);

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        if (message.type === "Welcome") {
          userId = message.user_id;
          ws.send(
            JSON.stringify({
              type: "Join",
              room_id: roomId,
              user: {
                id: userId,
                name: "Cursor Test User",
                color: message.color,
              },
            })
          );
        }

        if (message.type === "RoomState") {
          // Send a cursor update
          ws.send(
            JSON.stringify({
              type: "CursorMove",
              position: {
                user_id: userId,
                file_id: "test-file.ts",
                line: 10,
                column: 5,
              },
            })
          );
        }

        if (message.type === "CursorUpdate") {
          log(`Cursor update received for user ${message.user_id}`, "info");
          clearTimeout(timeout);
          ws.close();
          resolve();
        }
      } catch (e) {
        // Ignore parse errors
      }
    };

    ws.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("WebSocket error during cursor test"));
    };
  });
}

// ============================================================================
// TEST: FILE CHANGE SYNC
// ============================================================================

async function testFileChangeSync(roomId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_URL}/ws/${roomId}`);
    let userId: string;
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("File sync timeout"));
    }, 10000);

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        if (message.type === "Welcome") {
          userId = message.user_id;
          ws.send(
            JSON.stringify({
              type: "Join",
              room_id: roomId,
              user: {
                id: userId,
                name: "File Sync Test User",
                color: message.color,
              },
            })
          );
        }

        if (message.type === "RoomState") {
          // Send a file change
          ws.send(
            JSON.stringify({
              type: "FileChange",
              change: {
                file_id: "test-file.ts",
                user_id: userId,
                content: 'console.log("Hello, World!");',
                version: 1,
                timestamp: Date.now(),
              },
            })
          );
        }

        if (message.type === "FileSynced") {
          log(`File synced: ${message.file_id} (v${message.version})`, "info");
          clearTimeout(timeout);
          ws.close();
          resolve();
        }
      } catch (e) {
        // Ignore parse errors
      }
    };

    ws.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("WebSocket error during file sync test"));
    };
  });
}

// ============================================================================
// TEST: CHAT MESSAGES
// ============================================================================

async function testChatMessages(roomId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_URL}/ws/${roomId}`);
    let userId: string;
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("Chat message timeout"));
    }, 10000);

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        if (message.type === "Welcome") {
          userId = message.user_id;
          ws.send(
            JSON.stringify({
              type: "Join",
              room_id: roomId,
              user: {
                id: userId,
                name: "Chat Test User",
                color: message.color,
              },
            })
          );
        }

        if (message.type === "RoomState") {
          // Send a chat message
          ws.send(
            JSON.stringify({
              type: "ChatMessage",
              user_id: userId,
              user_name: "Chat Test User",
              message: "Hello from the test!",
              timestamp: Date.now(),
            })
          );
        }

        if (message.type === "ChatMessage") {
          log(`Chat message received: "${message.message}"`, "info");
          clearTimeout(timeout);
          ws.close();
          resolve();
        }
      } catch (e) {
        // Ignore parse errors
      }
    };

    ws.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("WebSocket error during chat test"));
    };
  });
}

// ============================================================================
// TEST: API PROXY
// ============================================================================

async function testApiProxy(): Promise<void> {
  const response = await fetch(`${SERVER_URL}/api/proxy`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url: "https://jsonplaceholder.typicode.com/posts/1",
      method: "GET",
      headers: null,
      body: null,
    }),
  });

  if (!response.ok) {
    throw new Error(`API proxy failed with status ${response.status}`);
  }

  const data = await response.json();

  if (!data.status || data.status !== 200) {
    throw new Error(`Proxy returned status ${data.status}`);
  }

  log(`Proxy response time: ${data.time_ms}ms`, "info");
}

// ============================================================================
// TEST: API PROXY WITH POST BODY
// ============================================================================

async function testApiProxyWithBody(): Promise<void> {
  const testBody = JSON.stringify({
    title: "Test Post",
    body: "This is a test post body",
    userId: 1,
  });

  const response = await fetch(`${SERVER_URL}/api/proxy`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url: "https://jsonplaceholder.typicode.com/posts",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: testBody,
    }),
  });

  if (!response.ok) {
    throw new Error(`API proxy POST failed with status ${response.status}`);
  }

  const data = await response.json();

  if (data.status !== 201) {
    throw new Error(`Expected status 201, got ${data.status}`);
  }

  const responseBody = JSON.parse(data.body);
  if (!responseBody.id) {
    throw new Error("POST response missing ID");
  }

  log(`Created post with ID: ${responseBody.id}`, "info");
}

// ============================================================================
// TEST: MULTI-USER SIMULATION
// ============================================================================

async function testMultiUserCollaboration(roomId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const users: WebSocket[] = [];
    const joinedUsers: Set<string> = new Set();
    const userCount = 3;

    const timeout = setTimeout(() => {
      users.forEach((ws) => ws.close());
      reject(new Error("Multi-user test timeout"));
    }, 15000);

    for (let i = 0; i < userCount; i++) {
      const ws = new WebSocket(`${WS_URL}/ws/${roomId}`);
      users.push(ws);

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          if (message.type === "Welcome") {
            ws.send(
              JSON.stringify({
                type: "Join",
                room_id: roomId,
                user: {
                  id: message.user_id,
                  name: `User ${i + 1}`,
                  color: message.color,
                },
              })
            );
          }

          if (message.type === "UserJoined") {
            joinedUsers.add(message.user.id);
            log(`User joined: ${message.user.name} (${joinedUsers.size}/${userCount})`, "info");

            if (joinedUsers.size >= userCount) {
              clearTimeout(timeout);
              users.forEach((ws) => ws.close());
              resolve();
            }
          }
        } catch (e) {
          // Ignore parse errors
        }
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        users.forEach((ws) => ws.close());
        reject(new Error(`WebSocket error for user ${i + 1}`));
      };
    }
  });
}

// ============================================================================
// MAIN TEST RUNNER
// ============================================================================

async function runAllTests() {
  console.log("\n" + "=".repeat(60));
  console.log("  CodeCollab - Collaboration Feature Tests");
  console.log("=".repeat(60) + "\n");

  log(`Server URL: ${SERVER_URL}`, "info");
  log(`WebSocket URL: ${WS_URL}`, "info");
  console.log();

  // Run tests
  results.push(await runTest("Server Health Check", testServerHealth));

  let roomId: string | null = null;

  try {
    roomId = await testCreateRoom();
    results.push({
      name: "Create Room",
      passed: true,
      message: `Room ID: ${roomId}`,
      duration: 0,
    });
  } catch (error) {
    results.push({
      name: "Create Room",
      passed: false,
      message: error instanceof Error ? error.message : String(error),
      duration: 0,
    });
  }

  if (roomId) {
    results.push(await runTest("List Rooms", () => testListRooms(roomId!)));
    results.push(await runTest("Get Room Details", () => testGetRoom(roomId!)));
    results.push(await runTest("WebSocket Connection", () => testWebSocketConnection(roomId!)));
    results.push(await runTest("Cursor Updates", () => testCursorUpdates(roomId!)));
    results.push(await runTest("File Change Sync", () => testFileChangeSync(roomId!)));
    results.push(await runTest("Chat Messages", () => testChatMessages(roomId!)));
    results.push(await runTest("Multi-User Collaboration", () => testMultiUserCollaboration(roomId!)));
  }

  results.push(await runTest("API Proxy (GET)", testApiProxy));
  results.push(await runTest("API Proxy (POST with body)", testApiProxyWithBody));

  // Print summary
  console.log("\n" + "=".repeat(60));
  console.log("  Test Summary");
  console.log("=".repeat(60) + "\n");

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const total = results.length;

  results.forEach((r) => {
    const status = r.passed ? "✓" : "✗";
    const color = r.passed ? "\x1b[32m" : "\x1b[31m";
    console.log(`${color}${status}\x1b[0m ${r.name}`);
    if (!r.passed) {
      console.log(`  └─ ${r.message}`);
    }
  });

  console.log();
  console.log(`Total: ${total} | Passed: ${passed} | Failed: ${failed}`);
  console.log();

  if (failed > 0) {
    log("Some tests failed!", "error");
    process.exit(1);
  } else {
    log("All tests passed!", "success");
    process.exit(0);
  }
}

// Run if executed directly
if (typeof require !== "undefined" && require.main === module) {
  runAllTests().catch((error) => {
    log(`Test runner error: ${error.message}`, "error");
    process.exit(1);
  });
}

export {
  testServerHealth,
  testCreateRoom,
  testListRooms,
  testGetRoom,
  testWebSocketConnection,
  testCursorUpdates,
  testFileChangeSync,
  testChatMessages,
  testApiProxy,
  testApiProxyWithBody,
  testMultiUserCollaboration,
  runAllTests,
};
