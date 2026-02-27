import { ethers } from "ethers";

/**
 * ChatClient — REST client for the chat-server.
 * Used by MCP adapter to send and retrieve chat messages off-chain.
 */
export class ChatClient {
  private baseUrl: string;
  private token: string | null = null;
  private wallet: ethers.Wallet;

  constructor(baseUrl: string, wallet: ethers.Wallet) {
    this.baseUrl = baseUrl.replace(/\/$/, ""); // strip trailing slash
    this.wallet = wallet;
  }

  /**
   * Authenticate with the chat server using SIWE-style signature.
   */
  async authenticate(): Promise<void> {
    const message = `Chat login for RTTA at ${Date.now()}`;
    const signature = await this.wallet.signMessage(message);

    const res = await fetch(`${this.baseUrl}/api/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, signature }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Chat auth failed (${res.status}): ${body}`);
    }

    const data = await res.json();
    this.token = data.token;
  }

  /**
   * Ensure we have a valid token, authenticating if needed.
   */
  private async ensureAuth(): Promise<string> {
    if (!this.token) {
      await this.authenticate();
    }
    return this.token!;
  }

  /**
   * Send a chat message to a room via REST API.
   */
  async sendMessage(roomId: number, content: string): Promise<void> {
    const token = await this.ensureAuth();

    const res = await fetch(`${this.baseUrl}/api/rooms/${roomId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ content }),
    });

    if (res.status === 401) {
      // Token expired — re-authenticate and retry once
      this.token = null;
      const newToken = await this.ensureAuth();
      const retry = await fetch(`${this.baseUrl}/api/rooms/${roomId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${newToken}`,
        },
        body: JSON.stringify({ content }),
      });
      if (!retry.ok) {
        const body = await retry.text();
        throw new Error(`Chat send failed (${retry.status}): ${body}`);
      }
      return;
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Chat send failed (${res.status}): ${body}`);
    }
  }

  /**
   * Get messages for a room, optionally filtered by round.
   */
  async getMessages(roomId: number, round?: number): Promise<any[]> {
    const token = await this.ensureAuth();

    const url = round !== undefined
      ? `${this.baseUrl}/api/rooms/${roomId}/messages?round=${round}`
      : `${this.baseUrl}/api/rooms/${roomId}/messages`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 401) {
      this.token = null;
      const newToken = await this.ensureAuth();
      const retry = await fetch(url, {
        headers: { Authorization: `Bearer ${newToken}` },
      });
      if (!retry.ok) {
        return [];
      }
      return retry.json();
    }

    if (!res.ok) {
      return [];
    }

    return res.json();
  }

  /**
   * Get join authorization from chat-server operator.
   * Returns commitment + operator signature for commit-reveal identity hiding.
   */
  async getJoinAuth(roomId: number, isAI: boolean, maxPlayers: number): Promise<{
    commitment: string;
    salt: string;
    operatorSig: string;
  }> {
    const token = await this.ensureAuth();

    const res = await fetch(`${this.baseUrl}/api/room-join-auth`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ roomId, isAI, maxPlayers }),
    });

    if (res.status === 401) {
      // Token expired — re-authenticate and retry once
      this.token = null;
      const newToken = await this.ensureAuth();
      const retry = await fetch(`${this.baseUrl}/api/room-join-auth`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${newToken}`,
        },
        body: JSON.stringify({ roomId, isAI, maxPlayers }),
      });
      if (!retry.ok) {
        const body = await retry.text();
        throw new Error(`Join auth failed (${retry.status}): ${body}`);
      }
      return retry.json();
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Join auth failed (${res.status}): ${body}`);
    }

    return res.json();
  }

  /**
   * Update the creator's identity record from room_id=0 to the actual room ID.
   * Called after createRoom tx confirms on-chain.
   */
  async updateRoomId(newRoomId: number): Promise<void> {
    const token = await this.ensureAuth();

    const res = await fetch(`${this.baseUrl}/api/room-join-auth/update-room-id`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ newRoomId }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.warn(`[ChatClient] Failed to update room ID (${res.status}): ${body}`);
    }
  }
}
