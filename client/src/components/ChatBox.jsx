import { useState, useRef, useEffect } from 'react';
import { Send, MessageSquare, Crown } from 'lucide-react';

function formatChatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function ChatBox({
  messages = [],
  onSendMessage,
  currentUserId,
  hostId,
}) {
  const [text, setText] = useState('');
  const messagesEndRef = useRef(null);

  // Auto-scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  function handleSubmit(e) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    onSendMessage?.(trimmed);
    setText('');
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  return (
    <div className="chat-container">
      {/* Messages stream */}
      <div className="chat-messages">
        {messages.length === 0 ? (
          <div className="chat-empty">
            <MessageSquare size={22} style={{ opacity: 0.35 }} />
            <p style={{ fontWeight: 500, color: 'var(--text-2)' }}>No messages yet</p>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>
              Say hello or chat during the movie!
            </span>
          </div>
        ) : (
          messages.map((m) => {
            const isMine = currentUserId && m.senderId === currentUserId;
            const isSenderHost = m.isHost || m.senderId === hostId;

            return (
              <div key={m.id} className={`chat-msg ${isMine ? 'mine' : 'other'}`}>
                <div className="chat-msg-header">
                  <span className="chat-msg-sender">
                    {m.senderName}
                    {isMine && <span style={{ opacity: 0.6, marginLeft: 4 }}>(You)</span>}
                  </span>
                  {isSenderHost && (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 2,
                        color: 'var(--warning)',
                        fontSize: '0.65rem',
                      }}
                      title="Host"
                    >
                      <Crown size={10} />
                    </span>
                  )}
                  <span className="chat-msg-time">{formatChatTime(m.timestamp)}</span>
                </div>
                <div className="chat-msg-bubble">{m.text}</div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <form className="chat-input-bar" onSubmit={handleSubmit}>
        <input
          type="text"
          className="input input-sm"
          placeholder="Send a message..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          maxLength={500}
        />
        <button
          type="submit"
          className="btn btn-primary btn-sm chat-send-btn"
          disabled={!text.trim()}
          title="Send message (Enter)"
          
        >
          <Send size={13} />
        </button>
      </form>
    </div>
  );
}
