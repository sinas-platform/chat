import type { ChatAttachment } from "../lib/files/types";

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
    attachments?: ChatAttachment[];
  }
  
  export interface AgentResponse {
    id: string;
    user_id: string;
    namespace: string;
    name: string;
    description: string | null;
    llm_provider_id: string | null;
    model: string | null;
    temperature: number;
    max_tokens: number | null;
    system_prompt: string;
    input_schema: Record<string, unknown> | null;
    output_schema: Record<string, unknown> | null;
    initial_messages: unknown[] | null;
    enabled_functions: unknown[];
    enabled_agents: unknown[];
    enabled_skills: unknown[];
    function_parameters: Record<string, unknown> | null;
    state_namespaces_readonly: string[];
    state_namespaces_readwrite: string[];
    enabled_collections: unknown[];
    is_active: boolean;
    is_default: boolean;
    created_at: string;
    updated_at: string;
  }

  // Backwards-compatible alias for existing imports in the codebase.
  export type Agent = AgentResponse;
  
