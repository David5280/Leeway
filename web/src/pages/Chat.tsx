// Chat: ask about your money in your own words, like "Can I afford a PS5 Pro
// right now?". The same conversation Ask Leeway opens over every screen
// (chat/ChatThread.tsx), here as a full page for old links, the phone widget
// and assistants. Only there when the server has an Anthropic key; otherwise
// its address leads back to Overview.

import { Navigate } from 'react-router-dom'
import { useChatAvailable } from '../api/chat'
import { Shell } from '../components/Shell'
import { Loading } from '../components/ui'
import { ChatThread } from './chat/ChatThread'

export { STILL_ANSWERING } from './chat/ChatThread'

/** The page's heading, over the conversation. */
const HEADING = (
  <div>
    <p className="eyebrow">Chat</p>
    <h1>Ask Leeway</h1>
  </div>
)

export function ChatPage() {
  const available = useChatAvailable()
  if (available === false) return <Navigate to="/" replace />
  return <Shell>{available ? <ChatThread heading={HEADING} /> : <Loading />}</Shell>
}
