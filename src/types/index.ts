// Authentication
export interface User {
    id: string;
    email: string;
    is_active: boolean;
    external_auth_provider?: string | null;
    external_auth_id?: string | null;
    created_at: string;
  }
  
  export interface LoginRequest {
    email: string;
  }
  
  export interface LoginResponse {
    message: string;
    session_id: string;
  }
  
  export interface OTPVerifyRequest {
    session_id: string;
    otp_code: string;
  }
  
  export interface OTPVerifyResponse {
    access_token: string;
    refresh_token: string;
    token_type: string;
    expires_in: number;
    user: User;
  }
  
  // Chats
export interface Chat {
    id: string;
    user_id: string;
    user_email?: string;
    agent_id: string | null;
    agent_namespace: string | null;
    agent_name: string | null;
    title: string;
    created_at: string;
    updated_at: string;
    last_message_at?: string | null;
  }
  
  export interface ChatCreate {
    title?: string;
    input?: Record<string, any>;
  }
  
  export interface ChatWithMessages extends Chat {
    messages: Message[];
  }
  
  export type MessageContent = string | any[];
  
  export interface Message {
    id: string;
    chat_id: string;
    role: "user" | "assistant" | "system" | "tool";
    content: MessageContent | null;
    tool_calls: any[] | null;
    tool_call_id: string | null;
    name: string | null;
    created_at: string;
  }
  
  export interface MessageSendRequest {
    content: MessageContent;
  }
  
  // Agents (minimal for now)
  export interface Agent {
    id: string;
    namespace: string;
    name: string;
    description: string | null;
    is_active: boolean;
    created_at: string;
    updated_at: string;
  }
  
