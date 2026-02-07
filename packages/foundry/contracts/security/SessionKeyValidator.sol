// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title SessionKeyValidator - Temporary key delegation for AI agents
/// @notice Allows users to create time-limited session keys for automated gameplay
contract SessionKeyValidator {
    struct Session {
        address owner; // Main wallet address
        uint256 expiresAt; // Expiration timestamp
        uint256 maxUsage; // Maximum number of uses
        uint256 usageCount; // Current usage count
        bool isRevoked; // Whether the session has been revoked
    }

    mapping(address => Session) public sessions;

    event SessionCreated(address indexed sessionKey, address indexed owner, uint256 expiresAt);
    event SessionRevoked(address indexed sessionKey);
    event SessionUsed(address indexed sessionKey, uint256 usageCount);

    modifier onlyValidSession(address _sessionKey) {
        require(isSessionValid(_sessionKey), "Invalid or expired session");
        _;
        sessions[_sessionKey].usageCount++;
        emit SessionUsed(_sessionKey, sessions[_sessionKey].usageCount);
    }

    /// @notice Create a new session key delegation
    /// @param _sessionKey Address of the temporary key
    /// @param _duration How long the session is valid (in seconds)
    /// @param _maxUsage Maximum number of operations allowed
    function createSession(address _sessionKey, uint256 _duration, uint256 _maxUsage) external {
        require(_sessionKey != address(0), "Invalid session key");
        require(sessions[_sessionKey].owner == address(0), "Session already exists");
        require(_duration > 0 && _duration <= 7200, "Duration must be 1s-2h");
        require(_maxUsage > 0 && _maxUsage <= 1000, "Max usage must be 1-1000");

        sessions[_sessionKey] = Session({
            owner: msg.sender,
            expiresAt: block.timestamp + _duration,
            maxUsage: _maxUsage,
            usageCount: 0,
            isRevoked: false
        });

        emit SessionCreated(_sessionKey, msg.sender, block.timestamp + _duration);
    }

    /// @notice Revoke a session key (only the owner can do this)
    /// @param _sessionKey Address of the session key to revoke
    function revokeSession(address _sessionKey) external {
        require(sessions[_sessionKey].owner == msg.sender, "Not session owner");
        require(!sessions[_sessionKey].isRevoked, "Already revoked");
        sessions[_sessionKey].isRevoked = true;
        emit SessionRevoked(_sessionKey);
    }

    /// @notice Check if a session key is currently valid
    /// @param _sessionKey Address of the session key to check
    /// @return Whether the session key is valid
    function isSessionValid(address _sessionKey) public view returns (bool) {
        Session storage session = sessions[_sessionKey];
        return (session.owner != address(0) && block.timestamp <= session.expiresAt && !session.isRevoked
                && session.usageCount < session.maxUsage);
    }

    /// @notice Get the remaining time for a session key
    /// @param _sessionKey Address of the session key
    /// @return Remaining seconds (0 if expired)
    function getSessionRemainingTime(address _sessionKey) external view returns (uint256) {
        Session storage session = sessions[_sessionKey];
        if (block.timestamp >= session.expiresAt) return 0;
        return session.expiresAt - block.timestamp;
    }

    /// @notice Get the owner of a session key
    /// @param _sessionKey Address of the session key
    /// @return Owner address
    function getSessionOwner(address _sessionKey) external view returns (address) {
        return sessions[_sessionKey].owner;
    }
}
