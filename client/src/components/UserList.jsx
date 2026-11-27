import { memo } from 'react';
import { Users, Shield, ShieldOff } from 'lucide-react';

function UserList({
  users = [],
  hostId,
  currentUserId,
  canManageAdmins = false,
  onToggleAdmin,
}) {
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
          const isUserAdmin = !isUserHost && Boolean(user.isAdmin);
          const showAdminToggle = canManageAdmins && !isMe && !isUserHost && Boolean(onToggleAdmin);

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
                {isUserAdmin && (
                  <span
                    className="badge badge-info"
                    style={{ fontSize: '0.625rem', padding: '1px 5px' }}
                  >
                    Admin
                  </span>
                )}
              </div>
              {showAdminToggle && (
                <button
                  type="button"
                  className={`user-role-btn ${isUserAdmin ? 'is-admin' : ''}`}
                  onClick={() => onToggleAdmin(user.id, !isUserAdmin)}
                  title={isUserAdmin ? 'Remove Admin' : 'Make Admin'}
                  aria-label={isUserAdmin ? `Remove admin from ${user.name}` : `Make ${user.name} admin`}
                >
                  {isUserAdmin ? <ShieldOff size={12} /> : <Shield size={12} />}
                  <span>{isUserAdmin ? 'Remove' : 'Make Admin'}</span>
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default memo(UserList);
