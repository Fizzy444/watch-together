import { Users } from 'lucide-react';

export default function UserList({ users = [], hostId, currentUserId }) {
  // Deduplicate by id
  const uniqueUsers = Array.from(new Map(users.map((u) => [u.id, u])).values());

  return (
    <div>
      <div
        className="sidebar-title"
        style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}
      >
        <Users size={14} />
        Members ({uniqueUsers.length})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {uniqueUsers.map((user) => {
          const isMe = currentUserId && user.id === currentUserId;
          const isUserHost = user.isHost || user.id === hostId;

          return (
            <div key={user.id} className="user-item">
              <div className="user-avatar">
                {user.name?.[0]?.toUpperCase() || '?'}
              </div>
              <div className="user-info">
                <span className="user-name">
                  {user.name}
                  {isMe && (
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-3)', marginLeft: 6 }}>
                      (You)
                    </span>
                  )}
                </span>
                {isUserHost && (
                  <span
                    className="badge badge-host"
                    style={{ fontSize: '0.65rem', padding: '1px 6px' }}
                  >
                    Host
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
