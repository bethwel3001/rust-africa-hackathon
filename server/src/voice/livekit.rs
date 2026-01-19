//! LiveKit service for JWT token generation.
//!
//! This module provides JWT token generation for LiveKit voice chat rooms.
//! Tokens are used to authenticate participants when joining voice rooms.

use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;

use super::VoicePermissions;

/// Errors that can occur during token operations
#[derive(Error, Debug)]
pub enum TokenError {
    #[error("JWT encoding error: {0}")]
    JwtError(#[from] jsonwebtoken::errors::Error),

    #[error("Invalid configuration: {0}")]
    InvalidConfig(String),

    #[error("Token expired")]
    Expired,

    #[error("Missing API credentials")]
    MissingCredentials,
}

/// Configuration for LiveKit service
#[derive(Debug, Clone)]
pub struct LiveKitConfig {
    /// LiveKit API key
    pub api_key: String,
    /// LiveKit API secret
    pub api_secret: String,
    /// LiveKit server URL
    pub server_url: String,
    /// Default token TTL in seconds
    pub token_ttl_seconds: u64,
}

impl LiveKitConfig {
    /// Create a new config with required credentials
    pub fn new(
        api_key: impl Into<String>,
        api_secret: impl Into<String>,
        server_url: impl Into<String>,
    ) -> Self {
        Self {
            api_key: api_key.into(),
            api_secret: api_secret.into(),
            server_url: server_url.into(),
            token_ttl_seconds: 6 * 60 * 60, // 6 hours default
        }
    }

    /// Create from environment variables
    pub fn from_env() -> Result<Self, TokenError> {
        let api_key = std::env::var("LIVEKIT_API_KEY")
            .map_err(|_| TokenError::MissingCredentials)?;
        let api_secret = std::env::var("LIVEKIT_API_SECRET")
            .map_err(|_| TokenError::MissingCredentials)?;
        let server_url = std::env::var("LIVEKIT_URL")
            .unwrap_or_else(|_| "wss://localhost:7880".to_string());

        Ok(Self::new(api_key, api_secret, server_url))
    }

    /// Set token TTL
    pub fn with_ttl(mut self, seconds: u64) -> Self {
        self.token_ttl_seconds = seconds;
        self
    }

    /// Validate the configuration
    pub fn validate(&self) -> Result<(), TokenError> {
        if self.api_key.is_empty() {
            return Err(TokenError::InvalidConfig("API key is empty".to_string()));
        }
        if self.api_secret.is_empty() {
            return Err(TokenError::InvalidConfig("API secret is empty".to_string()));
        }
        if self.server_url.is_empty() {
            return Err(TokenError::InvalidConfig("Server URL is empty".to_string()));
        }
        Ok(())
    }
}

impl Default for LiveKitConfig {
    fn default() -> Self {
        Self {
            api_key: String::new(),
            api_secret: String::new(),
            server_url: "wss://localhost:7880".to_string(),
            token_ttl_seconds: 6 * 60 * 60,
        }
    }
}

/// LiveKit access token claims
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccessTokenClaims {
    /// Issuer (API key)
    pub iss: String,
    /// Subject (participant identity)
    pub sub: String,
    /// Issued at timestamp
    pub iat: u64,
    /// Expiration timestamp
    pub exp: u64,
    /// Not before timestamp
    pub nbf: u64,
    /// JWT ID
    pub jti: String,
    /// Video grant (room permissions)
    pub video: VideoGrant,
    /// Participant name
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Participant metadata
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<String>,
}

/// Video/room grant for LiveKit
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoGrant {
    /// Room name to join
    pub room: String,
    /// Can join the room
    pub room_join: bool,
    /// Can publish tracks
    pub can_publish: bool,
    /// Can subscribe to tracks
    pub can_subscribe: bool,
    /// Can publish data messages
    pub can_publish_data: bool,
    /// Can update own metadata
    #[serde(skip_serializing_if = "Option::is_none")]
    pub can_update_own_metadata: Option<bool>,
    /// Hidden participant (not shown in participant list)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hidden: Option<bool>,
    /// Recorder participant
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recorder: Option<bool>,
}

impl VideoGrant {
    /// Create a new video grant for a room
    pub fn new(room: impl Into<String>) -> Self {
        Self {
            room: room.into(),
            room_join: true,
            can_publish: true,
            can_subscribe: true,
            can_publish_data: true,
            can_update_own_metadata: Some(true),
            hidden: None,
            recorder: None,
        }
    }

