import { useCallback, useEffect, useRef, useState } from "react";

const API_BASE = "https://gemini-ai-backend-uxgd.onrender.com";
const TOKEN_KEY = "gemini_chat_access_token";

function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({
    name: "",
    email: "",
    password: "",
  });
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");

  const [conversations, setConversations] = useState([]);
  const [activeConversation, setActiveConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [sidebarLoading, setSidebarLoading] = useState(false);
  const [appLoading, setAppLoading] = useState(Boolean(token));

  const messagesEndRef = useRef(null);

  const clearSession = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    setConversations([]);
    setActiveConversation(null);
    setMessages([]);
    setMessage("");
  }, []);

  // All private API requests use this helper to attach the JWT.
  const authFetch = useCallback(
    async (url, options = {}) => {
      const currentToken = token || localStorage.getItem(TOKEN_KEY);
      const headers = {
        ...(options.headers || {}),
        ...(currentToken
          ? { Authorization: `Bearer ${currentToken}` }
          : {}),
      };

      const response = await fetch(url, { ...options, headers });

      if (response.status === 401) {
        clearSession();
        throw new Error("Your session has expired. Please log in again.");
      }

      return response;
    },
    [token, clearSession]
  );

  const loadConversations = useCallback(async () => {
    try {
      setSidebarLoading(true);
      const response = await authFetch(`${API_BASE}/conversations`);

      if (!response.ok) {
        throw new Error("Unable to load conversations.");
      }

      const data = await response.json();
      setConversations(data.conversations || []);
    } catch (error) {
      console.error("Conversation loading error:", error);
    } finally {
      setSidebarLoading(false);
    }
  }, [authFetch]);

  const loadConversation = async (conversationId) => {
    if (loading) return;

    try {
      setLoading(true);
      const response = await authFetch(
        `${API_BASE}/conversations/${conversationId}`
      );

      if (!response.ok) {
        throw new Error("Unable to load conversation.");
      }

      const data = await response.json();
      setActiveConversation(conversationId);
      setMessages(
        (data.messages || []).map((item) => ({
          role: item.role,
          text: item.content,
        }))
      );
    } catch (error) {
      console.error("History loading error:", error);
      alert(error.message || "Unable to load this conversation.");
    } finally {
      setLoading(false);
    }
  };

  const createConversation = async () => {
    if (loading) return null;

    try {
      const response = await authFetch(`${API_BASE}/conversations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New Chat" }),
      });

      if (!response.ok) {
        throw new Error("Unable to create conversation.");
      }

      const data = await response.json();
      setActiveConversation(data.conversation_id);
      setMessages([]);
      await loadConversations();
      return data.conversation_id;
    } catch (error) {
      console.error("Create conversation error:", error);
      alert(error.message || "Unable to create a new conversation.");
      return null;
    }
  };

  const sendMessage = async (event) => {
    event.preventDefault();

    const userMessage = message.trim();
    if (!userMessage || loading) return;

    let conversationId = activeConversation;

    try {
      setLoading(true);

      if (!conversationId) {
        const createResponse = await authFetch(`${API_BASE}/conversations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "New Chat" }),
        });

        if (!createResponse.ok) {
          throw new Error("Unable to create conversation.");
        }

        const newConversation = await createResponse.json();
        conversationId = newConversation.conversation_id;
        setActiveConversation(conversationId);
      }

      setMessage("");
      setMessages((previous) => [
        ...previous,
        { role: "user", text: userMessage },
      ]);

      const response = await authFetch(
        `${API_BASE}/conversations/${conversationId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: userMessage }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || "AI response failed.");
      }

      const data = await response.json();
      setMessages((previous) => [
        ...previous,
        { role: "assistant", text: data.assistant_reply },
      ]);

      await loadConversations();
    } catch (error) {
      console.error("Message error:", error);
      setMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          text: error.message || "Unable to connect to the AI server. Please try again.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const deleteConversation = async (conversationId) => {
    const confirmed = window.confirm(
      "Are you sure you want to delete this conversation?"
    );
    if (!confirmed) return;

    try {
      const response = await authFetch(
        `${API_BASE}/conversations/${conversationId}`,
        { method: "DELETE" }
      );

      if (!response.ok) {
        throw new Error("Unable to delete conversation.");
      }

      if (activeConversation === conversationId) {
        setActiveConversation(null);
        setMessages([]);
      }

      await loadConversations();
    } catch (error) {
      console.error("Delete error:", error);
      alert(error.message || "Unable to delete conversation.");
    }
  };

  const handleAuthSubmit = async (event) => {
    event.preventDefault();
    setAuthError("");

    const email = authForm.email.trim().toLowerCase();
    const password = authForm.password;

    if (!email || !password) {
      setAuthError("Please enter your email and password.");
      return;
    }

    if (authMode === "signup" && !authForm.name.trim()) {
      setAuthError("Please enter your name.");
      return;
    }

    if (authMode === "signup" && password.length < 8) {
      setAuthError("Password must contain at least 8 characters.");
      return;
    }

    setAuthLoading(true);

    try {
      if (authMode === "signup") {
        const registerResponse = await fetch(`${API_BASE}/auth/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: authForm.name.trim(),
            email,
            password,
          }),
        });

        const registerData = await registerResponse.json().catch(() => ({}));

        if (!registerResponse.ok) {
          throw new Error(registerData.detail || "Unable to create account.");
        }
      }

      // FastAPI OAuth2PasswordRequestForm expects form fields named
      // "username" and "password", not a JSON body.
      const formBody = new URLSearchParams();
      formBody.set("username", email);
      formBody.set("password", password);

      const loginResponse = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: formBody.toString(),
      });

      const loginData = await loginResponse.json().catch(() => ({}));

      if (!loginResponse.ok) {
        throw new Error(loginData.detail || "Login failed.");
      }

      localStorage.setItem(TOKEN_KEY, loginData.access_token);
      setToken(loginData.access_token);
      setAuthForm({ name: "", email: "", password: "" });
    } catch (error) {
      console.error("Authentication error:", error);
      setAuthError(error.message || "Authentication failed. Please try again.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    clearSession();
    setAuthMode("login");
    setAuthError("");
  };

  // Restore the login session when the page is refreshed.
  useEffect(() => {
    let cancelled = false;

    const restoreSession = async () => {
      if (!token) {
        setAppLoading(false);
        return;
      }

      try {
        const response = await fetch(`${API_BASE}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!response.ok) {
          throw new Error("Session expired.");
        }

        const currentUser = await response.json();
        if (!cancelled) {
          setUser(currentUser);
        }
      } catch (error) {
        if (!cancelled) {
          console.warn("Session restoration failed:", error);
          clearSession();
        }
      } finally {
        if (!cancelled) setAppLoading(false);
      }
    };

    restoreSession();
    return () => {
      cancelled = true;
    };
  }, [token, clearSession]);

  // Load private conversations after the user has been authenticated.
  useEffect(() => {
    if (token && user) {
      loadConversations();
    }
  }, [token, user, loadConversations]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  if (appLoading) {
    return (
      <div style={styles.fullScreenMessage}>
        <div style={styles.loader} />
        <p>Restoring your session...</p>
      </div>
    );
  }

  if (!token || !user) {
    return (
      <div style={styles.authPage}>
        <div style={styles.authCard}>
          <div style={styles.authBrand}>Gemini AI</div>
          <h1 style={styles.authTitle}>
            {authMode === "login" ? "Welcome back" : "Create your account"}
          </h1>
          <p style={styles.authSubtitle}>
            {authMode === "login"
              ? "Log in to continue to your conversations."
              : "Sign up to save and access your chats."}
          </p>

          <form onSubmit={handleAuthSubmit} style={styles.authForm}>
            {authMode === "signup" && (
              <label style={styles.label}>
                Name
                <input
                  style={styles.authInput}
                  type="text"
                  autoComplete="name"
                  placeholder="Your name"
                  value={authForm.name}
                  onChange={(event) =>
                    setAuthForm((previous) => ({
                      ...previous,
                      name: event.target.value,
                    }))
                  }
                />
              </label>
            )}

            <label style={styles.label}>
              Email
              <input
                style={styles.authInput}
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={authForm.email}
                onChange={(event) =>
                  setAuthForm((previous) => ({
                    ...previous,
                    email: event.target.value,
                  }))
                }
              />
            </label>

            <label style={styles.label}>
              Password
              <input
                style={styles.authInput}
                type="password"
                autoComplete={
                  authMode === "login" ? "current-password" : "new-password"
                }
                placeholder="At least 8 characters"
                value={authForm.password}
                onChange={(event) =>
                  setAuthForm((previous) => ({
                    ...previous,
                    password: event.target.value,
                  }))
                }
              />
            </label>

            {authError && <div style={styles.errorBox}>{authError}</div>}

            <button
              type="submit"
              style={{
                ...styles.primaryButton,
                opacity: authLoading ? 0.65 : 1,
              }}
              disabled={authLoading}
            >
              {authLoading
                ? "Please wait..."
                : authMode === "login"
                ? "Log in"
                : "Create account"}
            </button>
          </form>

          <p style={styles.authSwitch}>
            {authMode === "login"
              ? "Don't have an account?"
              : "Already have an account?"}{" "}
            <button
              type="button"
              style={styles.textButton}
              onClick={() => {
                setAuthMode(authMode === "login" ? "signup" : "login");
                setAuthError("");
              }}
            >
              {authMode === "login" ? "Sign up" : "Log in"}
            </button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.app}>
      <aside style={styles.sidebar}>
        <h2 style={styles.logo}>Gemini AI</h2>

        <button
          onClick={createConversation}
          style={styles.newChatButton}
          disabled={loading}
        >
          + New Chat
        </button>

        <h3 style={styles.historyTitle}>Chat History</h3>

        <div style={styles.historyList}>
          {sidebarLoading && <p style={styles.muted}>Loading chats...</p>}

          {conversations.map((conversation) => (
            <div
              key={conversation.conversation_id}
              style={{
                ...styles.historyItem,
                background:
                  activeConversation === conversation.conversation_id
                    ? "#27272a"
                    : "transparent",
              }}
            >
              <button
                onClick={() => loadConversation(conversation.conversation_id)}
                style={styles.historyButton}
                disabled={loading}
              >
                {conversation.title || "New Chat"}
              </button>

              <button
                onClick={() => deleteConversation(conversation.conversation_id)}
                style={styles.deleteButton}
                title="Delete conversation"
                aria-label="Delete conversation"
              >
                ×
              </button>
            </div>
          ))}

          {!sidebarLoading && conversations.length === 0 && (
            <p style={styles.muted}>No conversations yet.</p>
          )}
        </div>

        <div style={styles.sidebarFooter}>
          <div style={styles.userDetails}>
            <div style={styles.avatar}>
              {(user.name || user.email || "U").charAt(0).toUpperCase()}
            </div>
            <div style={styles.userText}>
              <strong>{user.name}</strong>
              <span>{user.email}</span>
            </div>
          </div>
          <button onClick={handleLogout} style={styles.logoutButton}>
            Log out
          </button>
          <div style={styles.poweredBy}>Powered by Gemini</div>
        </div>
      </aside>

      <main style={styles.main}>
        <header style={styles.header}>
          <h2 style={styles.headerTitle}>
            {activeConversation ? "Your Conversation" : "AI Assistant"}
          </h2>
          <span style={styles.status}>● Online</span>
        </header>

        <div style={styles.chatBox}>
          {messages.length === 0 && (
            <div style={styles.welcome}>
              <h1>How can I help you today?</h1>
              <p>Ask Gemini anything.</p>
            </div>
          )}

          {messages.map((item, index) => (
            <div
              key={`${index}-${item.role}`}
              style={{
                ...styles.messageRow,
                justifyContent:
                  item.role === "user" ? "flex-end" : "flex-start",
              }}
            >
              <div
                style={{
                  ...styles.message,
                  background: item.role === "user" ? "#2563eb" : "#27272a",
                }}
              >
                <strong>{item.role === "user" ? "You" : "Gemini"}</strong>
                <p style={styles.messageText}>{item.text}</p>
              </div>
            </div>
          ))}

          {loading && <div style={styles.thinking}>Gemini is thinking...</div>}
          <div ref={messagesEndRef} />
        </div>

        <form onSubmit={sendMessage} style={styles.form}>
          <input
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Message Gemini..."
            style={styles.input}
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !message.trim()}
            style={{
              ...styles.sendButton,
              opacity: loading || !message.trim() ? 0.5 : 1,
            }}
          >
            Send
          </button>
        </form>

        <p style={styles.disclaimer}>
          Gemini can make mistakes. Verify important information.
        </p>
      </main>
    </div>
  );
}

const styles = {
  app: {
    display: "flex",
    height: "100vh",
    background: "#09090b",
    color: "white",
    fontFamily: "Arial, sans-serif",
    overflow: "hidden",
  },
  fullScreenMessage: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "12px",
    background: "#09090b",
    color: "white",
    fontFamily: "Arial, sans-serif",
  },
  loader: {
    width: "28px",
    height: "28px",
    border: "3px solid #3f3f46",
    borderTopColor: "#3b82f6",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },
  authPage: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px",
    boxSizing: "border-box",
    background:
      "radial-gradient(circle at top, #1e293b 0%, #09090b 48%, #09090b 100%)",
    color: "white",
    fontFamily: "Arial, sans-serif",
  },
  authCard: {
    width: "100%",
    maxWidth: "410px",
    padding: "36px",
    border: "1px solid #27272a",
    borderRadius: "18px",
    background: "#111113",
    boxShadow: "0 24px 80px rgba(0,0,0,0.35)",
    boxSizing: "border-box",
  },
  authBrand: {
    color: "#60a5fa",
    fontSize: "15px",
    fontWeight: "bold",
    letterSpacing: "0.4px",
    marginBottom: "28px",
  },
  authTitle: {
    margin: "0 0 9px",
    fontSize: "27px",
  },
  authSubtitle: {
    margin: "0 0 26px",
    color: "#a1a1aa",
    fontSize: "14px",
    lineHeight: 1.5,
  },
  authForm: {
    display: "flex",
    flexDirection: "column",
    gap: "17px",
  },
  label: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    color: "#e4e4e7",
    fontSize: "13px",
    fontWeight: "bold",
  },
  authInput: {
    width: "100%",
    boxSizing: "border-box",
    padding: "13px 14px",
    border: "1px solid #3f3f46",
    borderRadius: "9px",
    background: "#18181b",
    color: "white",
    outline: "none",
    fontSize: "14px",
  },
  errorBox: {
    padding: "11px 12px",
    border: "1px solid #7f1d1d",
    borderRadius: "8px",
    background: "#450a0a",
    color: "#fecaca",
    fontSize: "13px",
    lineHeight: 1.45,
  },
  primaryButton: {
    padding: "13px",
    border: "none",
    borderRadius: "9px",
    background: "#2563eb",
    color: "white",
    fontSize: "14px",
    fontWeight: "bold",
    cursor: "pointer",
    marginTop: "3px",
  },
  authSwitch: {
    margin: "23px 0 0",
    textAlign: "center",
    color: "#a1a1aa",
    fontSize: "13px",
  },
  textButton: {
    padding: 0,
    border: "none",
    background: "transparent",
    color: "#60a5fa",
    fontWeight: "bold",
    cursor: "pointer",
    fontSize: "13px",
  },
  sidebar: {
    width: "260px",
    minWidth: "260px",
    background: "#111113",
    padding: "20px",
    display: "flex",
    flexDirection: "column",
    borderRight: "1px solid #27272a",
    boxSizing: "border-box",
  },
  logo: {
    margin: "0 0 25px",
    fontSize: "24px",
  },
  newChatButton: {
    padding: "13px",
    borderRadius: "8px",
    border: "1px solid #3f3f46",
    background: "#27272a",
    color: "white",
    cursor: "pointer",
    fontSize: "14px",
  },
  historyTitle: {
    color: "#a1a1aa",
    fontSize: "13px",
    marginTop: "30px",
  },
  historyList: {
    flex: 1,
    overflowY: "auto",
  },
  historyItem: {
    display: "flex",
    alignItems: "center",
    marginBottom: "5px",
    borderRadius: "7px",
  },
  historyButton: {
    flex: 1,
    minWidth: 0,
    padding: "11px",
    textAlign: "left",
    background: "transparent",
    border: "none",
    color: "#e4e4e7",
    cursor: "pointer",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  deleteButton: {
    border: "none",
    background: "transparent",
    color: "#a1a1aa",
    fontSize: "20px",
    cursor: "pointer",
    padding: "5px 10px",
  },
  sidebarFooter: {
    color: "#71717a",
    fontSize: "12px",
    paddingTop: "15px",
    borderTop: "1px solid #27272a",
  },
  userDetails: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    marginBottom: "12px",
    minWidth: 0,
  },
  avatar: {
    width: "34px",
    height: "34px",
    minWidth: "34px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "50%",
    background: "#2563eb",
    color: "white",
    fontWeight: "bold",
  },
  userText: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    minWidth: 0,
    overflow: "hidden",
  },
  logoutButton: {
    width: "100%",
    padding: "9px",
    border: "1px solid #3f3f46",
    borderRadius: "7px",
    background: "transparent",
    color: "#e4e4e7",
    cursor: "pointer",
  },
  poweredBy: {
    paddingTop: "12px",
    textAlign: "center",
  },
  main: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
  },
  header: {
    height: "65px",
    minHeight: "65px",
    padding: "0 25px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottom: "1px solid #27272a",
  },
  headerTitle: {
    fontSize: "18px",
  },
  status: {
    color: "#22c55e",
    fontSize: "13px",
  },
  chatBox: {
    flex: 1,
    overflowY: "auto",
    padding: "25px",
    display: "flex",
    flexDirection: "column",
    gap: "20px",
  },
  welcome: {
    margin: "auto",
    textAlign: "center",
    color: "#a1a1aa",
  },
  messageRow: {
    display: "flex",
    width: "100%",
  },
  message: {
    maxWidth: "75%",
    padding: "14px 17px",
    borderRadius: "12px",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    lineHeight: 1.6,
  },
  messageText: {
    margin: "8px 0 0",
  },
  thinking: {
    color: "#a1a1aa",
    fontSize: "14px",
  },
  form: {
    display: "flex",
    gap: "12px",
    padding: "15px 25px",
  },
  input: {
    flex: 1,
    minWidth: 0,
    padding: "15px",
    borderRadius: "10px",
    border: "1px solid #3f3f46",
    background: "#18181b",
    color: "white",
    outline: "none",
    fontSize: "15px",
  },
  sendButton: {
    padding: "0 25px",
    borderRadius: "10px",
    border: "none",
    background: "#2563eb",
    color: "white",
    cursor: "pointer",
    fontWeight: "bold",
  },
  disclaimer: {
    textAlign: "center",
    color: "#71717a",
    fontSize: "11px",
    paddingBottom: "12px",
  },
  muted: {
    color: "#71717a",
    fontSize: "13px",
  },
};

export default App;
