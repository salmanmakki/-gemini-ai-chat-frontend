import { useState } from "react";

function App() {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);

  const sendMessage = async (e) => {
  e.preventDefault();

  if (!message.trim() || loading) return;

  const userMessage = message;

  setMessages((prev) => [
    ...prev,
    { role: "user", text: userMessage },
  ]);

  setMessage("");
  setLoading(true);

  try {
    const response = await fetch(
      "https://gemini-ai-backend-uxgd.onrender.com/chat/stream",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: userMessage,
        }),
      }
    );

    if (!response.ok || !response.body) {
      throw new Error("Streaming request failed");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    setMessages((prev) => [
      ...prev,
      { role: "assistant", text: "" },
    ]);

    while (true) {
      const { value, done } = await reader.read();

      if (done) break;

      const text = decoder.decode(value, {
        stream: true,
      });

      setMessages((prev) => {
        const updated = [...prev];
        const lastIndex = updated.length - 1;

        updated[lastIndex] = {
          ...updated[lastIndex],
          text: updated[lastIndex].text + text,
        };

        return updated;
      });
    }

    const remaining = decoder.decode();

    if (remaining) {
      setMessages((prev) => {
        const updated = [...prev];
        const lastIndex = updated.length - 1;

        updated[lastIndex] = {
          ...updated[lastIndex],
          text: updated[lastIndex].text + remaining,
        };

        return updated;
      });
    }

  } catch (error) {
    console.error(error);

    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        text: "Unable to connect to the AI server.",
      },
    ]);

  } finally {
    setLoading(false);
  }
};


  return (
    <div style={styles.container}>
      <h1>Gemini AI Chatbot</h1>

      <div style={styles.chatBox}>
        {messages.map((msg, index) => (
          <div
            key={index}
            style={{
              ...styles.message,
              alignSelf:
                msg.role === "user" ? "flex-end" : "flex-start",
              background:
                msg.role === "user" ? "#2563eb" : "#27272a",
            }}
          >
            <strong>
              {msg.role === "user" ? "You" : "Gemini"}
            </strong>

            <p>{msg.text}</p>
          </div>
        ))}

        {loading && <p>Gemini is thinking...</p>}
      </div>

      <form onSubmit={sendMessage} style={styles.form}>
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Ask something..."
          style={styles.input}
        />

        <button disabled={loading} style={styles.button}>
          Send
        </button>
      </form>
    </div>
  );
}

const styles = {
  container: {
    maxWidth: "750px",
    margin: "40px auto",
    padding: "20px",
    fontFamily: "Arial",
    color: "white",
    background: "#18181b",
    borderRadius: "12px",
  },

  chatBox: {
    minHeight: "400px",
    display: "flex",
    flexDirection: "column",
    gap: "15px",
    padding: "15px",
  },

  message: {
    maxWidth: "80%",
    padding: "12px",
    borderRadius: "10px",
    whiteSpace: "pre-wrap",
  },

  form: {
    display: "flex",
    gap: "10px",
  },

  input: {
    flex: 1,
    padding: "12px",
    borderRadius: "8px",
    border: "none",
  },

  button: {
    padding: "12px 20px",
    background: "#2563eb",
    color: "white",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
  },
};

export default App;