    /// Apply permissions to the grant
    pub fn with_permissions(mut self, permissions: VoicePermissions) -> Self {
        self.can_publish = permissions.can_publish;
        self.can_subscribe = permissions.can_subscribe;
        self.can_publish_data = permissions.can_publish_data;
        self
    }

    /// Set as hidden participant
    pub fn hidden(mut self) -> Self {
        self.hidden = Some(true);
        self
    }

    /// Set as recorder participant
    pub fn recorder(mut self) -> Self {
        self.recorder = Some(true);
        self.hidden = Some(true);
        self
    }
}

/// Generated voice token with metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoiceToken {
    /// The JWT token string
    pub token: String,
    /// Room name
    pub room_name: String,
    /// Participant identity
    pub identity: String,
    /// Server URL to connect to
    pub server_url: String,
    /// Token expiration timestamp
    pub expires_at: u64,
}

/// LiveKit service for token generation
pub struct LiveKitService {
    config: LiveKitConfig,
}

impl LiveKitService {
    /// Create a new LiveKit service
    pub fn new(config: LiveKitConfig) -> Result<Self, TokenError> {
        config.validate()?;
        Ok(Self { config })
    }

    /// Create with default/empty config (tokens will fail without proper config)
    pub fn unconfigured() -> Self {
        Self {
            config: LiveKitConfig::default(),
        }
    }

    /// Check if the service is properly configured
    pub fn is_configured(&self) -> bool {
        self.config.validate().is_ok()
    }

    /// Get the server URL
    pub fn server_url(&self) -> &str {
        &self.config.server_url
    }

    /// Generate an access token for a participant
    pub fn generate_token(
        &self,
        room_name: &str,
        participant_identity: &str,
        participant_name: Option<&str>,
        permissions: Option<VoicePermissions>,
        ttl_seconds: Option<u64>,
    ) -> Result<VoiceToken, TokenError> {
        self.config.validate()?;

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();

        let ttl = ttl_seconds.unwrap_or(self.config.token_ttl_seconds);
        let exp = now + ttl;

        // Create video grant with permissions
        let mut grant = VideoGrant::new(room_name);
        if let Some(perms) = permissions {
            grant = grant.with_permissions(perms);
        }

        // Create claims
        let claims = AccessTokenClaims {
            iss: self.config.api_key.clone(),
            sub: participant_identity.to_string(),
            iat: now,
            exp,
            nbf: now,
            jti: uuid::Uuid::new_v4().to_string(),
            video: grant,
            name: participant_name.map(|s| s.to_string()),
            metadata: None,
        };

        // Encode the token
        let header = Header::new(Algorithm::HS256);
        let key = EncodingKey::from_secret(self.config.api_secret.as_bytes());
        let token = encode(&header, &claims, &key)?;

        Ok(VoiceToken {
            token,
            room_name: room_name.to_string(),
            identity: participant_identity.to_string(),
            server_url: self.config.server_url.clone(),
            expires_at: exp,
        })
    }

