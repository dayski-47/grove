// src/components/ChannelSidebar.tsx
import { useState } from "react";

export interface Channel {
  id: number;
  name: string;
}

export function ChannelSidebar({
  currentChannel,
  channels,
  onSelectChannel,
  onCreateChannel,
  onLogout,
  connected,
  onlineUsers,
  currentUserId,
  usernames,
  onCall,
}: {
  currentChannel: number | null;
  channels:       Channel[];
  onSelectChannel: (id: number) => void;
  onCreateChannel: (name: string) => void;
  onLogout:        () => void;
  connected:       boolean;
  onlineUsers:     Set<number>;
  currentUserId:   number;
  usernames:       Record<number, string>;
  onCall:          (userId: number) => void;
}) {
  const [newName, setNewName] = useState("");
  const otherOnline = [...onlineUsers].filter((id) => id !== currentUserId);

  return (
    <aside className="grove-sidebar">
      <div className="grove-sidebar-header">
        <span className="grove-branch">❦</span> Grove
        <span
          className={connected ? "grove-status grove-online" : "grove-status grove-offline"}
          title={connected ? "connected" : "disconnected"}
        />
      </div>

      <div className="grove-channels">
        {channels.map((ch) => (
          <button
            key={ch.id}
            className={ch.id === currentChannel ? "grove-channel grove-channel-active" : "grove-channel"}
            onClick={() => onSelectChannel(ch.id)}
          >
            ⌖ {ch.name}
          </button>
        ))}
      </div>

      {otherOnline.length > 0 && (
        <div className="grove-online-section">
          <div className="grove-section-label">online</div>
          {otherOnline.map((uid) => (
            <div key={uid} className="grove-online-user">
              <span className="grove-user-dot" />
              <span className="grove-user-name">{usernames[uid] ?? `user ${uid}`}</span>
              <button
                className="grove-call-btn"
                onClick={() => onCall(uid)}
                title={`Call ${usernames[uid] ?? uid}`}
              >
                ↗
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="grove-new-channel">
        <input
          className="grove-input grove-input-small"
          placeholder="new grove…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newName.trim()) {
              onCreateChannel(newName.trim());
              setNewName("");
            }
          }}
        />
        <button
          className="grove-button grove-button-small"
          onClick={() => {
            if (newName.trim()) {
              onCreateChannel(newName.trim());
              setNewName("");
            }
          }}
        >
          plant
        </button>
      </div>

      <button className="grove-logout" onClick={onLogout}>
        leave the grove
      </button>
    </aside>
  );
}
