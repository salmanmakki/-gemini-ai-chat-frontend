import { useCallback, useEffect, useRef, useState } from "react";

const API_BASE = "https://gemini-ai-backend-uxgd.onrender.com";
const TOKEN_KEY = "gemini_chat_access_token";

const errorText = (data, fallback) =>
  data?.detail || data?.message || data?.error || fallback;

const answerText = (data) => {
  if (typeof data === "string") return data;
  return data?.answer || data?.response || data?.result || data?.reply ||
    data?.message || data?.output ||
    "The request completed, but the server did not return an answer.";
};

const sourceList = (data) =>
  Array.isArray(data?.sources) ? data.sources :
  Array.isArray(data?.documents) ? data.documents :
  Array.isArray(data?.context) ? data.context : [];

function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({ name: "", email: "", password: "" });
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");

  const [conversations, setConversations] = useState([]);
  const [activeConversation, setActiveConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState("");
  const [activeMode, setActiveMode] = useState("chat");
  const [loading, setLoading] = useState(false);
  const [sidebarLoading, setSidebarLoading] = useState(false);
  const [appLoading, setAppLoading] = useState(Boolean(token));
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [uploadStatus, setUploadStatus] = useState("");
  const [modeMessages, setModeMessages] = useState({ rag: [], agent: [] });
  const [modeError, setModeError] = useState("");
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  const clearSession = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    setConversations([]);
    setActiveConversation(null);
    setMessages([]);
    setMessage("");
    setModeMessages({ rag: [], agent: [] });
    setSelectedFile(null);
    setUploadedFileName("");
  }, []);

  // Attach the JWT to authenticated requests.
  const authFetch = useCallback(async (url, options = {}) => {
    const currentToken = token || localStorage.getItem(TOKEN_KEY);
    const headers = {
      ...(options.headers || {}),
      ...(currentToken ? { Authorization: `Bearer ${currentToken}` } : {}),
    };
    const response = await fetch(url, { ...options, headers });
    if (response.status === 401) {
      clearSession();
      throw new Error("Your session has expired. Please log in again.");
    }
    return response;
  }, [token, clearSession]);

  const loadConversations = useCallback(async () => {
    try {
      setSidebarLoading(true);
      const response = await authFetch(`${API_BASE}/conversations`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorText(data, "Unable to load conversations."));
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
      const response = await authFetch(`${API_BASE}/conversations/${conversationId}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorText(data, "Unable to load conversation."));
      setActiveConversation(conversationId);
      setMessages((data.messages || []).map((item) => ({
        role: item.role, text: item.content,
      })));
      setActiveMode("chat");
      setSidebarOpen(false);
    } catch (error) {
      console.error("History loading error:", error);
      window.alert(error.message || "Unable to load this conversation.");
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
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorText(data, "Unable to create conversation."));
      setActiveConversation(data.conversation_id);
      setMessages([]);
      setActiveMode("chat");
      await loadConversations();
      return data.conversation_id;
    } catch (error) {
      console.error("Create conversation error:", error);
      window.alert(error.message || "Unable to create a new conversation.");
      return null;
    }
  };

  const sendChatMessage = async (userMessage) => {
    let conversationId = activeConversation;
    if (!conversationId) {
      const createResponse = await authFetch(`${API_BASE}/conversations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: userMessage.slice(0, 45) || "New Chat" }),
      });
      const created = await createResponse.json().catch(() => ({}));
      if (!createResponse.ok) throw new Error(errorText(created, "Unable to create conversation."));
      conversationId = created.conversation_id;
      setActiveConversation(conversationId);
    }

    const response = await authFetch(
      `${API_BASE}/conversations/${conversationId}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMessage }),
      }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(errorText(data, "Gemini response failed."));
    setMessages((previous) => [
      ...previous,
      { role: "assistant", text: data.assistant_reply || answerText(data) },
    ]);
    await loadConversations();
  };

  const sendModeMessage = async (userMessage, mode) => {
    const endpoint = mode === "rag" ? "/ask" : "/agent";
    const response = await authFetch(`${API_BASE}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: userMessage }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(errorText(data, `${mode === "rag" ? "PDF Assistant" : "AI Agent"} request failed.`));
    }
    setModeMessages((previous) => ({
      ...previous,
      [mode]: [
        ...(previous[mode] || []),
        { role: "assistant", text: answerText(data), sources: sourceList(data) },
      ],
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const userMessage = message.trim();
    if (!userMessage || loading) return;

    setMessage("");
    setModeError("");
    setLoading(true);

    if (activeMode === "chat") {
      setMessages((previous) => [...previous, { role: "user", text: userMessage }]);
    } else {
      setModeMessages((previous) => ({
        ...previous,
        [activeMode]: [...(previous[activeMode] || []), { role: "user", text: userMessage }],
      }));
    }

    try {
      if (activeMode === "chat") await sendChatMessage(userMessage);
      else await sendModeMessage(userMessage, activeMode);
    } catch (error) {
      console.error(`${activeMode} request error:`, error);
      const text = error.message || "Unable to connect to the AI server. Please try again.";
      if (activeMode === "chat") {
        setMessages((previous) => [...previous, { role: "assistant", text }]);
      } else {
        setModeError(text);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async (event) => {
    event.preventDefault();
    if (!selectedFile || loading) return;

    if (!selectedFile.name.toLowerCase().endsWith(".pdf")) {
      setModeError("Please select a PDF file.");
      return;
    }
    if (selectedFile.size > 10 * 1024 * 1024) {
      setModeError("The PDF must be 10 MB or smaller.");
      return;
    }

    setLoading(true);
    setModeError("");
    setUploadStatus("Uploading and processing your PDF...");
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      // Do not set Content-Type manually; the browser supplies the multipart boundary.
      const response = await authFetch(`${API_BASE}/upload`, {
        method: "POST",
        body: formData,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorText(data, "PDF upload failed."));
      setUploadedFileName(selectedFile.name);
      setUploadStatus(data.message || `Successfully processed ${selectedFile.name}. You can now ask questions about it.`);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (error) {
      console.error("PDF upload error:", error);
      setUploadStatus("");
      setModeError(error.message || "Unable to upload the PDF.");
    } finally {
      setLoading(false);
    }
  };

  const deleteConversation = async (conversationId) => {
    if (!window.confirm("Are you sure you want to delete this conversation?")) return;
    try {
      const response = await authFetch(`${API_BASE}/conversations/${conversationId}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorText(data, "Unable to delete conversation."));
      if (activeConversation === conversationId) {
        setActiveConversation(null);
        setMessages([]);
      }
      await loadConversations();
    } catch (error) {
      console.error("Delete error:", error);
      window.alert(error.message || "Unable to delete conversation.");
    }
  };

  const handleAuthSubmit = async (event) => {
    event.preventDefault();
    setAuthError("");
    const email = authForm.email.trim().toLowerCase();
    const password = authForm.password;

    if (!email || !password) return setAuthError("Please enter your email and password.");
    if (authMode === "signup" && !authForm.name.trim()) return setAuthError("Please enter your name.");
    if (authMode === "signup" && password.length < 8) return setAuthError("Password must contain at least 8 characters.");

    setAuthLoading(true);
    try {
      if (authMode === "signup") {
        const registerResponse = await fetch(`${API_BASE}/auth/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: authForm.name.trim(), email, password }),
        });
        const registerData = await registerResponse.json().catch(() => ({}));
        if (!registerResponse.ok) throw new Error(errorText(registerData, "Unable to create account."));
      }

      // FastAPI OAuth2PasswordRequestForm expects username and password form fields.
      const formBody = new URLSearchParams();
      formBody.set("username", email);
      formBody.set("password", password);
      const loginResponse = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formBody.toString(),
      });
      const loginData = await loginResponse.json().catch(() => ({}));
      if (!loginResponse.ok) throw new Error(errorText(loginData, "Login failed."));

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
        if (!response.ok) throw new Error("Session expired.");
        const currentUser = await response.json();
        if (!cancelled) setUser(currentUser);
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
    return () => { cancelled = true; };
  }, [token, clearSession]);

  useEffect(() => {
    if (token && user) loadConversations();
  }, [token, user, loadConversations]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, modeMessages, loading]);

  const switchMode = (mode) => {
    setActiveMode(mode);
    setModeError("");
    setUploadStatus("");
    setSidebarOpen(false);
  };

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
          <h1 style={styles.authTitle}>{authMode === "login" ? "Welcome back" : "Create your account"}</h1>
          <p style={styles.authSubtitle}>
            {authMode === "login" ? "Log in to continue to your conversations." : "Sign up to save and access your chats."}
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
                  onChange={(event) => setAuthForm((previous) => ({ ...previous, name: event.target.value }))}
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
                onChange={(event) => setAuthForm((previous) => ({ ...previous, email: event.target.value }))}
              />
            </label>
            <label style={styles.label}>
              Password
              <input
                style={styles.authInput}
                type="password"
                autoComplete={authMode === "login" ? "current-password" : "new-password"}
                placeholder="At least 8 characters"
                value={authForm.password}
                onChange={(event) => setAuthForm((previous) => ({ ...previous, password: event.target.value }))}
              />
            </label>
            {authError && <div style={styles.errorBox}>{authError}</div>}
            <button type="submit" style={{ ...styles.primaryButton, opacity: authLoading ? 0.65 : 1 }} disabled={authLoading}>
              {authLoading ? "Please wait..." : authMode === "login" ? "Log in" : "Create account"}
            </button>
          </form>
          <p style={styles.authSwitch}>
            {authMode === "login" ? "Don't have an account?" : "Already have an account?"}{" "}
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

  const visibleMessages = activeMode === "chat" ? messages : modeMessages[activeMode];
  const modeTitle = activeMode === "chat" ? "Gemini Chat" : activeMode === "rag" ? "PDF Assistant" : "AI Agent";

  return (
    <div style={styles.app}>
      <style>{responsiveStyles}</style>
      <div className={`mobile-sidebar-backdrop ${sidebarOpen ? "visible" : ""}`} onClick={() => setSidebarOpen(false)} />
      <aside className={`app-sidebar ${sidebarOpen ? "sidebar-open" : ""}`} style={styles.sidebar}>
        <h2 style={styles.logo}>Gemini AI</h2>
        <button onClick={() => { createConversation(); setSidebarOpen(false); }} style={styles.newChatButton} disabled={loading}>
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
                background: activeConversation === conversation.conversation_id ? "#27272a" : "transparent",
              }}
            >
              <button onClick={() => loadConversation(conversation.conversation_id)} style={styles.historyButton} disabled={loading}>
                {conversation.title || "New Chat"}
              </button>
              <button onClick={() => deleteConversation(conversation.conversation_id)} style={styles.deleteButton} title="Delete conversation" aria-label="Delete conversation">×</button>
            </div>
          ))}
          {!sidebarLoading && conversations.length === 0 && <p style={styles.muted}>No conversations yet.</p>}
        </div>
        <div style={styles.sidebarFooter}>
          <div style={styles.userDetails}>
            <div style={styles.avatar}>{(user.name || user.email || "U").charAt(0).toUpperCase()}</div>
            <div style={styles.userText}>
              <strong>{user.name}</strong>
              <span>{user.email}</span>
            </div>
          </div>
          <button onClick={handleLogout} style={styles.logoutButton}>Log out</button>
          <div style={styles.poweredBy}>Powered by Gemini</div>
        </div>
      </aside>

      <main className="main" style={styles.main}>
        <header className="header" style={styles.header}>
          <button className="mobile-menu-button" type="button" onClick={() => setSidebarOpen(true)} aria-label="Open chat history">☰</button>
          <h2 style={styles.headerTitle}>{modeTitle}</h2>
          <div className="mode-switcher" style={styles.modeSwitcher}>
            {[["chat", "Gemini Chat"], ["rag", "PDF Assistant"], ["agent", "AI Agent"]].map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => switchMode(mode)}
                style={{ ...styles.modeButton, ...(activeMode === mode ? styles.modeButtonActive : {}) }}
              >
                {label}
              </button>
            ))}
          </div>
          <span style={styles.status}>● Online</span>
        </header>

        {activeMode === "rag" && (
          <section style={styles.uploadPanel}>
            <div>
              <strong>Knowledge base</strong>
              <p style={styles.panelHint}>
                Upload a PDF (maximum 10 MB), then ask questions about its contents.
                {uploadedFileName ? ` Current upload: ${uploadedFileName}` : ""}
              </p>
            </div>
            <form onSubmit={handleUpload} className="uploadForm" style={styles.uploadForm}>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,application/pdf"
                onChange={(event) => {
                  setSelectedFile(event.target.files?.[0] || null);
                  setModeError("");
                  setUploadStatus("");
                }}
                style={styles.fileInput}
                disabled={loading}
              />
              <button type="submit" style={styles.uploadButton} disabled={loading || !selectedFile}>
                {loading ? "Processing..." : "Upload PDF"}
              </button>
            </form>
            {uploadStatus && <p style={styles.successText}>{uploadStatus}</p>}
          </section>
        )}

        <div className="chatBox" style={styles.chatBox}>
          {visibleMessages.length === 0 && (
            <div style={styles.welcome}>
              <h1>
                {activeMode === "chat" ? "How can I help you today?" :
                  activeMode === "rag" ? "Ask questions about your PDF" : "What would you like the AI agent to do?"}
              </h1>
              <p>
                {activeMode === "chat" ? "Ask Gemini anything." :
                  activeMode === "rag" ? "Upload a PDF above, then ask a question grounded in its content." :
                    "The agent can use its available tools to work through a task."}
              </p>
            </div>
          )}

          {visibleMessages.map((item, index) => (
            <div key={`${activeMode}-${index}-${item.role}`} className="messageRow" style={{
              ...styles.messageRow,
              justifyContent: item.role === "user" ? "flex-end" : "flex-start",
            }}>
              <div className="message" style={{
                ...styles.message,
                background: item.role === "user" ? "#2563eb" : "#27272a",
              }}>
                <strong style={styles.messageLabel}>{item.role === "user" ? "You" : modeTitle}</strong>
                <p style={styles.messageText}>{item.text}</p>
                {Array.isArray(item.sources) && item.sources.length > 0 && (
                  <div style={styles.sourcesBox}>
                    <strong>Sources</strong>
                    {item.sources.map((source, sourceIndex) => (
                      <div key={sourceIndex} style={styles.sourceItem}>
                        {typeof source === "string" ? source :
                          source?.source || source?.filename || source?.file_name || source?.text || JSON.stringify(source)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {modeError && <div style={styles.errorBox}>{modeError}</div>}
          {loading && <div style={styles.thinking}>
            {activeMode === "chat" ? "Gemini is thinking..." : activeMode === "rag" ? "Searching your documents..." : "AI Agent is working..."}
          </div>}
          <div ref={messagesEndRef} />
        </div>

        <form className="form" onSubmit={handleSubmit} style={styles.form}>
          <input
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder={
              activeMode === "chat" ? "Message Gemini..." :
                activeMode === "rag" ? "Ask a question about your PDF..." : "Give the AI agent a task..."
            }
            style={styles.input}
            disabled={loading}
          />
          <button type="submit" disabled={loading || !message.trim()} style={{
            ...styles.sendButton, opacity: loading || !message.trim() ? 0.5 : 1,
          }}>
            {loading ? "Working..." : "Send"}
          </button>
        </form>
        <p style={styles.disclaimer}>
          {activeMode === "chat" ? "Gemini can make mistakes. Verify important information." :
            activeMode === "rag" ? "PDF answers are generated from retrieved document content. Verify important information." :
              "Review agent results before relying on them."}
        </p>
      </main>
    </div>
  );
}

const responsiveStyles = `
  * { box-sizing: border-box; }
  html, body, #root { width: 100%; min-height: 100%; margin: 0; }
  button, input { font: inherit; }
  .mobile-menu-button, .mobile-sidebar-backdrop { display: none; }
  @media (max-width: 900px) {
    .header { flex-wrap: wrap; height: auto !important; min-height: 65px; padding: 10px 14px !important; gap: 8px; }
    .header h2 { flex: 1; min-width: 100px; margin: 0; font-size: 16px !important; }
    .mode-switcher { order: 3; width: 100%; justify-content: center; }
    .header > span { font-size: 11px !important; }
  }
  @media (max-width: 700px) {
    .app-sidebar { position: fixed !important; z-index: 30; inset: 0 auto 0 0; width: min(84vw, 320px) !important; min-width: 0 !important; height: 100dvh; padding: 18px !important; transform: translateX(-105%); transition: transform .22s ease; box-shadow: 12px 0 35px rgba(0,0,0,.35); overflow-y: auto; }
    .app-sidebar.sidebar-open { transform: translateX(0); }
    .mobile-sidebar-backdrop.visible { display: block; position: fixed; inset: 0; z-index: 29; background: rgba(0,0,0,.58); }
    .mobile-menu-button { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 40px; width: 40px; height: 40px; padding: 0; border: 1px solid #3f3f46; border-radius: 9px; background: #18181b; color: #fff; font-size: 20px; cursor: pointer; }
    .app-sidebar .logo { margin-bottom: 20px !important; }
    main { width: 100%; min-width: 0; }
    .chatBox { padding: 14px !important; gap: 14px !important; }
    .messageRow { min-width: 0; }
    .message { max-width: 94% !important; padding: 11px 13px !important; font-size: 14px; }
    .form { padding: 10px 12px !important; gap: 8px !important; }
    .form input { min-width: 0; padding: 12px !important; font-size: 16px !important; }
    .form button { min-height: 44px; padding: 0 16px !important; }
    .disclaimer { margin: 0; padding: 0 8px 8px !important; font-size: 10px !important; }
    .welcome { padding: 0 12px; }
    .welcome h1 { font-size: 23px; }
    .uploadPanel { padding: 12px !important; }
    .uploadForm { flex-direction: column; align-items: stretch !important; }
    .fileInput { max-width: 100%; }
    .authPage { min-height: 100dvh !important; padding: 16px !important; }
    .authCard { padding: 25px 20px !important; border-radius: 14px !important; }
  }
  @media (prefers-reduced-motion: reduce) { .app-sidebar { transition: none !important; } }
`;

const styles = {
  app: { display: "flex", height: "100vh", minHeight: "100dvh", background: "#09090b", color: "white", fontFamily: "Arial, sans-serif", overflow: "hidden" },
  fullScreenMessage: { minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "12px", background: "#09090b", color: "white", fontFamily: "Arial, sans-serif" },
  loader: { width: "28px", height: "28px", border: "3px solid #3f3f46", borderTopColor: "#3b82f6", borderRadius: "50%", animation: "spin 0.8s linear infinite" },
  authPage: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", background: "radial-gradient(circle at top, #1e293b 0%, #09090b 48%, #09090b 100%)", color: "white", fontFamily: "Arial, sans-serif" },
  authCard: { width: "100%", maxWidth: "410px", padding: "36px", border: "1px solid #27272a", borderRadius: "18px", background: "#111113", boxShadow: "0 24px 80px rgba(0,0,0,0.35)" },
  authBrand: { color: "#60a5fa", fontSize: "15px", fontWeight: "bold", marginBottom: "28px" },
  authTitle: { margin: "0 0 9px", fontSize: "27px" },
  authSubtitle: { margin: "0 0 26px", color: "#a1a1aa", fontSize: "14px", lineHeight: 1.5 },
  authForm: { display: "flex", flexDirection: "column", gap: "17px" },
  label: { display: "flex", flexDirection: "column", gap: "8px", color: "#e4e4e7", fontSize: "13px", fontWeight: "bold" },
  authInput: { width: "100%", padding: "13px 14px", border: "1px solid #3f3f46", borderRadius: "9px", background: "#18181b", color: "white", outline: "none", fontSize: "14px" },
  errorBox: { padding: "11px 12px", border: "1px solid #7f1d1d", borderRadius: "8px", background: "#450a0a", color: "#fecaca", fontSize: "13px", lineHeight: 1.45 },
  primaryButton: { padding: "13px", border: "none", borderRadius: "9px", background: "#2563eb", color: "white", fontSize: "14px", fontWeight: "bold", cursor: "pointer", marginTop: "3px" },
  authSwitch: { margin: "23px 0 0", textAlign: "center", color: "#a1a1aa", fontSize: "13px" },
  textButton: { padding: 0, border: "none", background: "transparent", color: "#60a5fa", fontWeight: "bold", cursor: "pointer", fontSize: "13px" },
  sidebar: { width: "260px", minWidth: "260px", background: "#111113", padding: "20px", display: "flex", flexDirection: "column", borderRight: "1px solid #27272a" },
  logo: { margin: "0 0 25px", fontSize: "24px" },
  newChatButton: { padding: "13px", borderRadius: "8px", border: "1px solid #3f3f46", background: "#27272a", color: "white", cursor: "pointer", fontSize: "14px" },
  historyTitle: { color: "#a1a1aa", fontSize: "13px", marginTop: "30px" },
  historyList: { flex: 1, overflowY: "auto" },
  historyItem: { display: "flex", alignItems: "center", marginBottom: "5px", borderRadius: "7px" },
  historyButton: { flex: 1, minWidth: 0, padding: "11px", textAlign: "left", background: "transparent", border: "none", color: "#e4e4e7", cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  deleteButton: { border: "none", background: "transparent", color: "#a1a1aa", fontSize: "20px", cursor: "pointer", padding: "5px 10px" },
  sidebarFooter: { color: "#71717a", fontSize: "12px", paddingTop: "15px", borderTop: "1px solid #27272a" },
  userDetails: { display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px", minWidth: 0 },
  avatar: { width: "34px", height: "34px", minWidth: "34px", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", background: "#2563eb", color: "white", fontWeight: "bold" },
  userText: { display: "flex", flexDirection: "column", gap: "4px", minWidth: 0, overflow: "hidden" },
  logoutButton: { width: "100%", padding: "9px", border: "1px solid #3f3f46", borderRadius: "7px", background: "transparent", color: "#e4e4e7", cursor: "pointer" },
  poweredBy: { paddingTop: "12px", textAlign: "center" },
  main: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0 },
  header: { minHeight: "65px", padding: "0 25px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "14px", borderBottom: "1px solid #27272a" },
  headerTitle: { fontSize: "18px", whiteSpace: "nowrap" },
  status: { color: "#22c55e", fontSize: "13px", whiteSpace: "nowrap" },
  modeSwitcher: { display: "flex", alignItems: "center", gap: "7px" },
  modeButton: { padding: "9px 12px", border: "1px solid #3f3f46", borderRadius: "8px", background: "#18181b", color: "#d4d4d8", cursor: "pointer", fontSize: "12px", whiteSpace: "nowrap" },
  modeButtonActive: { background: "#1d4ed8", borderColor: "#3b82f6", color: "white" },
  uploadPanel: { padding: "16px 25px", borderBottom: "1px solid #27272a", background: "#111113" },
  panelHint: { color: "#a1a1aa", fontSize: "13px", margin: "6px 0 12px", lineHeight: 1.5 },
  uploadForm: { display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" },
  fileInput: { color: "#d4d4d8", maxWidth: "100%" },
  uploadButton: { padding: "10px 15px", border: "none", borderRadius: "8px", background: "#2563eb", color: "white", cursor: "pointer", fontWeight: "bold" },
  successText: { color: "#86efac", fontSize: "13px", margin: "10px 0 0" },
  chatBox: { flex: 1, minHeight: 0, overflowY: "auto", padding: "25px", display: "flex", flexDirection: "column", gap: "20px" },
  welcome: { margin: "auto", textAlign: "center", color: "#a1a1aa" },
  messageRow: { display: "flex", width: "100%" },
  message: { maxWidth: "75%", padding: "14px 17px", borderRadius: "12px", whiteSpace: "pre-wrap", overflowWrap: "anywhere", lineHeight: 1.6 },
  messageLabel: { fontSize: "12px", color: "#bfdbfe" },
  messageText: { margin: "8px 0 0" },
  sourcesBox: { marginTop: "12px", padding: "10px", borderRadius: "8px", background: "#18181b", fontSize: "12px", color: "#d4d4d8" },
  sourceItem: { marginTop: "6px", paddingTop: "6px", borderTop: "1px solid #3f3f46", overflowWrap: "anywhere" },
  thinking: { color: "#a1a1aa", fontSize: "14px" },
  form: { display: "flex", gap: "12px", padding: "15px 25px" },
  input: { flex: 1, minWidth: 0, padding: "15px", borderRadius: "10px", border: "1px solid #3f3f46", background: "#18181b", color: "white", outline: "none", fontSize: "15px" },
  sendButton: { padding: "0 25px", borderRadius: "10px", border: "none", background: "#2563eb", color: "white", cursor: "pointer", fontWeight: "bold" },
  disclaimer: { textAlign: "center", color: "#71717a", fontSize: "11px", padding: "0 10px 12px", margin: 0 },
  muted: { color: "#71717a", fontSize: "13px" },
};

export default App;
