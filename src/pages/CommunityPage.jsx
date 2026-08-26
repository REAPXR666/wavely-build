import React, { useState, useEffect, useRef } from 'react';
import { 
  MessageSquare, Megaphone, Sparkles, HelpCircle, Bug, 
  Send, LogOut, PlusCircle, CheckCircle, Clock, 
  Settings, Trash2, Shield, Eye, RefreshCw, XCircle
} from 'lucide-react';
import io from 'socket.io-client';
import logoImg from '../../app icon.png';

const API_BASE = 'https://splice-premium.replit.app';

export default function CommunityPage({ showToast }) {
  // Authentication State
  const [user, setUser] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [isLoginView, setIsLoginView] = useState(true);
  const [authForm, setAuthForm] = useState({ username: '', password: '' });
  
  // Navigation Tabs
  const [activeTab, setActiveTab] = useState('announcements'); // announcements, chat, tickets, bug, admin-bugs, admin-settings
  
  // Data lists
  const [announcements, setAnnouncements] = useState([]);
  const [updates, setUpdates] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [activeTicket, setActiveTicket] = useState(null);
  const [ticketMessages, setTicketMessages] = useState([]);
  const [bugReports, setBugReports] = useState([]); // Admin only
  
  // Admin-specific Configs
  const [discordWebhook, setDiscordWebhook] = useState('');
  
  // Inputs/Forms State
  const [chatInput, setChatInput] = useState('');
  const [annForm, setAnnForm] = useState({ title: '', content: '' });
  const [upForm, setUpForm] = useState({ version: '', changelog: '' });
  const [bugForm, setBugForm] = useState({ title: '', description: '', steps: '' });
  const [ticketForm, setTicketForm] = useState({ title: '', initialMessage: '' });
  const [showNewTicketModal, setShowNewTicketModal] = useState(false);
  const [ticketReplyInput, setTicketReplyInput] = useState('');
  
  // Socket.IO Ref
  const socketRef = useRef(null);
  const chatBottomRef = useRef(null);
  const ticketBottomRef = useRef(null);
  
  // --- AUTH CHECK & PERSISTENCE ---
  useEffect(() => {
    const checkPersistedAuth = async () => {
      const token = localStorage.getItem('splice_clone_token');
      if (token) {
        try {
          const res = await fetch(`${API_BASE}/api/verify`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          const data = await res.json();
          if (res.ok && data.valid) {
            setUser(data.user);
            // Default active tab: admins should see tickets/announcements, users see announcements
            if (data.user.is_admin) {
              setActiveTab('chat');
            } else {
              setActiveTab('announcements');
            }
          } else {
            localStorage.removeItem('splice_clone_token');
            localStorage.removeItem('splice_clone_user');
          }
        } catch (err) {
          console.error('Failed to verify token:', err);
        }
      }
      setLoadingAuth(false);
    };
    checkPersistedAuth();
  }, []);

  // --- SOCKET CONNECTION ENGINE ---
  useEffect(() => {
    if (!user) {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      return;
    }

    // Connect to Flask-SocketIO
    const socket = io(API_BASE);
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join', { token: localStorage.getItem('splice_clone_token') });
    });

    socket.on('history', (history) => {
      setChatMessages(history);
      scrollToChatBottom();
    });

    socket.on('new_message', (msg) => {
      setChatMessages(prev => {
        // Prevent duplicate messages
        if (prev.some(m => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
      scrollToChatBottom();
    });

    // Fallback Polling every 5 seconds if connection fails
    const pollingInterval = setInterval(() => {
      if (!socket.connected) {
        fetchChatHistory();
      }
    }, 5000);

    return () => {
      socket.disconnect();
      clearInterval(pollingInterval);
    };
  }, [user]);

  // Scroll Helpers
  const scrollToChatBottom = () => {
    setTimeout(() => {
      if (chatBottomRef.current) {
        chatBottomRef.current.scrollIntoView({ behavior: 'smooth' });
      }
    }, 50);
  };
  
  const scrollToTicketBottom = () => {
    setTimeout(() => {
      if (ticketBottomRef.current) {
        ticketBottomRef.current.scrollIntoView({ behavior: 'smooth' });
      }
    }, 50);
  };

  // --- FETCH DATA HELPERS ---
  const fetchAnnouncements = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/announcements`);
      const data = await res.json();
      if (res.ok) setAnnouncements(data);
    } catch (err) {
      console.error('Fetch announcements error:', err);
    }
  };

  const fetchUpdates = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/updates`);
      const data = await res.json();
      if (res.ok) setUpdates(data);
    } catch (err) {
      console.error('Fetch updates error:', err);
    }
  };

  const fetchChatHistory = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/chat`);
      const data = await res.json();
      if (res.ok) {
        setChatMessages(data);
        scrollToChatBottom();
      }
    } catch (err) {
      console.error('Fetch chat error:', err);
    }
  };

  const fetchTickets = async () => {
    try {
      const token = localStorage.getItem('splice_clone_token');
      const res = await fetch(`${API_BASE}/api/tickets`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) setTickets(data);
    } catch (err) {
      console.error('Fetch tickets error:', err);
    }
  };

  const fetchTicketDetails = async (ticketId) => {
    try {
      const token = localStorage.getItem('splice_clone_token');
      const res = await fetch(`${API_BASE}/api/tickets/${ticketId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) {
        setActiveTicket(data.ticket);
        setTicketMessages(data.messages);
        scrollToTicketBottom();
      }
    } catch (err) {
      console.error('Fetch ticket details error:', err);
    }
  };

  const fetchBugReports = async () => {
    try {
      const token = localStorage.getItem('splice_clone_token');
      const res = await fetch(`${API_BASE}/api/bugs`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) setBugReports(data);
    } catch (err) {
      console.error('Fetch bug reports error:', err);
    }
  };

  const fetchDiscordWebhook = async () => {
    try {
      const token = localStorage.getItem('splice_clone_token');
      const res = await fetch(`${API_BASE}/api/admin/settings`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) setDiscordWebhook(data.discord_webhook);
    } catch (err) {
      console.error('Fetch settings error:', err);
    }
  };

  // Trigger loading relevant data on tab change
  useEffect(() => {
    if (!user) return;
    if (activeTab === 'announcements') {
      fetchAnnouncements();
      fetchUpdates();
    } else if (activeTab === 'chat') {
      fetchChatHistory();
    } else if (activeTab === 'tickets') {
      fetchTickets();
      setActiveTicket(null);
    } else if (activeTab === 'admin-bugs') {
      fetchBugReports();
    } else if (activeTab === 'admin-settings') {
      fetchDiscordWebhook();
    }
  }, [activeTab, user]);

  // Support ticket loop refresh if a ticket is open
  useEffect(() => {
    if (!activeTicket) return;
    const interval = setInterval(() => {
      fetchTicketDetails(activeTicket.id);
    }, 4000);
    return () => clearInterval(interval);
  }, [activeTicket]);


  // --- FORM HANDLING ---

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    const endpoint = isLoginView ? '/api/login' : '/api/register';
    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(authForm)
      });
      const data = await res.json();
      if (res.ok) {
        localStorage.setItem('splice_clone_token', data.token);
        localStorage.setItem('splice_clone_user', JSON.stringify(data.user));
        setUser(data.user);
        showToast(isLoginView ? 'Welcome back!' : 'Account registered & logged in!', 'success');
        if (data.user.is_admin) {
          setActiveTab('chat');
        } else {
          setActiveTab('announcements');
        }
        setAuthForm({ username: '', password: '' });
      } else {
        showToast(data.error || 'Authentication failed', 'error');
      }
    } catch (err) {
      showToast('Network error connecting to Flask server', 'error');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('splice_clone_token');
    localStorage.removeItem('splice_clone_user');
    setUser(null);
    if (socketRef.current) socketRef.current.disconnect();
    showToast('Logged out successfully', 'success');
  };

  const handleSendChatMessage = async (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    
    // Attempt Socket.IO emit
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('message', {
        token: localStorage.getItem('splice_clone_token'),
        message: chatInput
      });
      setChatInput('');
    } else {
      // Fallback API post
      try {
        const token = localStorage.getItem('splice_clone_token');
        const res = await fetch(`${API_BASE}/api/chat`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ message: chatInput })
        });
        if (res.ok) {
          setChatInput('');
          fetchChatHistory();
        } else {
          showToast('Failed to send message', 'error');
        }
      } catch (err) {
        showToast('Server connection error', 'error');
      }
    }
  };

  // Announcement Submit
  const handlePostAnnouncement = async (e) => {
    e.preventDefault();
    if (!annForm.title.trim() || !annForm.content.trim()) return;
    try {
      const token = localStorage.getItem('splice_clone_token');
      const res = await fetch(`${API_BASE}/api/announcements`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(annForm)
      });
      if (res.ok) {
        showToast('Announcement published!', 'success');
        setAnnForm({ title: '', content: '' });
        fetchAnnouncements();
      } else {
        showToast('Failed to post announcement', 'error');
      }
    } catch (err) {
      showToast('Server communication error', 'error');
    }
  };

  const handleDeleteAnnouncement = async (id) => {
    if (!confirm('Are you sure you want to delete this announcement?')) return;
    try {
      const token = localStorage.getItem('splice_clone_token');
      const res = await fetch(`${API_BASE}/api/announcements/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        showToast('Announcement deleted', 'success');
        fetchAnnouncements();
      }
    } catch (err) {
      showToast('Delete failed', 'error');
    }
  };

  // App Update Submit
  const handlePostUpdate = async (e) => {
    e.preventDefault();
    if (!upForm.version.trim() || !upForm.changelog.trim()) return;
    try {
      const token = localStorage.getItem('splice_clone_token');
      const res = await fetch(`${API_BASE}/api/updates`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(upForm)
      });
      if (res.ok) {
        showToast('Update details published!', 'success');
        setUpForm({ version: '', changelog: '' });
        fetchUpdates();
      } else {
        showToast('Failed to post version update', 'error');
      }
    } catch (err) {
      showToast('Server communication error', 'error');
    }
  };

  const handleDeleteUpdate = async (id) => {
    if (!confirm('Are you sure you want to delete this version update?')) return;
    try {
      const token = localStorage.getItem('splice_clone_token');
      const res = await fetch(`${API_BASE}/api/updates/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        showToast('Version update deleted', 'success');
        fetchUpdates();
      }
    } catch (err) {
      showToast('Delete failed', 'error');
    }
  };

  // Discord Webhook Submit
  const handleSaveSettings = async (e) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem('splice_clone_token');
      const res = await fetch(`${API_BASE}/api/admin/settings`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ discord_webhook: discordWebhook })
      });
      if (res.ok) {
        showToast('Discord settings updated!', 'success');
      } else {
        showToast('Failed to save webhook settings', 'error');
      }
    } catch (err) {
      showToast('Server communication error', 'error');
    }
  };

  // Submit Bug Report
  const handlePostBug = async (e) => {
    e.preventDefault();
    if (!bugForm.title.trim() || !bugForm.description.trim()) return;
    try {
      const token = localStorage.getItem('splice_clone_token');
      const res = await fetch(`${API_BASE}/api/bugs`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(bugForm)
      });
      const data = await res.json();
      if (res.ok) {
        showToast(
          data.discord_sent 
            ? 'Bug reported and fired to Discord!' 
            : 'Bug reported successfully (webhook offline)', 
          'success'
        );
        setBugForm({ title: '', description: '', steps: '' });
      } else {
        showToast(data.error || 'Failed to submit bug report', 'error');
      }
    } catch (err) {
      showToast('Server communication error', 'error');
    }
  };

  // Create Ticket
  const handleCreateTicket = async (e) => {
    e.preventDefault();
    if (!ticketForm.title.trim() || !ticketForm.initialMessage.trim()) return;
    try {
      const token = localStorage.getItem('splice_clone_token');
      const res = await fetch(`${API_BASE}/api/tickets`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ 
          title: ticketForm.title, 
          message: ticketForm.initialMessage 
        })
      });
      const data = await res.json();
      if (res.ok) {
        showToast('Ticket opened successfully!', 'success');
        setTicketForm({ title: '', initialMessage: '' });
        setShowNewTicketModal(false);
        fetchTickets();
        // Load details of the newly created ticket
        fetchTicketDetails(data.ticket_id);
      } else {
        showToast(data.error || 'Failed to open ticket', 'error');
      }
    } catch (err) {
      showToast('Server communication error', 'error');
    }
  };

  // Add Ticket Message (reply)
  const handleSendTicketReply = async (e) => {
    e.preventDefault();
    if (!ticketReplyInput.trim() || !activeTicket) return;
    try {
      const token = localStorage.getItem('splice_clone_token');
      const res = await fetch(`${API_BASE}/api/tickets/${activeTicket.id}/messages`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ message: ticketReplyInput })
      });
      if (res.ok) {
        setTicketReplyInput('');
        fetchTicketDetails(activeTicket.id);
      } else {
        showToast('Failed to send reply', 'error');
      }
    } catch (err) {
      showToast('Network error replying to ticket', 'error');
    }
  };

  // Close / Reopen Support Ticket
  const handleToggleTicketStatus = async (status) => {
    if (!activeTicket) return;
    try {
      const token = localStorage.getItem('splice_clone_token');
      const res = await fetch(`${API_BASE}/api/admin/tickets/${activeTicket.id}/status`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status })
      });
      if (res.ok) {
        showToast(`Ticket status set to ${status}`, 'success');
        fetchTicketDetails(activeTicket.id);
        fetchTickets();
      } else {
        showToast('Failed to change ticket status', 'error');
      }
    } catch (err) {
      showToast('Server connection error', 'error');
    }
  };

  // --- LOADING AUTH INDICATOR ---
  if (loadingAuth) {
    return (
      <div className="community-loader">
        <RefreshCw className="pulse-playing" size={24} style={{ color: 'var(--accent-secondary)' }} />
        <span>Authenticating with portal...</span>
      </div>
    );
  }

  // --- UNAUTHENTICATED LOGIN / REGISTER VIEW ---
  if (!user) {
    return (
      <div className="community-auth-container">
        <div className="auth-card">
          <div className="auth-card-header">
            <img src={logoImg} alt="Wavely Logo" style={{ width: '48px', height: '48px', objectFit: 'contain', borderRadius: '6px', marginBottom: '12px' }} />
            <h2>WAVELY COMMUNITY</h2>
          </div>
          <p className="auth-subtitle">
            {isLoginView 
              ? 'Log in to join discussions, post announcements, chat, and access help.' 
              : 'Create an account to join the community.'}
          </p>

          <form onSubmit={handleAuthSubmit} className="auth-form">
            <div className="auth-form-group">
              <label>Username</label>
              <input 
                type="text" 
                placeholder="Enter username" 
                value={authForm.username}
                onChange={(e) => setAuthForm(prev => ({ ...prev, username: e.target.value }))}
                required 
                autoComplete="off"
              />
            </div>
            
            <div className="auth-form-group">
              <label>Password</label>
              <input 
                type="password" 
                placeholder="Enter password" 
                value={authForm.password}
                onChange={(e) => setAuthForm(prev => ({ ...prev, password: e.target.value }))}
                required 
              />
            </div>

            <button type="submit" className="auth-submit-btn">
              <span>{isLoginView ? 'Log In' : 'Sign Up & Login'}</span>
            </button>
          </form>

          <div className="auth-footer-toggle">
            <span>
              {isLoginView ? "Don't have an account? " : "Already have an account? "}
            </span>
            <button className="toggle-view-btn" onClick={() => setIsLoginView(!isLoginView)}>
              {isLoginView ? 'Create Account' : 'Log In instead'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- AUTHENTICATED USER & ADMIN PORTAL LAYOUT ---
  return (
    <div className="community-portal-container">
      {/* Community Header */}
      <header className="community-header">
        <div className="header-left-title">
          <h2>Wavely Portal</h2>
          <p>
            Logged in as: <span className="user-badge">{user.username}</span>
            {user.is_admin && <span className="admin-pill"><Shield size={10} /> ADMIN</span>}
          </p>
        </div>
        <button className="portal-logout-btn" onClick={handleLogout}>
          <LogOut size={16} />
          <span>Logout</span>
        </button>
      </header>

      {/* Portal Tabs Bar */}
      <nav className="portal-tabs-row">
        {/* User tabs */}
        {!user.is_admin && (
          <>
            <button 
              className={`portal-tab-btn ${activeTab === 'announcements' ? 'active' : ''}`}
              onClick={() => setActiveTab('announcements')}
            >
              <Megaphone size={16} />
              <span>Announcements & Releases</span>
            </button>
            
            <button 
              className={`portal-tab-btn ${activeTab === 'chat' ? 'active' : ''}`}
              onClick={() => setActiveTab('chat')}
            >
              <MessageSquare size={16} />
              <span>Live Chatroom</span>
            </button>
            
            <button 
              className={`portal-tab-btn ${activeTab === 'tickets' ? 'active' : ''}`}
              onClick={() => setActiveTab('tickets')}
            >
              <HelpCircle size={16} />
              <span>Help Tickets</span>
            </button>
            
            <button 
              className={`portal-tab-btn ${activeTab === 'bug' ? 'active' : ''}`}
              onClick={() => setActiveTab('bug')}
            >
              <Bug size={16} />
              <span>Report Bug</span>
            </button>
          </>
        )}

        {/* Admin tabs */}
        {user.is_admin && (
          <>
            <button 
              className={`portal-tab-btn ${activeTab === 'chat' ? 'active' : ''}`}
              onClick={() => setActiveTab('chat')}
            >
              <MessageSquare size={16} />
              <span>Live Chatroom</span>
            </button>

            <button 
              className={`portal-tab-btn ${activeTab === 'announcements' ? 'active' : ''}`}
              onClick={() => {
                setActiveTab('announcements');
                fetchAnnouncements();
                fetchUpdates();
              }}
            >
              <Megaphone size={16} />
              <span>Post Announcements / Versions</span>
            </button>

            <button 
              className={`portal-tab-btn ${activeTab === 'tickets' ? 'active' : ''}`}
              onClick={() => setActiveTab('tickets')}
            >
              <HelpCircle size={16} />
              <span>Support Tickets Desk</span>
            </button>
            
            <button 
              className={`portal-tab-btn ${activeTab === 'admin-bugs' ? 'active' : ''}`}
              onClick={() => setActiveTab('admin-bugs')}
            >
              <Bug size={16} />
              <span>Bug reports Registry</span>
            </button>
            
            <button 
              className={`portal-tab-btn ${activeTab === 'admin-settings' ? 'active' : ''}`}
              onClick={() => setActiveTab('admin-settings')}
            >
              <Settings size={16} />
              <span>Discord Config</span>
            </button>
          </>
        )}
      </nav>

      {/* Tab Panels Contents */}
      <div className="portal-panel-content">

        {/* ANNOUNCEMENTS & RELEASES */}
        {activeTab === 'announcements' && (
          <div className="announcements-panel">
            {user.is_admin && (
              <div className="admin-forms-row">
                {/* Form: Post Announcement */}
                <div className="portal-card form-card">
                  <h3><Megaphone size={16} className="title-icon" /> Publish Alert</h3>
                  <form onSubmit={handlePostAnnouncement}>
                    <input 
                      type="text" 
                      placeholder="Announcement Title" 
                      value={annForm.title}
                      onChange={(e) => setAnnForm(prev => ({ ...prev, title: e.target.value }))}
                      required 
                    />
                    <textarea 
                      placeholder="Write announcement details..." 
                      rows={3}
                      value={annForm.content}
                      onChange={(e) => setAnnForm(prev => ({ ...prev, content: e.target.value }))}
                      required
                    ></textarea>
                    <button type="submit" className="portal-btn">Publish</button>
                  </form>
                </div>

                {/* Form: Post Version Update */}
                <div className="portal-card form-card">
                  <h3><Sparkles size={16} className="title-icon" /> Release App Version</h3>
                  <form onSubmit={handlePostUpdate}>
                    <input 
                      type="text" 
                      placeholder="e.g. v1.0.5" 
                      value={upForm.version}
                      onChange={(e) => setUpForm(prev => ({ ...prev, version: e.target.value }))}
                      required 
                    />
                    <textarea 
                      placeholder="Changelog (New releases, updates...)" 
                      rows={3}
                      value={upForm.changelog}
                      onChange={(e) => setUpForm(prev => ({ ...prev, changelog: e.target.value }))}
                      required
                    ></textarea>
                    <button type="submit" className="portal-btn secondary">Post Version Details</button>
                  </form>
                </div>
              </div>
            )}

            <div className="announcements-layout">
              {/* Left Column: Announcements */}
              <div className="announcements-column">
                <div className="column-title">Announcements</div>
                <div className="column-scroll">
                  {announcements.length > 0 ? (
                    announcements.map(ann => (
                      <div key={ann.id} className="portal-alert-card">
                        <div className="alert-card-header">
                          <h4>{ann.title}</h4>
                          <span className="card-time">
                            {new Date(ann.created_at).toLocaleDateString()}
                          </span>
                        </div>
                        <p className="alert-content">{ann.content}</p>
                        {user.is_admin && (
                          <button 
                            className="card-delete-btn" 
                            onClick={() => handleDeleteAnnouncement(ann.id)}
                            title="Delete Announcement"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="empty-state">No announcements published.</div>
                  )}
                </div>
              </div>

              {/* Right Column: Version Updates */}
              <div className="updates-column">
                <div className="column-title">Updates & Releases</div>
                <div className="column-scroll">
                  {updates.length > 0 ? (
                    updates.map(up => (
                      <div key={up.id} className="portal-version-card">
                        <div className="version-card-header">
                          <span className="version-tag">Version {up.version}</span>
                          <span className="card-time">
                            {new Date(up.created_at).toLocaleDateString()}
                          </span>
                        </div>
                        <pre className="version-changelog">{up.changelog}</pre>
                        {user.is_admin && (
                          <button 
                            className="card-delete-btn" 
                            onClick={() => handleDeleteUpdate(up.id)}
                            title="Delete Version Update"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="empty-state">No releases indexed.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* CHATROOM PANEL */}
        {activeTab === 'chat' && (
          <div className="chatroom-panel">
            <div className="chat-messages-scroll">
              {chatMessages.length > 0 ? (
                chatMessages.map(msg => {
                  const isSelf = msg.username === user.username;
                  const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  return (
                    <div key={msg.id} className={`chat-bubble-row ${isSelf ? 'self' : 'other'}`}>
                      <div className="bubble-contents">
                        <div className="bubble-meta">
                          <span className="bubble-sender">@{msg.username}</span>
                          <span className="bubble-time">{time}</span>
                        </div>
                        <div className="bubble-text">{msg.message}</div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="empty-state">No chat messages yet. Introduce yourself!</div>
              )}
              <div ref={chatBottomRef} />
            </div>

            <form onSubmit={handleSendChatMessage} className="chatroom-input-bar">
              <input 
                type="text" 
                placeholder="Send message to community..." 
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                required
                autoComplete="off"
              />
              <button type="submit" className="chat-send-btn">
                <Send size={16} />
              </button>
            </form>
          </div>
        )}

        {/* TICKET SYSTEM PANEL */}
        {activeTab === 'tickets' && (
          <div className="tickets-panel">
            {/* Sidebar list of tickets */}
            <div className="tickets-sidebar">
              <div className="sidebar-header-row">
                <h3>Support Desk</h3>
                {!user.is_admin && (
                  <button className="new-ticket-btn" onClick={() => setShowNewTicketModal(true)}>
                    <PlusCircle size={14} />
                    <span>New Ticket</span>
                  </button>
                )}
              </div>

              <div className="tickets-list">
                {tickets.length > 0 ? (
                  tickets.map(t => (
                    <div 
                      key={t.id} 
                      className={`ticket-sidebar-item ${activeTicket?.id === t.id ? 'active' : ''} ${t.status === 'closed' ? 'closed' : ''}`}
                      onClick={() => fetchTicketDetails(t.id)}
                    >
                      <div className="ticket-item-meta">
                        <span className="ticket-item-user">@{t.username}</span>
                        <span className={`status-pill ${t.status}`}>
                          {t.status === 'open' ? <Clock size={10} /> : <CheckCircle size={10} />}
                          {t.status}
                        </span>
                      </div>
                      <h4 className="ticket-item-title">{t.title}</h4>
                      <span className="ticket-item-date">{new Date(t.created_at).toLocaleDateString()}</span>
                    </div>
                  ))
                ) : (
                  <div className="empty-state" style={{ padding: '20px 10px' }}>No tickets open.</div>
                )}
              </div>
            </div>

            {/* Conversation Viewer */}
            <div className="ticket-chat-area">
              {activeTicket ? (
                <div className="ticket-chat-wrapper">
                  <header className="ticket-chat-header">
                    <div>
                      <h3>{activeTicket.title}</h3>
                      <p>
                        User: <strong>@{activeTicket.username}</strong> | Status:{' '}
                        <span className={`status-text ${activeTicket.status}`}>{activeTicket.status}</span>
                      </p>
                    </div>
                    {user.is_admin && (
                      <button 
                        className={`status-toggle-btn ${activeTicket.status === 'open' ? 'danger' : 'success'}`}
                        onClick={() => handleToggleTicketStatus(activeTicket.status === 'open' ? 'closed' : 'open')}
                      >
                        {activeTicket.status === 'open' ? 'Close Ticket' : 'Reopen Ticket'}
                      </button>
                    )}
                  </header>

                  <div className="ticket-messages-scroll">
                    {ticketMessages.map(msg => {
                      const isSelf = msg.sender_name === user.username;
                      const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                      return (
                        <div key={msg.id} className={`ticket-bubble-row ${isSelf ? 'self' : 'other'}`}>
                          <div className="bubble-contents">
                            <div className="bubble-meta">
                              <span className="bubble-sender">{msg.sender_name}</span>
                              <span className="bubble-time">{time}</span>
                            </div>
                            <div className="bubble-text">{msg.message}</div>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={ticketBottomRef} />
                  </div>

                  <form onSubmit={handleSendTicketReply} className="ticket-chat-input">
                    <input 
                      type="text" 
                      placeholder="Type a response to support..." 
                      value={ticketReplyInput}
                      onChange={(e) => setTicketReplyInput(e.target.value)}
                      required
                      autoComplete="off"
                    />
                    <button type="submit" className="chat-send-btn">
                      <Send size={16} />
                    </button>
                  </form>
                </div>
              ) : (
                <div className="empty-state chat-empty">
                  <HelpCircle size={40} style={{ opacity: 0.15, marginBottom: '16px' }} />
                  <p>Select a support ticket from the sidebar to view thread or reply</p>
                </div>
              )}
            </div>

            {/* Modal: New Ticket Submission */}
            {showNewTicketModal && (
              <div className="modal-overlay">
                <div className="modal-card">
                  <header className="modal-header">
                    <h3>Open Support Ticket</h3>
                    <button onClick={() => setShowNewTicketModal(false)} className="modal-close">
                      <XCircle size={18} />
                    </button>
                  </header>
                  <form onSubmit={handleCreateTicket} className="modal-form">
                    <div className="form-group">
                      <label>Ticket Summary / Question</label>
                      <input 
                        type="text" 
                        placeholder="e.g. Can't download Serum preset" 
                        value={ticketForm.title}
                        onChange={(e) => setTicketForm(prev => ({ ...prev, title: e.target.value }))}
                        required 
                      />
                    </div>
                    <div className="form-group">
                      <label>Detailed Message</label>
                      <textarea 
                        placeholder="Explain your question or problem in detail..." 
                        rows={4}
                        value={ticketForm.initialMessage}
                        onChange={(e) => setTicketForm(prev => ({ ...prev, initialMessage: e.target.value }))}
                        required
                      ></textarea>
                    </div>
                    <button type="submit" className="portal-btn">Submit Ticket</button>
                  </form>
                </div>
              </div>
            )}
          </div>
        )}

        {/* USER REPORT BUG PANEL */}
        {activeTab === 'bug' && (
          <div className="bug-report-panel">
            <div className="portal-card medium-width">
              <h3><Bug size={18} className="title-icon" style={{ color: '#ef4444' }} /> Report a Bug / Issue</h3>
              <p className="description">Found a glitch in the app? Submit a report below. It will write to our bug logs and fire a webhook notification straight to our Discord development server.</p>

              <form onSubmit={handlePostBug} className="bug-form">
                <div className="form-group">
                  <label>Bug Title / Summary</label>
                  <input 
                    type="text" 
                    placeholder="e.g. Audio loops do not loop when Looping is checked" 
                    value={bugForm.title}
                    onChange={(e) => setBugForm(prev => ({ ...prev, title: e.target.value }))}
                    required 
                  />
                </div>
                
                <div className="form-group">
                  <label>Problem Description</label>
                  <textarea 
                    placeholder="Describe exactly what goes wrong..." 
                    rows={4}
                    value={bugForm.description}
                    onChange={(e) => setBugForm(prev => ({ ...prev, description: e.target.value }))}
                    required
                  ></textarea>
                </div>

                <div className="form-group">
                  <label>Steps to Reproduce (Optional)</label>
                  <textarea 
                    placeholder="1. Search for 'kick'&#10;2. Double click to play&#10;3. Click Loop, observe it does not repeat" 
                    rows={3}
                    value={bugForm.steps}
                    onChange={(e) => setBugForm(prev => ({ ...prev, steps: e.target.value }))}
                  ></textarea>
                </div>

                <button type="submit" className="portal-btn danger">Submit Issue Report</button>
              </form>
            </div>
          </div>
        )}

        {/* ADMIN BUG REPORTS REGISTRY */}
        {activeTab === 'admin-bugs' && (
          <div className="admin-bugs-panel">
            <div className="portal-card full-width">
              <h3><Bug size={18} className="title-icon" /> Bug Reports Registry</h3>
              <div className="portal-table-container">
                {bugReports.length > 0 ? (
                  <table className="portal-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>User</th>
                        <th>Bug Title</th>
                        <th>Description</th>
                        <th>Steps to Reproduce</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bugReports.map(bug => (
                        <tr key={bug.id}>
                          <td className="nowrap">{new Date(bug.created_at).toLocaleDateString()}</td>
                          <td><strong>@{bug.username}</strong></td>
                          <td className="bug-title-td">{bug.title}</td>
                          <td className="bug-desc-td">{bug.description}</td>
                          <td>
                            {bug.steps_to_reproduce ? (
                              <code>{bug.steps_to_reproduce}</code>
                            ) : (
                              <span className="empty-text">None</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="empty-state">No bugs reported. Excellent job!</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ADMIN DISCORD CONFIG PANEL */}
        {activeTab === 'admin-settings' && (
          <div className="admin-settings-panel">
            <div className="portal-card medium-width">
              <h3><Settings size={18} className="title-icon" /> Discord Integrations</h3>
              <p className="description">Configure the Discord webhook URL to send real-time notification alerts to your server whenever a user reports a bug.</p>
              
              <form onSubmit={handleSaveSettings} className="settings-form">
                <div className="form-group">
                  <label>Discord Webhook URL</label>
                  <input 
                    type="url" 
                    placeholder="https://discord.com/api/webhooks/..." 
                    value={discordWebhook}
                    onChange={(e) => setDiscordWebhook(e.target.value)}
                    autoComplete="off"
                  />
                </div>
                
                {discordWebhook && discordWebhook.startsWith('https://') ? (
                  <div className="webhook-badge success">✓ Discord Webhook Configured</div>
                ) : (
                  <div className="webhook-badge warning">⚠ Webhook URL Empty. reports will remain local only.</div>
                )}

                <button type="submit" className="portal-btn">Save Configurations</button>
              </form>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