    /// Generate a token with custom grant
    pub fn generate_token_with_grant(
        &self,
        participant_identity: &str,
        participant_name: Option<&str>,
        grant: VideoGrant,
        ttl_seconds: Option<u64>,
    ) -> Result<VoiceToken, TokenError> {
        self.config.validate()?;

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();

        let ttl = ttl_seconds.unwrap_or(self.config.token_ttl_seconds);
        let exp = now + ttl;

        let room_name = grant.room.clone();

        let claims = AccessTokenClaims {
            iss: self.config.api_key.clone(),
            sub: participant_identity.to_string(),
            iat: now,
            exp,
            nbf: now,
            jti: uuid::Uuid::new_v4().to_string(),
            video: grant,
            name: participant_name.map(|s| s.to_string()),
            metadata: None,
        };

        let header = Header::new(Algorithm::HS256);
        let key = EncodingKey::from_secret(self.config.api_secret.as_bytes());
        let token = encode(&header, &claims, &key)?;

        Ok(VoiceToken {
            token,
            room_name,
            identity: participant_identity.to_string(),
            server_url: self.config.server_url.clone(),
            expires_at: exp,
        })
    }

    /// Generate a token for a recorder
    pub fn generate_recorder_token(
        &self,
        room_name: &str,
        recorder_identity: &str,
    ) -> Result<VoiceToken, TokenError> {
        let grant = VideoGrant::new(room_name).recorder();
        self.generate_token_with_grant(recorder_identity, Some("Recorder"), grant, None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_config() -> LiveKitConfig {
        LiveKitConfig::new(
            "test-api-key",
            "test-api-secret-that-is-long-enough",
            "wss://test.livekit.cloud",
        )
    }

    #[test]
    fn test_config_validation() {
        let valid = test_config();
        assert!(valid.validate().is_ok());

        let invalid = LiveKitConfig::default();
        assert!(invalid.validate().is_err());

        let empty_key = LiveKitConfig::new("", "secret", "wss://test");
        assert!(empty_key.validate().is_err());
    }

    #[test]
    fn test_token_generation() {
        let config = test_config();
        let service = LiveKitService::new(config).unwrap();

        let token = service
            .generate_token("test-room", "user-123", Some("Test User"), None, None)
            .unwrap();

        assert!(!token.token.is_empty());
        assert_eq!(token.room_name, "test-room");
        assert_eq!(token.identity, "user-123");
        assert!(token.expires_at > 0);
    }

    #[test]
    fn test_token_with_permissions() {
        let config = test_config();
        let service = LiveKitService::new(config).unwrap();

        let perms = VoicePermissions::listen_only();
        let token = service
            .generate_token("test-room", "listener", None, Some(perms), None)
            .unwrap();

        assert!(!token.token.is_empty());
    }

    #[test]
    fn test_token_with_custom_ttl() {
        let config = test_config();
        let service = LiveKitService::new(config).unwrap();

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();

        let token = service
            .generate_token("test-room", "user", None, None, Some(3600))
            .unwrap();

        // Should expire in about 1 hour
        assert!(token.expires_at >= now + 3500);
        assert!(token.expires_at <= now + 3700);
    }

    #[test]
    fn test_video_grant() {
        let grant = VideoGrant::new("my-room")
            .with_permissions(VoicePermissions::muted());

        assert_eq!(grant.room, "my-room");
        assert!(!grant.can_publish);
        assert!(grant.can_subscribe);
        assert!(grant.can_publish_data);
    }

    #[test]
    fn test_recorder_grant() {
        let grant = VideoGrant::new("my-room").recorder();

        assert!(grant.recorder.unwrap_or(false));
        assert!(grant.hidden.unwrap_or(false));
    }

    #[test]
    fn test_recorder_token() {
        let config = test_config();
        let service = LiveKitService::new(config).unwrap();

        let token = service
            .generate_recorder_token("test-room", "recorder-1")
            .unwrap();

        assert!(!token.token.is_empty());
        assert_eq!(token.identity, "recorder-1");
    }

    #[test]
    fn test_unconfigured_service() {
        let service = LiveKitService::unconfigured();
        assert!(!service.is_configured());

        let result = service.generate_token("room", "user", None, None, None);
        assert!(result.is_err());
    }
}
