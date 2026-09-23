import { User } from 'lucide-react';

export default function ProfileBadge({ name }) {
  const initial = name ? name[0].toUpperCase() : '?';

  return (
    <div
      className="profile-badge-btn"
      style={{ cursor: 'default', userSelect: 'none' }}
      title={name ? `Signed in as ${name}` : 'Guest'}
    >
      <div className="profile-badge-avatar">
        {name ? initial : <User size={12} />}
      </div>
      <span className="profile-badge-name">
        {name || 'Anonymous'}
      </span>
    </div>
  );
}
