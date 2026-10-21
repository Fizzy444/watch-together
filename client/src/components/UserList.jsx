import { Users } from 'lucide-react';

export default function UserList({ users = [], hostId, currentUserId }) {
  // Deduplicate by id
  const uniqueUsers = Array.from(new Map(users.map((u) => [u.id, u])).values());

  return (
    <div>
      <div
        className="sidebar-title"
        style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
      >
        <Users size={12} />
        Members ({uniqueUsers.length})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
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
                    <span style={{ fontSize: '0.6875rem', color: 'var(--text-3)', marginLeft: 4 }}>
                      (You)
                    </span>
                  )}
                </span>
                {isUserHost && (
                  <span
                    className="badge badge-host"
                    style={{ fontSize: '0.625rem', padding: '1px 5px' }}
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
