#!/bin/bash

# ============================================================================
# CodeCollab Server Test Script
# ============================================================================
# Usage: ./tests/test_server.sh
# Prerequisites: Server must be running on localhost:5000
# ============================================================================

set -e

SERVER_URL="http://localhost:5000"
WS_URL="ws://localhost:5000"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters
PASSED=0
FAILED=0

# ============================================================================
# Utility Functions
# ============================================================================

print_header() {
    echo ""
    echo "============================================================"
    echo "  $1"
    echo "============================================================"
    echo ""
}

print_test() {
    echo -e "${BLUE}[TEST]${NC} $1"
}

print_pass() {
    echo -e "${GREEN}[PASS]${NC} $1"
    ((PASSED++))
}

print_fail() {
    echo -e "${RED}[FAIL]${NC} $1"
    ((FAILED++))
}

print_info() {
    echo -e "${YELLOW}[INFO]${NC} $1"
}

# ============================================================================
# Test Functions
# ============================================================================

test_health_check() {
    print_test "Health Check"

    response=$(curl -s -w "\n%{http_code}" "$SERVER_URL/health")
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')

    if [ "$http_code" = "200" ]; then
        status=$(echo "$body" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
        if [ "$status" = "healthy" ]; then
            print_pass "Server is healthy"
            print_info "Response: $body"
            return 0
        else
            print_fail "Server status is not healthy: $status"
            return 1
        fi
    else
        print_fail "Health check returned HTTP $http_code"
        return 1
    fi
}

test_create_room() {
    print_test "Create Room"

    response=$(curl -s -w "\n%{http_code}" -X POST \
        -H "Content-Type: application/json" \
        -d '{"name": "Test Room"}' \
        "$SERVER_URL/api/rooms")

    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')

    if [ "$http_code" = "200" ]; then
        ROOM_ID=$(echo "$body" | grep -o '"room_id":"[^"]*"' | cut -d'"' -f4)
        if [ -n "$ROOM_ID" ]; then
            print_pass "Room created with ID: $ROOM_ID"
            print_info "Response: $body"
            echo "$ROOM_ID"
            return 0
        else
            print_fail "Room ID not found in response"
            return 1
        fi
    else
        print_fail "Create room returned HTTP $http_code"
        print_info "Response: $body"
        return 1
    fi
}

test_list_rooms() {
    print_test "List Rooms"

    response=$(curl -s -w "\n%{http_code}" "$SERVER_URL/api/rooms")
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')

    if [ "$http_code" = "200" ]; then
        print_pass "List rooms successful"
        print_info "Response: $body"
        return 0
    else
        print_fail "List rooms returned HTTP $http_code"
        return 1
    fi
}

test_get_room() {
    local room_id=$1
    print_test "Get Room Details (ID: $room_id)"

    response=$(curl -s -w "\n%{http_code}" "$SERVER_URL/api/rooms/$room_id")
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')

    if [ "$http_code" = "200" ]; then
        print_pass "Get room successful"
        print_info "Response: $body"
        return 0
    else
        print_fail "Get room returned HTTP $http_code"
        return 1
    fi
}

test_get_nonexistent_room() {
    print_test "Get Non-existent Room"

    response=$(curl -s -w "\n%{http_code}" "$SERVER_URL/api/rooms/nonexistent-room-id")
    http_code=$(echo "$response" | tail -n1)

    if [ "$http_code" = "404" ]; then
        print_pass "Correctly returned 404 for non-existent room"
        return 0
    else
        print_fail "Expected 404, got HTTP $http_code"
        return 1
    fi
}

test_api_proxy_get() {
    print_test "API Proxy - GET Request"

    response=$(curl -s -w "\n%{http_code}" -X POST \
        -H "Content-Type: application/json" \
        -d '{
            "url": "https://jsonplaceholder.typicode.com/posts/1",
            "method": "GET",
            "headers": null,
            "body": null
        }' \
        "$SERVER_URL/api/proxy")

    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')

    if [ "$http_code" = "200" ]; then
        proxy_status=$(echo "$body" | grep -o '"status":[0-9]*' | cut -d':' -f2)
        if [ "$proxy_status" = "200" ]; then
            print_pass "API proxy GET successful"
            time_ms=$(echo "$body" | grep -o '"time_ms":[0-9]*' | cut -d':' -f2)
            print_info "Proxy response time: ${time_ms}ms"
            return 0
        else
            print_fail "Proxy returned status $proxy_status"
            return 1
        fi
    else
        print_fail "API proxy returned HTTP $http_code"
        return 1
    fi
}

test_api_proxy_post() {
    print_test "API Proxy - POST Request with Body"

    response=$(curl -s -w "\n%{http_code}" -X POST \
        -H "Content-Type: application/json" \
        -d '{
            "url": "https://jsonplaceholder.typicode.com/posts",
            "method": "POST",
            "headers": {"Content-Type": "application/json"},
            "body": "{\"title\": \"Test\", \"body\": \"Test body\", \"userId\": 1}"
        }' \
        "$SERVER_URL/api/proxy")

    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')

    if [ "$http_code" = "200" ]; then
        proxy_status=$(echo "$body" | grep -o '"status":[0-9]*' | cut -d':' -f2)
        if [ "$proxy_status" = "201" ]; then
            print_pass "API proxy POST successful"
            return 0
        else
            print_fail "Proxy returned status $proxy_status (expected 201)"
            print_info "Response: $body"
            return 1
        fi
    else
        print_fail "API proxy returned HTTP $http_code"
        return 1
    fi
}

test_cors_headers() {
    print_test "CORS Headers"

    response=$(curl -s -I -H "Origin: http://localhost:3000" "$SERVER_URL/health")

    if echo "$response" | grep -qi "access-control-allow-origin"; then
        print_pass "CORS headers present"
        cors_header=$(echo "$response" | grep -i "access-control-allow-origin" | head -1)
        print_info "$cors_header"
        return 0
    else
        print_fail "CORS headers not found"
        print_info "Response headers: $response"
        return 1
    fi
}

test_websocket_endpoint() {
    print_test "WebSocket Endpoint Availability"

    # Check if the endpoint responds to HTTP upgrade
    # Note: This doesn't fully test WebSocket, just that the endpoint exists
    response=$(curl -s -w "\n%{http_code}" \
        -H "Upgrade: websocket" \
        -H "Connection: Upgrade" \
        -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
        -H "Sec-WebSocket-Version: 13" \
        "$SERVER_URL/ws/test-room")

    http_code=$(echo "$response" | tail -n1)

    # WebSocket upgrade should return 101, but curl can't complete the handshake
    # so we accept other responses that indicate the endpoint exists
    if [ "$http_code" != "404" ]; then
        print_pass "WebSocket endpoint exists"
        return 0
    else
        print_fail "WebSocket endpoint not found"
        return 1
    fi
}

# ============================================================================
# Main Test Runner
# ============================================================================

main() {
    print_header "CodeCollab Server Tests"

    print_info "Server URL: $SERVER_URL"
    print_info "WebSocket URL: $WS_URL"
    echo ""

    # Check if server is running
    if ! curl -s --connect-timeout 2 "$SERVER_URL/health" > /dev/null 2>&1; then
        print_fail "Server is not running at $SERVER_URL"
        echo ""
        echo "Please start the server first:"
        echo "  cd server && cargo run"
        echo ""
        exit 1
    fi

    # Run tests
    test_health_check || true
    test_cors_headers || true

    ROOM_ID=$(test_create_room) || true

    test_list_rooms || true

    if [ -n "$ROOM_ID" ] && [ ${#ROOM_ID} -gt 0 ]; then
        test_get_room "$ROOM_ID" || true
    fi

    test_get_nonexistent_room || true
    test_websocket_endpoint || true
    test_api_proxy_get || true
    test_api_proxy_post || true

    # Print summary
    print_header "Test Summary"

    TOTAL=$((PASSED + FAILED))

    echo -e "Total:  ${TOTAL}"
    echo -e "${GREEN}Passed: ${PASSED}${NC}"
    echo -e "${RED}Failed: ${FAILED}${NC}"
    echo ""

    if [ $FAILED -gt 0 ]; then
        echo -e "${RED}Some tests failed!${NC}"
        exit 1
    else
        echo -e "${GREEN}All tests passed!${NC}"
        exit 0
    fi
}

# Run main
main "$@"
